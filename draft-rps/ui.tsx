import { Show, For, createSignal, createMemo, type JSX, type Accessor } from "solid-js";
import { net, sendAction } from "../_play/net";
import type { Card as TCard, Suit, View, Action, Seat } from "./types";
import { SUIT_NAMES, valueLabel, otherSeat } from "./types";
import { createInitialState, reduce, viewFor, expectedActors, type GameState } from "./engine";

const SUITS: Suit[] = ["T", "R", "P", "S"];
type Labels = { you: string; opp: string; youPoss: string; oppPoss: string };

// "You take it" vs "P1 takes it" — second person stays plain, third person gets -s.
function sv(label: string, verb: string): string {
  return label === "You" ? `${label} ${verb}` : `${label} ${verb}s`;
}
function sortCards(a: TCard, b: TCard): number {
  const order: Record<Suit, number> = { T: 0, R: 1, P: 2, S: 3 };
  return order[a.suit] !== order[b.suit] ? order[a.suit] - order[b.suit] : b.value - a.value;
}

// ---- session: the only thing that differs between local and online ----
interface Session {
  view: Accessor<View | null>;
  labels: Accessor<Labels>;
  act: (a: Action) => void;
  pass: Accessor<Seat | null>; // local look-away; always null online
  continuePass: () => void;
  restart: () => void;
  mode: "local" | "online";
  seatNote: Accessor<string>;
}

function onlineSession(): Session {
  return {
    view: () => net.view as View | null,
    labels: () => ({ you: "You", opp: "Opponent", youPoss: "Your", oppPoss: "Opponent's" }),
    act: (a) => sendAction(a as unknown as Record<string, unknown>),
    pass: () => null,
    continuePass: () => {},
    restart: () => {},
    mode: "online",
    seatNote: () => `you are ${net.seat ?? ""}`,
  };
}

// Local pass-and-play: the same engine runs in the browser. The draft is open
// (no look-away); each hidden play-selection is gated behind a pass screen.
function localSession(): Session {
  const [game, setGame] = createSignal(createInitialState());
  const [selector, setSelector] = createSignal<Seat>("p1");
  const [passing, setPassing] = createSignal(false);

  const drafter = () => expectedActors(game())[0] ?? "p1";
  const viewer = (): Seat => {
    const g = game();
    if (g.phase === "draft") return drafter();
    if (g.phase === "play") return selector();
    return "p1";
  };
  const commit = (g: GameState) => setGame({ ...g }); // reduce mutates in place; new ref to notify Solid
  const enterPlayTurn = () => { setSelector("p1"); setPassing(true); };

  function act(a: Action): void {
    const g = game();
    if (a.type === "draftPick") {
      reduce(g, a, drafter());
      commit(g);
      if (g.phase === "play") enterPlayTurn();
    } else if (a.type === "selectCard") {
      const s = selector();
      reduce(g, a, s);
      commit(g);
      if (!g.revealPending) { setSelector(otherSeat(s)); setPassing(true); }
    } else if (a.type === "advance") {
      reduce(g, a, "p1");
      commit(g);
      if (g.phase === "play") enterPlayTurn(); // next turn after a reveal
    }
  }

  return {
    view: () => viewFor(game(), viewer()),
    act,
    labels: () => {
      const me = viewer().toUpperCase();
      const them = otherSeat(viewer()).toUpperCase();
      return { you: me, opp: them, youPoss: `${me}'s`, oppPoss: `${them}'s` };
    },
    pass: () => (game().phase === "play" && !game().revealPending && passing() ? selector() : null),
    continuePass: () => setPassing(false),
    restart: () => { setGame(createInitialState()); setSelector("p1"); setPassing(false); },
    mode: "local",
    seatNote: () => "pass-and-play",
  };
}

// ---- presentational ----
function Card(props: { card: TCard; size?: "xs" | "lg"; clickable?: boolean; dim?: boolean; hl?: boolean; onClick?: () => void }): JSX.Element {
  return (
    <div
      class={`card ${props.size ?? ""} s-${props.card.suit} ${props.clickable ? "clickable" : ""} ${props.dim ? "dim" : ""} ${props.hl ? "hl" : ""}`}
      onClick={() => props.clickable && props.onClick?.()}
    >
      <span class="v">{valueLabel(props.card.value)}</span>
      <span class="s">{SUIT_NAMES[props.card.suit]}</span>
    </div>
  );
}

function HandOverview(props: { cards: TCard[]; label: string; highlightId?: string | null }): JSX.Element {
  return (
    <div style="flex:1;min-width:200px">
      <div class="row" style="margin-bottom:.4rem">
        <span class="lbl">{props.label}</span>
        <span class="mono muted">{props.cards.length} cards</span>
      </div>
      <For each={SUITS}>
        {(s) => {
          // A function, not a const: the SUITS row is built once (SUITS is static),
          // so the per-suit list must stay reactive to track hand growth during the draft.
          const cards = () => props.cards.filter((c) => c.suit === s).sort((a, b) => b.value - a.value);
          return (
            <div class={`handrow s-${s}`}>
              <span class="name">{SUIT_NAMES[s]}</span>
              <div class="cards">
                <Show when={cards().length} fallback={<span class="muted" style="font-style:italic">—</span>}>
                  <For each={cards()}>{(c) => <Card card={c} size="xs" hl={c.id === props.highlightId} />}</For>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function Scoreboard(props: { v: View; labels: Labels }): JSX.Element {
  return (
    <span class="mono muted">
      games {props.v.games.you}–{props.v.games.opp} · turns {props.v.turns.you}–{props.v.turns.opp}
    </span>
  );
}

function PassScreen(props: { to: string; onContinue: () => void }): JSX.Element {
  return (
    <div class="panel" style="text-align:center;min-height:40vh;display:flex;flex-direction:column;justify-content:center">
      <div class="lbl">{props.to === "P1" ? "P2" : "P1"}, look away</div>
      <h1>→ {props.to}</h1>
      <p class="muted">Your opponent shouldn't see the card you pick.</p>
      <div><button class="btn" onClick={props.onContinue}>I'm {props.to}</button></div>
    </div>
  );
}

function Draft(props: { v: View; labels: Labels; act: (a: Action) => void }): JSX.Element {
  const v = () => props.v;
  const header = () =>
    v().youAreDrafter ? sv(props.labels.you, "pick") : `${sv(props.labels.opp, "pick")}…`;
  return (
    <>
      <div class="topbar">
        <div>
          <div class="lbl">Pack {v().packIndex + 1} of {v().packCount} · draft</div>
          <h2>{header()}</h2>
        </div>
        <div style="text-align:right"><div class="lbl">Match</div><Scoreboard v={v()} labels={props.labels} /></div>
      </div>
      <div class="panel">
        <Show
          when={v().youAreDrafter}
          fallback={<p class="waiting">Waiting — {v().picksLeft} pick{v().picksLeft === 1 ? "" : "s"} left in this pack.</p>}
        >
          <div class="lbl" style="margin-bottom:.6rem">Take one — {v().picksLeft} left, then 3 discarded</div>
        </Show>
        <div class="cards">
          <For each={(v().pack ?? []).slice().sort(sortCards)}>
            {(c) => <Card card={c} clickable={v().youAreDrafter} onClick={() => props.act({ type: "draftPick", cardId: c.id })} />}
          </For>
        </div>
      </div>
      <div class="panel" style="display:flex;gap:2rem;flex-wrap:wrap">
        <HandOverview cards={v().hand} label={`${props.labels.youPoss} hand`} highlightId={v().lastPickId} />
        <HandOverview cards={v().oppHand ?? []} label={`${props.labels.oppPoss} hand`} highlightId={v().lastPickId} />
      </div>
    </>
  );
}

function Play(props: { v: View; labels: Labels; act: (a: Action) => void }): JSX.Element {
  const v = () => props.v;
  return (
    <>
      <div class="topbar">
        <div><div class="lbl">Pack {v().packIndex + 1} · play</div><h2>Play a card</h2></div>
        <div style="text-align:right"><div class="lbl">Match</div><Scoreboard v={v()} labels={props.labels} /></div>
      </div>

      <Show
        when={v().revealPending}
        fallback={
          <Show
            when={!v().youSelected}
            fallback={
              <div class="panel" style="text-align:center">
                <p class="waiting">{props.labels.you} played a card. Waiting for {props.labels.opp.toLowerCase()}…</p>
                <Show when={v().yourSelection}>{(c) => <div class="cards center"><Card card={c()} size="lg" /></div>}</Show>
              </div>
            }
          >
            <div class="panel">
              <div class="lbl" style="margin-bottom:.6rem">{props.labels.youPoss} hand — choose one (hidden until both have played)</div>
              <div class="cards center">
                <For each={v().hand.slice().sort(sortCards)}>
                  {(c) => <Card card={c} size="lg" clickable onClick={() => props.act({ type: "selectCard", cardId: c.id })} />}
                </For>
              </div>
            </div>
          </Show>
        }
      >
        {(() => {
          const r = v().lastRound!;
          const me = v().seat;
          const my = me === "p1" ? r.p1 : r.p2;
          const opp = me === "p1" ? r.p2 : r.p1;
          const youWon = r.winner === me;
          const winLabel = youWon ? props.labels.you : props.labels.opp;
          return (
            <div class="panel">
              <h2 style="text-align:center">{sv(winLabel, "take")} it</h2>
              <p class="mono muted" style="text-align:center">{r.reason}</p>
              <div class="reveal">
                <div class="side"><div class="lbl">{props.labels.you}</div><div style="margin-top:.5rem"><Card card={my} size="lg" hl={youWon} dim={!youWon} /></div></div>
                <div class="vs">vs</div>
                <div class="side"><div class="lbl">{props.labels.opp}</div><div style="margin-top:.5rem"><Card card={opp} size="lg" hl={!youWon} dim={youWon} /></div></div>
              </div>
              <div style="text-align:center"><button class="btn" onClick={() => props.act({ type: "advance" })}>Continue</button></div>
            </div>
          );
        })()}
      </Show>

      <div class="panel" style="display:flex;gap:2rem;flex-wrap:wrap;align-items:center">
        <div style="flex:1;min-width:160px"><div class="lbl">This pack</div><div class="mono" style="font-size:1.05rem">{props.labels.you} {v().packTurns.you} · {props.labels.opp} {v().packTurns.opp}</div></div>
        <div><span class="mono muted">{props.labels.opp.toLowerCase()} holds {v().oppHandCount} card{v().oppHandCount === 1 ? "" : "s"}</span></div>
      </div>
    </>
  );
}

function PackSummary(props: { v: View; labels: Labels; act: (a: Action) => void }): JSX.Element {
  const v = () => props.v;
  const youWon = () => v().packTurns.you > v().packTurns.opp;
  const last = () => v().packIndex + 1 >= v().packCount;
  return (
    <div class="panel" style="text-align:center">
      <div class="lbl">Pack {v().packIndex + 1} complete</div>
      <h2>{sv(youWon() ? props.labels.you : props.labels.opp, "win")} the pack {Math.max(v().packTurns.you, v().packTurns.opp)}–{Math.min(v().packTurns.you, v().packTurns.opp)}</h2>
      <div style="margin:.5rem 0 1rem"><Scoreboard v={v()} labels={props.labels} /></div>
      <button class="btn" onClick={() => props.act({ type: "advance" })}>{last() ? "See final result" : `Draft pack ${v().packIndex + 2}`}</button>
    </div>
  );
}

function End(props: { v: View; labels: Labels; session: Session }): JSX.Element {
  const v = () => props.v;
  const title = () =>
    v().winner === "tie" ? "Dead heat" : sv(v().winner === "you" ? props.labels.you : props.labels.opp, "win");
  return (
    <div class="panel" style="text-align:center">
      <div class="lbl">Match over</div>
      <h1>{title()}</h1>
      <div style="margin:.5rem 0 1rem"><Scoreboard v={v()} labels={props.labels} /></div>
      <Show
        when={props.session.mode === "local"}
        fallback={<a class="btn" href="./play.html" style="text-decoration:none;display:inline-block">New room</a>}
      >
        <button class="btn" onClick={props.session.restart}>New match</button>
      </Show>
    </div>
  );
}

function Game(props: { session: Session }): JSX.Element {
  const s = props.session;
  const v = createMemo(() => s.view());
  const labels = createMemo(() => s.labels());
  return (
    <Show when={v()} fallback={<p class="waiting">Loading…</p>}>
      <Show when={s.pass()} fallback={
        <>
          <Show when={v()!.phase === "draft"}><Draft v={v()!} labels={labels()} act={s.act} /></Show>
          <Show when={v()!.phase === "play"}><Play v={v()!} labels={labels()} act={s.act} /></Show>
          <Show when={v()!.phase === "packsummary"}><PackSummary v={v()!} labels={labels()} act={s.act} /></Show>
          <Show when={v()!.phase === "end"}><End v={v()!} labels={labels()} session={s} /></Show>
        </>
      }>
        <PassScreen to={s.pass()!.toUpperCase()} onContinue={s.continuePass} />
      </Show>
      <div style="text-align:center;margin-top:1.5rem"><span class="mono muted">{s.seatNote()}</span></div>
    </Show>
  );
}

export default function DraftRpsBoard(props: { mode: "local" | "online" }): JSX.Element {
  const session = props.mode === "local" ? localSession() : onlineSession();
  return <Game session={session} />;
}
