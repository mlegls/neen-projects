// Shared Draft RPS types. Pure data — safe to import from both the Bun server
// (authority) and the Solid client (which imports types + label helpers only;
// all game logic stays server-side, so none of engine.ts ships to the browser).

export type Suit = "T" | "R" | "P" | "S";
export type Seat = "p1" | "p2";

export interface Card {
  suit: Suit;
  value: number; // 2..14
  id: string;
}

export interface Round {
  p1: Card;
  p2: Card;
  winner: Seat;
  reason: string;
}

export type Action =
  | { type: "draftPick"; cardId: string }
  | { type: "selectCard"; cardId: string }
  | { type: "advance" };

export type Phase = "draft" | "play" | "packsummary" | "end";

// The redacted, per-seat snapshot the client renders. Never contains the
// opponent's hidden play-selection; the opponent's hand is withheld during play
// (you're meant to remember it) but shown openly during the draft.
export interface View {
  phase: Phase;
  seat: Seat;
  packIndex: number;
  packCount: number;
  rounds: Round[]; // cumulative, public
  games: { you: number; opp: number };
  turns: { you: number; opp: number };
  packTurns: { you: number; opp: number };
  yourTurn: boolean; // is the game waiting on an action from you?
  // draft
  pack?: Card[];
  activeDrafter?: Seat;
  picksLeft?: number;
  youAreDrafter?: boolean;
  lastPickId?: string | null; // most recently drafted card, highlighted in the open hands
  // hands
  hand: Card[]; // your hand
  oppHand?: Card[]; // present only in the open draft
  oppHandCount: number;
  // play
  youSelected?: boolean;
  oppSelected?: boolean;
  yourSelection?: Card | null;
  revealPending?: boolean;
  lastRound?: Round;
  // end
  winner?: "you" | "opp" | "tie";
}

export const SUIT_NAMES: Record<Suit, string> = { R: "ROCK", P: "PAPER", S: "SCISSORS", T: "TRUMP" };

export function valueLabel(v: number): string {
  if (v === 14) return "A";
  if (v === 13) return "K";
  if (v === 12) return "Q";
  if (v === 11) return "J";
  return String(v);
}

export function otherSeat(s: Seat): Seat {
  return s === "p1" ? "p2" : "p1";
}
