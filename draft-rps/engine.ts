// Server-authoritative Draft RPS engine. The Bun server owns one GameState per
// room, applies validated actions via reduce(), and broadcasts viewFor(seat) to
// each player. All randomness (shuffle, deal) happens here, never on a client.

import type { Action, Card, Round, Seat, View, Phase } from "./types";
import { SUIT_NAMES, otherSeat } from "./types";

const SUITS: Suit[] = ["T", "R", "P", "S"];
type Suit = "T" | "R" | "P" | "S";
const RPS_BEATS: Record<"R" | "P" | "S", Suit> = { R: "S", S: "P", P: "R" };

const HAND_SIZE = 5;
const PACK_SIZE = 13;
const PICKS_PER_PACK = 10;
const NUM_PACKS = 4;

export interface GameState {
  phase: Phase;
  packs: Card[][];
  packIndex: number;
  pickInPack: number;
  hands: Record<Seat, Card[]>;
  rounds: Round[];
  pending: Record<Seat, Card | null>;
  revealPending: boolean;
  lastPickId: string | null; // the most recently drafted card, for highlighting the open draft
}

// ---- pure rules (mirrors the hot-seat build) ----
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let v = 2; v <= 14; v++) deck.push({ suit: s, value: v, id: `${s}${v}` });
  return deck;
}
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function vlabel(v: number): string {
  if (v === 14) return "A";
  if (v === 13) return "K";
  if (v === 12) return "Q";
  if (v === 11) return "J";
  return String(v);
}
function resolve(a: Card, b: Card): { winner: "a" | "b"; reason: string } {
  const aT = a.suit === "T";
  const bT = b.suit === "T";
  if (aT && bT) return { winner: a.value < b.value ? "a" : "b", reason: "Lower trump wins" };
  if (aT && !bT) {
    if (a.value >= b.value) return { winner: "a", reason: `Trump ${vlabel(a.value)} ≥ beats ${SUIT_NAMES[b.suit]}` };
    return { winner: "b", reason: `${SUIT_NAMES[b.suit]} beats low trump` };
  }
  if (bT && !aT) {
    if (b.value >= a.value) return { winner: "b", reason: `Trump ${vlabel(b.value)} ≥ beats ${SUIT_NAMES[a.suit]}` };
    return { winner: "a", reason: `${SUIT_NAMES[a.suit]} beats low trump` };
  }
  if (a.suit === b.suit) return { winner: a.value > b.value ? "a" : "b", reason: `Higher ${SUIT_NAMES[a.suit]} wins` };
  if (RPS_BEATS[a.suit as "R" | "P" | "S"] === b.suit) return { winner: "a", reason: `${SUIT_NAMES[a.suit]} beats ${SUIT_NAMES[b.suit]}` };
  return { winner: "b", reason: `${SUIT_NAMES[b.suit]} beats ${SUIT_NAMES[a.suit]}` };
}
function activeDrafter(packIndex: number, pickInPack: number): Seat {
  const p1First = packIndex % 2 === 0;
  const evenPick = pickInPack % 2 === 0;
  if (p1First) return evenPick ? "p1" : "p2";
  return evenPick ? "p2" : "p1";
}
function tally(rounds: Round[], who: Seat): number {
  return rounds.filter((r) => r.winner === who).length;
}
function gameWins(rounds: Round[], completedPacks: number): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < completedPacks; i++) {
    const pr = rounds.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
    if (pr.length < HAND_SIZE) break;
    if (tally(pr, "p1") > HAND_SIZE / 2) p1++;
    else p2++;
  }
  return { p1, p2 };
}

// ---- lifecycle ----
export function createInitialState(): GameState {
  const deck = shuffle(buildDeck());
  const packs: Card[][] = [];
  for (let i = 0; i < NUM_PACKS; i++) packs.push(deck.slice(i * PACK_SIZE, (i + 1) * PACK_SIZE));
  return {
    phase: "draft",
    packs,
    packIndex: 0,
    pickInPack: 0,
    hands: { p1: [], p2: [] },
    rounds: [],
    pending: { p1: null, p2: null },
    revealPending: false,
    lastPickId: null,
  };
}

// Seats the game is currently waiting on — drives turn validation and UI gating.
export function expectedActors(s: GameState): Seat[] {
  if (s.phase === "draft") return [activeDrafter(s.packIndex, s.pickInPack)];
  if (s.phase === "play") {
    if (s.revealPending) return ["p1", "p2"];
    return (["p1", "p2"] as Seat[]).filter((seat) => s.pending[seat] === null);
  }
  if (s.phase === "packsummary") return ["p1", "p2"];
  return [];
}

// Apply an action from `seat`. Invalid actions return the state unchanged.
export function reduce(s: GameState, action: Action, seat: Seat): GameState {
  if (!expectedActors(s).includes(seat)) return s;

  if (action.type === "draftPick" && s.phase === "draft") {
    const pack = s.packs[s.packIndex]!;
    const card = pack.find((c) => c.id === action.cardId);
    if (!card) return s;
    s.packs = s.packs.map((p, i) => (i === s.packIndex ? p.filter((c) => c.id !== card.id) : p));
    s.hands[seat] = [...s.hands[seat], card];
    s.lastPickId = card.id;
    s.pickInPack += 1;
    if (s.pickInPack >= PICKS_PER_PACK) {
      s.phase = "play";
      s.pending = { p1: null, p2: null };
      s.revealPending = false;
      s.lastPickId = null; // draft over; no card to flag during play
    }
    return s;
  }

  if (action.type === "selectCard" && s.phase === "play" && !s.revealPending) {
    if (s.pending[seat] !== null) return s;
    const card = s.hands[seat].find((c) => c.id === action.cardId);
    if (!card) return s;
    s.hands[seat] = s.hands[seat].filter((c) => c.id !== card.id);
    s.pending[seat] = card;
    if (s.pending.p1 && s.pending.p2) {
      const res = resolve(s.pending.p1, s.pending.p2);
      s.rounds = [...s.rounds, { p1: s.pending.p1, p2: s.pending.p2, winner: res.winner === "a" ? "p1" : "p2", reason: res.reason }];
      s.revealPending = true;
    }
    return s;
  }

  if (action.type === "advance") {
    if (s.phase === "play" && s.revealPending) {
      s.revealPending = false;
      s.pending = { p1: null, p2: null };
      if (s.hands.p1.length === 0 && s.hands.p2.length === 0) s.phase = "packsummary";
      return s;
    }
    if (s.phase === "packsummary") {
      if (s.packIndex + 1 >= NUM_PACKS) {
        s.phase = "end";
      } else {
        s.packIndex += 1;
        s.pickInPack = 0;
        s.hands = { p1: [], p2: [] };
        s.pending = { p1: null, p2: null };
        s.revealPending = false;
        s.lastPickId = null;
        s.phase = "draft";
      }
      return s;
    }
  }
  return s;
}

// ---- redaction ----
export function viewFor(s: GameState, seat: Seat): View {
  const opp = otherSeat(seat);
  const completed = s.phase === "end" ? NUM_PACKS : s.packIndex;
  const g = gameWins(s.rounds, completed);
  const packRounds = s.rounds.slice(s.packIndex * HAND_SIZE, s.packIndex * HAND_SIZE + HAND_SIZE);
  const waiting = expectedActors(s).includes(seat);

  const v: View = {
    phase: s.phase,
    seat,
    packIndex: s.packIndex,
    packCount: NUM_PACKS,
    rounds: s.rounds,
    games: { you: seat === "p1" ? g.p1 : g.p2, opp: seat === "p1" ? g.p2 : g.p1 },
    turns: { you: tally(s.rounds, seat), opp: tally(s.rounds, opp) },
    packTurns: { you: tally(packRounds, seat), opp: tally(packRounds, opp) },
    yourTurn: waiting,
    hand: s.hands[seat],
    oppHandCount: s.hands[opp].length,
  };

  if (s.phase === "draft") {
    const drafter = activeDrafter(s.packIndex, s.pickInPack);
    v.pack = s.packs[s.packIndex];
    v.activeDrafter = drafter;
    v.youAreDrafter = drafter === seat;
    v.picksLeft = PICKS_PER_PACK - s.pickInPack;
    v.oppHand = s.hands[opp]; // open draft — opponent's hand is public here
    v.lastPickId = s.lastPickId;
  }

  if (s.phase === "play") {
    v.revealPending = s.revealPending;
    v.youSelected = s.pending[seat] !== null;
    v.oppSelected = s.pending[opp] !== null;
    v.yourSelection = s.pending[seat];
    if (s.revealPending) v.lastRound = s.rounds[s.rounds.length - 1];
  }

  if (s.phase === "end") {
    const yg = seat === "p1" ? g.p1 : g.p2;
    const og = seat === "p1" ? g.p2 : g.p1;
    const yt = tally(s.rounds, seat);
    const ot = tally(s.rounds, opp);
    v.winner = yg !== og ? (yg > og ? "you" : "opp") : yt !== ot ? (yt > ot ? "you" : "opp") : "tie";
  }

  return v;
}
