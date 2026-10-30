// Shared Siege types. Pure data — imported by both the Bun server (authority)
// and the Solid client. Siege has more hidden information than Draft RPS: the
// king/joker placement is secret, and face-down wall cards are hidden from BOTH
// players (they're dealt/placed face-down, never seen until exposed). So the
// redaction is symmetric — a face-down card is a back to everyone, and a
// foundation only reveals its kind once its column is fully cleared.

export type Seat = "p1" | "p2";
export type Color = "red" | "black";
export type Suit = "S" | "H" | "D" | "C";
export type Kind = "card" | "king" | "joker";

export interface ColCard {
  kind: Kind;
  rank: number; // 1..12 walls, 13 king, 0 joker
  suit: Suit | null;
  color: Color;
  faceUp: boolean;
  row: number; // dealt row 1..6, foundation 0, reinforced -1 — drives row alignment
  id: string;
}

export interface LastResult {
  attacker: Color;
  col: number;
  d1: number;
  d2: number;
  doubles: boolean;
  bonus: number;
  total: number;
  target: number;
  blind: boolean; // the besieged card was face-down
  success: boolean;
  foundation: Kind | null; // revealed foundation kind if the column just cleared
  revealed: number; // face-down tops flipped by row alignment
}

export type PlaySub = "choose" | "ready" | "pair" | "reinforce" | "resolve";

export type Action =
  | { type: "place"; cols: number[] } // setup: the two columns that hide kings
  | { type: "aim"; col: number }
  | { type: "unaim" }
  | { type: "roll" }
  | { type: "openPair" }
  | { type: "cancelPair" }
  | { type: "batter"; rank: number }
  | { type: "beginReinforce"; rank: number }
  | { type: "reinforce"; col: number }
  | { type: "endTurn" };

// A redacted card in the view. When `shown` is false the client renders a back
// and never learns rank/suit/kind — this is how face-down walls and unbreached
// foundations stay secret. `foundation` is a styling/structure hint and leaks
// nothing (everyone can see which slot is the foundation, just not what it is).
export interface ViewCard {
  id: string;
  shown: boolean;
  foundation: boolean;
  color: Color;
  kind?: Kind;
  rank?: number;
  suit?: Suit | null;
}

export interface CastleView {
  color: Color;
  columns: ViewCard[][];
  captured: number[]; // captured cards lie face-up — public knowledge
  kingsDown: number;
}

export interface SiegeView {
  phase: "setup" | "play" | "end";
  seat: Seat;
  youColor: Color;
  oppColor: Color;
  you: CastleView;
  enemy: CastleView;
  yourTurn: boolean; // is the game waiting on an action from you?
  // setup
  youPlaced?: boolean;
  oppPlaced?: boolean;
  // play
  turnColor?: Color;
  playSub?: PlaySub;
  targetCol?: number | null;
  bonus?: number;
  pairUsed?: boolean;
  reinforceRank?: number | null;
  dice?: [number, number] | null;
  last?: LastResult | null;
  // end
  winner?: "you" | "opp";
  winnerColor?: Color;
}

export const SUIT_SYM: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_COLOR: Record<Suit, Color> = { S: "black", C: "black", H: "red", D: "red" };

export function rankLabel(r: number): string {
  if (r === 1) return "A";
  if (r === 11) return "J";
  if (r === 12) return "Q";
  if (r === 13) return "K";
  return String(r);
}

export function otherSeat(s: Seat): Seat {
  return s === "p1" ? "p2" : "p1";
}
