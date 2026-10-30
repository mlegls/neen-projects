// Server-authoritative Siege engine. The Bun server owns one GameState per room,
// applies validated actions via reduce(), and broadcasts viewFor(seat) — a
// redacted snapshot — to each player. All randomness (deal, dice, first-attacker
// coin flip) happens here, never on a client. The same engine also runs in the
// browser for local pass-and-play; only the session wrapper differs.

import type { Action, CastleView, Color, ColCard, LastResult, PlaySub, Seat, SiegeView, Suit, ViewCard } from "./types";
import { otherSeat } from "./types";

const COLS = 4;
const ROWS = 6;
const RED_SUITS: Suit[] = ["H", "D"];
const BLACK_SUITS: Suit[] = ["S", "C"];

interface Player {
  color: Color;
  columns: ColCard[][]; // 4 columns, index 0 = foundation once placed, top = last
  captured: number[];
}

export interface GameState {
  phase: "setup" | "play" | "end";
  players: Record<Seat, Player>;
  placed: Record<Seat, boolean>;
  turn: Seat;
  playSub: PlaySub;
  targetCol: number | null;
  bonus: number;
  pairUsed: boolean;
  reinforceRank: number | null;
  dice: [number, number] | null;
  last: LastResult | null;
  winner: Seat | null;
  rf: number; // reinforce id counter (kept in state so it serializes cleanly)
}

// ---- pure rules (mirrors the original hot-seat build) ----
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
function rollDie(): number {
  return 1 + Math.floor(Math.random() * 6);
}
// Each castle is built from one colour's 24 cards: two of every rank A..Q, one
// in each of that colour's two suits (no kings — those are foundations).
function buildColorDeck(color: Color): ColCard[] {
  const suits = color === "red" ? RED_SUITS : BLACK_SUITS;
  const deck: ColCard[] = [];
  for (const suit of suits) {
    for (let r = 1; r <= 12; r++) {
      deck.push({ kind: "card", rank: r, suit, color, faceUp: false, row: 0, id: `${suit}${r}` });
    }
  }
  return deck;
}
// Deal 24 cards into 4 columns of 6 rows. Row 1 (bottom) face-down, alternating,
// so the top (row 6) is face-up. Foundation is unshifted later, at placement.
function dealCastle(cards: ColCard[]): ColCard[][] {
  const cols: ColCard[][] = [[], [], [], []];
  let k = 0;
  for (let row = 1; row <= ROWS; row++) {
    const faceUp = row % 2 === 0;
    for (let c = 0; c < COLS; c++) {
      const card = cards[k++]!;
      card.faceUp = faceUp;
      card.row = row;
      cols[c]!.push(card);
    }
  }
  return cols;
}
function topCard(col: ColCard[]): ColCard {
  return col[col.length - 1]!;
}
function isCleared(col: ColCard[]): boolean {
  return col.length === 1; // only the foundation remains
}
function kingColsCleared(p: Player): number {
  return p.columns.filter((c) => c[0]!.kind === "king" && isCleared(c)).length;
}
// Face-down cards stay hidden when sieged — the defender only says hit or miss.
// But once 2+ live columns expose the same hidden row, those aligned face-down
// tops flip face-up for everyone. Returns how many were newly revealed.
function revealAlignedRows(p: Player): number {
  const byRow = new Map<number, ColCard[]>();
  for (const col of p.columns) {
    if (isCleared(col)) continue;
    const t = topCard(col);
    if (t.kind === "card" && !t.faceUp && t.row > 0) {
      const g = byRow.get(t.row) ?? [];
      g.push(t);
      byRow.set(t.row, g);
    }
  }
  let revealed = 0;
  for (const cards of byRow.values()) {
    if (cards.length >= 2) for (const c of cards) { c.faceUp = true; revealed++; }
  }
  return revealed;
}
function counts(ranks: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of ranks) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}
export function usablePairs(captured: number[]): number[] {
  return [...counts(captured).entries()]
    .filter(([, n]) => n >= 2)
    .map(([r]) => r)
    .sort((a, b) => b - a);
}
function removeTwo(arr: number[], rank: number): void {
  let removed = 0;
  for (let i = arr.length - 1; i >= 0 && removed < 2; i--) {
    if (arr[i] === rank) {
      arr.splice(i, 1);
      removed++;
    }
  }
}

// ---- lifecycle ----
export function createInitialState(): GameState {
  const p1: Player = { color: "red", columns: dealCastle(shuffle(buildColorDeck("red"))), captured: [] };
  const p2: Player = { color: "black", columns: dealCastle(shuffle(buildColorDeck("black"))), captured: [] };
  return {
    phase: "setup",
    players: { p1, p2 },
    placed: { p1: false, p2: false },
    turn: "p1",
    playSub: "choose",
    targetCol: null,
    bonus: 0,
    pairUsed: false,
    reinforceRank: null,
    dice: null,
    last: null,
    winner: null,
    rf: 0,
  };
}

// Seats the game is waiting on. In setup both place simultaneously (each until
// they confirm); in play only the active attacker acts — the defender watches.
export function expectedActors(s: GameState): Seat[] {
  if (s.phase === "setup") return (["p1", "p2"] as Seat[]).filter((seat) => !s.placed[seat]);
  if (s.phase === "play") return [s.turn];
  return [];
}

export function reduce(s: GameState, a: Action, seat: Seat): GameState {
  if (!expectedActors(s).includes(seat)) return s;

  if (s.phase === "setup") {
    if (a.type !== "place") return s;
    const cols = [...new Set(a.cols)].filter((c) => c >= 0 && c < COLS);
    if (cols.length !== 2) return s;
    const p = s.players[seat];
    const kingSuits = p.color === "red" ? RED_SUITS : BLACK_SUITS;
    let kingN = 0;
    p.columns.forEach((col, i) => {
      const isKing = cols.includes(i);
      const foundation: ColCard = isKing
        ? { kind: "king", rank: 13, suit: kingSuits[kingN++] ?? null, color: p.color, faceUp: false, row: 0, id: `K${seat}${i}` }
        : { kind: "joker", rank: 0, suit: null, color: p.color, faceUp: false, row: 0, id: `J${seat}${i}` };
      col.unshift(foundation);
    });
    s.placed[seat] = true;
    if (s.placed.p1 && s.placed.p2) {
      s.turn = rollDie() % 2 === 0 ? "p1" : "p2"; // coin-flip the first attacker
      s.phase = "play";
      s.playSub = "choose";
    }
    return s;
  }

  if (s.phase !== "play") return s;
  const def = s.players[otherSeat(seat)];
  const me = s.players[seat];

  switch (a.type) {
    case "aim": {
      if (s.playSub !== "choose" || a.col < 0 || a.col >= COLS) return s;
      if (isCleared(def.columns[a.col]!)) return s;
      s.targetCol = a.col;
      s.playSub = "ready";
      return s;
    }
    case "unaim":
      if (s.playSub !== "ready") return s;
      s.targetCol = null;
      s.playSub = "choose";
      return s;
    case "openPair":
      if (s.playSub !== "choose" || s.pairUsed || usablePairs(me.captured).length === 0) return s;
      s.playSub = "pair";
      return s;
    case "cancelPair":
      if (s.playSub !== "pair" && s.playSub !== "reinforce") return s;
      s.playSub = "choose";
      s.reinforceRank = null;
      return s;
    case "batter":
      if (s.playSub !== "pair" || s.pairUsed || !usablePairs(me.captured).includes(a.rank)) return s;
      removeTwo(me.captured, a.rank);
      s.bonus += a.rank - 3;
      s.pairUsed = true;
      s.playSub = "choose";
      return s;
    case "beginReinforce":
      if (s.playSub !== "pair" || s.pairUsed || !usablePairs(me.captured).includes(a.rank)) return s;
      s.reinforceRank = a.rank;
      s.playSub = "reinforce";
      return s;
    case "reinforce": {
      if (s.playSub !== "reinforce" || s.reinforceRank == null || a.col < 0 || a.col >= COLS) return s;
      const rank = s.reinforceRank;
      removeTwo(me.captured, rank);
      me.columns[a.col]!.push({ kind: "card", rank, suit: null, color: me.color, faceUp: true, row: -1, id: `rf${seat}${s.rf++}` });
      s.pairUsed = true;
      s.reinforceRank = null;
      s.playSub = "choose";
      return s;
    }
    case "roll": {
      if (s.playSub !== "ready" || s.targetCol == null) return s;
      const ci = s.targetCol;
      const col = def.columns[ci]!;
      if (isCleared(col)) return s;
      const top = topCard(col);
      const d1 = rollDie();
      const d2 = rollDie();
      const doubles = d1 === d2;
      let total = d1 + d2;
      if (doubles) total *= 2;
      total += s.bonus;
      const target = top.rank;
      const success = total >= target;
      let revealed = 0;
      if (success) {
        col.pop();
        me.captured.push(top.rank);
        if (isCleared(col)) col[0]!.faceUp = true; // expose breached foundation
        revealed = revealAlignedRows(def);
      }
      s.dice = [d1, d2];
      s.last = {
        attacker: me.color,
        col: ci,
        d1,
        d2,
        doubles,
        bonus: s.bonus,
        total,
        target,
        blind: !top.faceUp,
        success,
        foundation: isCleared(col) ? col[0]!.kind : null,
        revealed,
      };
      if (kingColsCleared(def) === 2) {
        s.winner = seat;
        s.phase = "end";
      } else {
        s.playSub = "resolve";
      }
      return s;
    }
    case "endTurn":
      if (s.playSub !== "resolve") return s;
      s.turn = otherSeat(seat);
      s.targetCol = null;
      s.bonus = 0;
      s.pairUsed = false;
      s.reinforceRank = null;
      s.dice = null;
      s.playSub = "choose";
      return s;
  }
  return s;
}

// ---- redaction ----
function redactCard(c: ColCard): ViewCard {
  const foundation = c.row === 0; // foundations placed with row 0; walls 1..6; reinforced -1
  if (c.faceUp) return { id: c.id, shown: true, foundation, color: c.color, kind: c.kind, rank: c.rank, suit: c.suit };
  return { id: c.id, shown: false, foundation, color: c.color };
}
function redactCastle(p: Player): CastleView {
  return {
    color: p.color,
    columns: p.columns.map((col) => col.map(redactCard)),
    captured: [...p.captured],
    kingsDown: kingColsCleared(p),
  };
}

export function viewFor(s: GameState, seat: Seat): SiegeView {
  const opp = otherSeat(seat);
  const me = s.players[seat];
  const them = s.players[opp];
  const v: SiegeView = {
    phase: s.phase,
    seat,
    youColor: me.color,
    oppColor: them.color,
    you: redactCastle(me),
    enemy: redactCastle(them),
    yourTurn: expectedActors(s).includes(seat),
  };
  if (s.phase === "setup") {
    v.youPlaced = s.placed[seat];
    v.oppPlaced = s.placed[opp];
  } else if (s.phase === "play") {
    v.turnColor = s.players[s.turn].color;
    v.playSub = s.playSub;
    v.targetCol = s.targetCol;
    v.bonus = s.bonus;
    v.pairUsed = s.pairUsed;
    v.reinforceRank = s.reinforceRank;
    v.dice = s.dice;
    v.last = s.last;
  } else if (s.phase === "end") {
    v.winner = s.winner === seat ? "you" : "opp";
    v.winnerColor = s.winner ? s.players[s.winner].color : me.color;
    v.last = s.last;
  }
  return v;
}
