import { createStore } from "solid-js/store";

// Game-agnostic WebSocket client + reactive store. The server is authoritative;
// we send actions and render whatever redacted `view` it sends back. `view` is
// game-specific JSON, kept untyped here so net.ts stays game-agnostic.
export interface NetState {
  status: "idle" | "connecting" | "open" | "closed";
  game: string | null;
  code: string | null;
  seat: string | null;
  players: number; // seats filled
  view: any | null;
  error: string | null;
}

const [net, setNet] = createStore<NetState>({
  status: "idle",
  game: null,
  code: null,
  seat: null,
  players: 0,
  view: null,
  error: null,
});

// Each room is its own server-side object, so a socket belongs to one room:
// opened with ?create to have a room allocated, or ?room=CODE to join one.
let ws: WebSocket | null = null;
let wsQuery = "";
const outbox: string[] = [];

function wsUrl(query: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?${query}`;
}

function tokenKey(code: string): string {
  return `siege-room:${code}`;
}

function send(msg: Record<string, unknown>): void {
  const s = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
  else outbox.push(s);
}

function closeSocket(): void {
  if (!ws) return;
  ws.onclose = null;
  ws.close();
  ws = null;
  outbox.length = 0;
}

function ensureSocket(query: string): void {
  if (ws && wsQuery === query && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  closeSocket();
  setNet("status", "connecting");
  wsQuery = query;
  ws = new WebSocket(wsUrl(query));
  ws.onopen = () => {
    setNet("status", "open");
    while (outbox.length) ws!.send(outbox.shift()!);
  };
  ws.onclose = () => {
    setNet("status", "closed");
    ws = null;
  };
  ws.onmessage = (e) => {
    let msg: any;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handle(msg);
  };
}

function handle(msg: any): void {
  switch (msg.t) {
    case "joined":
      setNet({ game: msg.game, code: msg.code, seat: msg.seat, error: null });
      wsQuery = `room=${msg.code}`; // a created room's socket is now that room's
      if (msg.token) localStorage.setItem(tokenKey(msg.code), JSON.stringify({ seat: msg.seat, token: msg.token }));
      break;
    case "peers":
      setNet("players", msg.players);
      break;
    case "state":
      setNet({ view: msg.view, players: msg.players ?? net.players });
      break;
    case "error":
      setNet("error", msg.msg ?? "error");
      break;
  }
}

export function createRoom(game: string): void {
  ensureSocket("create");
  setNet({ error: null, view: null });
  send({ t: "create", game });
}

export function joinRoom(game: string, code: string): void {
  ensureSocket(`room=${encodeURIComponent(code.toUpperCase())}`);
  setNet({ error: null });
  const saved = localStorage.getItem(tokenKey(code));
  const token = saved ? JSON.parse(saved).token : undefined;
  send({ t: "join", game, code: code.toUpperCase(), token });
}

export function sendAction(action: Record<string, unknown>): void {
  send({ t: "action", action });
}

export function leave(): void {
  closeSocket();
  setNet({ status: "idle", code: null, seat: null, view: null, players: 0, error: null });
}

export { net };
