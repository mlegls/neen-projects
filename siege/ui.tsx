import { Show, Switch, Match, For, createSignal, createMemo, type JSX, type Accessor } from "solid-js";
import { net, sendAction } from "../_play/net";
import type { Action, Color, Seat, SiegeView, ViewCard } from "./types";
import { SUIT_SYM, SUIT_COLOR, rankLabel, otherSeat } from "./types";
import { createInitialState, reduce, viewFor, usablePairs, type GameState } from "./engine";

// ---- session: the only thing that differs between local and online ----
interface Session {
  view: Accessor<SiegeView | null>;
  act: (a: Action) => void;
  pass: Accessor<Color | null>; // setup look-away; always null online
  continuePass: () => void;
  restart: () => void;
  mode: "local" | "online";
  seatNote: Accessor<string>;
}

function onlineSession(): Session {
  return {
    view: () => net.view as SiegeView | null,
    act: (a) => sendAction(a as unknown as Record<string, unknown>),
    pass: () => null,
    continuePass: () => {},
    restart: () => {},
    mode: "online",
    seatNote: () => `you are ${(net.view as SiegeView | null)?.youColor ?? net.seat ?? ""}`,
  };
}

// Local pass-and-play: the same engine runs in the browser. Kings are placed in
// secret, so placement is gated behind look-away pass screens — but Siege has no
// hidden hand during play, so once the kings are down both players watch one
// shared board and no pass screen is needed between turns.
function localSession(): Session {
  const [game, setGame] = createSignal(createInitialState());
  const [placer, setPlacer] = createSignal<Seat>("p1");
  const [passing, setPassing] = createSignal(true);
  const viewer = () => (game().phase === "setup" ? placer() : game().turn);
  const commit = (g: GameState) => setGame({ ...g }); // reduce mutates in place; new ref notifies Solid

  function act(a: Action): void {
    const g = game();
    if (g.phase === "setup") {
      if (a.type !== "place") return;
      reduce(g, a, placer());
      commit(g);
      if (g.phase === "setup") { setPlacer(otherSeat(placer())); setPassing(true); }
      return;
    }
    reduce(g, a, g.turn); // every play action belongs to the active seat
    commit(g);
  }

  return {
    view: () => viewFor(game(), viewer()),
    act,
    pass: () => {
      const g = game();
      return g.phase === "setup" && passing() && !g.placed[placer()] ? g.players[placer()].color : null;
    },
    continuePass: () => setPassing(false),
    restart: () => { setGame(createInitialState()); setPlacer("p1"); setPassing(true); },
    mode: "local",
    seatNote: () => "pass-and-play",
  };
}

// ---- presentational ----
function Ccard(props: { c: ViewCard; top?: boolean; aim?: boolean; clickable?: boolean; onClick?: () => void }): JSX.Element {
  const c = () => props.c;
  return (
    <Show
      when={c().shown}
      fallback={
        <div
          class={`ccard back ${props.top ? "top" : ""} ${props.aim ? "aim" : ""} ${props.clickable ? "clickable" : ""}`}
          onClick={props.clickable ? () => props.onClick?.() : undefined}
        >
          <span class="back-mark" />
        </div>
      }
    >
      <Switch>
        <Match when={c().kind === "king"}>
          <div class={`ccard king ${c().color}`}><span class="cv">K</span><span class="cs">{c().suit ? SUIT_SYM[c().suit!] : ""}</span></div>
        </Match>
        <Match when={c().kind === "joker"}>
          <div class={`ccard joker ${c().color}`}><span class="cv jk">JOKER</span></div>
        </Match>
        <Match when={c().kind === "card"}>
          <div
            class={`ccard ${c().suit ? SUIT_COLOR[c().suit!] : "neutral"} ${props.top ? "top" : ""} ${props.aim ? "aim" : ""} ${props.clickable ? "clickable" : ""}`}
            onClick={props.clickable ? () => props.onClick?.() : undefined}
          >
            <span class="cv">{rankLabel(c().rank!)}</span>
            {c().suit ? <span class="cs">{SUIT_SYM[c().suit!]}</span> : null}
          </div>
        </Match>
      </Switch>
    </Show>
  );
}

function Column(props: {
  col: ViewCard[];
  idx: number;
  aimCol?: number | null;
  onAim?: (i: number) => void;
  selectable?: boolean;
  selected?: boolean;
  onCol?: (i: number) => void;
}): JSX.Element {
  const wall = () => props.col.filter((c) => !c.foundation).length;
  const hasFoundation = () => props.col.some((c) => c.foundation);
  const cleared = () => hasFoundation() && wall() === 0;
  const foundationCard = () => props.col.find((c) => c.foundation);
  const cards = () => [...props.col].reverse(); // render top-first
  return (
    <div
      class={`col ${cleared() ? "cleared" : ""} ${props.selectable ? "selectable" : ""} ${props.selected ? "selected" : ""}`}
      onClick={() => props.onCol?.(props.idx)}
    >
      <For each={cards()}>
        {(c, i) => {
          const isTop = () => i() === 0 && !cleared() && !c.foundation;
          return (
            <Ccard
              c={c}
              top={isTop()}
              aim={isTop() && props.aimCol === props.idx}
              clickable={isTop() && !!props.onAim}
              onClick={() => props.onAim?.(props.idx)}
            />
          );
        }}
      </For>
      <Show when={cleared()} fallback={<div class="col-badge muted">{wall()}</div>}>
        <div class={`col-badge ${foundationCard()?.kind ?? "muted"}`}>
          {foundationCard()?.kind === "king" ? "KING ✓" : "decoy"}
        </div>
      </Show>
    </div>
  );
}

function Castle(props: {
  castle: SiegeView["you"];
  title: string;
  aimCol?: number | null;
  onAim?: (i: number) => void;
  onCol?: (i: number) => void;
  pickable?: boolean;
}): JSX.Element {
  return (
    <div class="castle-wrap">
      <div class="castle-label">
        <span class="lbl">{props.title}</span>
        <span class="mono muted">{props.castle.kingsDown}/2 kings down</span>
      </div>
      <div class="castle">
        <For each={props.castle.columns}>
          {(col, i) => (
            <Column
              col={col}
              idx={i()}
              aimCol={props.aimCol}
              onAim={props.onAim}
              selectable={props.pickable}
              onCol={props.onCol}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function PassScreen(props: { color: Color; onContinue: () => void }): JSX.Element {
  const TO = () => props.color.toUpperCase();
  const OTHER = () => (props.color === "red" ? "BLACK" : "RED");
  return (
    <div class="panel pass">
      <div class="lbl">{OTHER()}, look away</div>
      <h1>→ {TO()}</h1>
      <p class="muted">Place your two kings in secret. The other two columns get joker decoys.</p>
      <div class="spacer" />
      <div><button class="btn" onClick={props.onContinue}>I'm {TO()}</button></div>
    </div>
  );
}

function Setup(props: { v: SiegeView; act: (a: Action) => void }): JSX.Element {
  const [sel, setSel] = createSignal<number[]>([]);
  const v = () => props.v;
  const toggle = (i: number) => {
    const cur = sel();
    if (cur.includes(i)) setSel(cur.filter((x) => x !== i));
    else if (cur.length < 2) setSel([...cur, i]);
  };
  return (
    <Show
      when={!v().youPlaced}
      fallback={<div class="panel"><p class="waiting">Placement set. Waiting for your opponent to place their kings…</p></div>}
    >
      <div class="lbl">{v().youColor.toUpperCase()} · place your kings</div>
      <h2>Pick 2 columns to hide your kings</h2>
      <p class="muted">Defend your strongest columns — or bluff. The other two become decoys.</p>
      <div class="panel">
        <div class="castle">
          <For each={v().you.columns}>
            {(col, i) => <Column col={col} idx={i()} selectable selected={sel().includes(i())} onCol={toggle} />}
          </For>
        </div>
      </div>
      <div class="mono muted">{sel().length}/2 chosen</div>
      <div class="spacer" />
      <button class="btn" disabled={sel().length !== 2} onClick={() => props.act({ type: "place", cols: sel() })}>
        {sel().length === 2 ? "Confirm placement" : "Pick 2 columns"}
      </button>
    </Show>
  );
}

function ResultBlock(props: { v: SiegeView }): JSX.Element {
  return (
    <Show when={props.v.last}>
      {(get) => {
        const r = () => get();
        const dice = () => `${r().d1},${r().d2}${r().doubles ? " ×2" : ""}`;
        const bonus = () => (r().bonus ? ` ${r().bonus > 0 ? "+" : ""}${r().bonus}` : "");
        const tgt = () => (r().blind && !r().success ? "?" : rankLabel(r().target));
        const verb = () => (r().success ? `captured ${rankLabel(r().target)}` : "repelled");
        const breach = () => (r().foundation === "king" ? " — KING exposed!" : r().foundation === "joker" ? " — only a decoy" : "");
        const flip = () => (r().revealed >= 2 ? ` · row aligned: ${r().revealed} cards flipped up` : "");
        return (
          <>
            <Show when={props.v.dice}>
              {(d) => (
                <div class="dice">
                  <span class={`die${r().doubles ? " dbl" : ""}`}>{d()[0]}</span>
                  <span class={`die${r().doubles ? " dbl" : ""}`}>{d()[1]}</span>
                </div>
              )}
            </Show>
            <div class={`mono result ${r().success ? "win" : "fail"}`}>
              {r().attacker.toUpperCase()} → col {r().col + 1}: {dice()}{bonus()} = {r().total} vs {tgt()} — {verb()}{breach()}{flip()}
            </div>
          </>
        );
      }}
    </Show>
  );
}

function watchingHint(v: SiegeView): string {
  const who = (v.turnColor ?? v.oppColor).toUpperCase();
  switch (v.playSub) {
    case "choose": return `${who} is choosing a column to siege…`;
    case "ready": return `${who} is aiming at your column ${(v.targetCol ?? 0) + 1}…`;
    case "pair":
    case "reinforce": return `${who} is spending a captured pair…`;
    case "resolve": return `${who}'s siege:`;
    default: return `${who}'s turn`;
  }
}

function Controls(props: { v: SiegeView; act: (a: Action) => void }): JSX.Element {
  const v = () => props.v;
  const act = props.act;
  const pairs = () => usablePairs(v().you.captured);
  const readyTop = () => {
    const col = v().enemy.columns[v().targetCol ?? 0];
    const top = col?.[col.length - 1];
    if (!top) return "a card";
    return top.shown ? `${rankLabel(top.rank!)}${top.suit ? SUIT_SYM[top.suit] : ""}` : "a face-down card";
  };
  return (
    <Show
      when={v().yourTurn}
      fallback={
        <div class="controls">
          <p class="hint muted">{watchingHint(v())}</p>
          <Show when={v().playSub === "resolve"}><ResultBlock v={v()} /></Show>
        </div>
      }
    >
      <Switch>
        <Match when={v().playSub === "choose"}>
          <div class="controls">
            <p class="muted hint">Click the top card of an enemy column to aim.</p>
            <Show when={!v().pairUsed} fallback={<span class="mono muted">pair power used this turn</span>}>
              <Show when={pairs().length} fallback={<span class="mono muted">no pairs captured yet</span>}>
                <button class="btn sm" onClick={() => act({ type: "openPair" })}>Use a pair ({pairs().map(rankLabel).join(", ")})</button>
              </Show>
            </Show>
          </div>
        </Match>
        <Match when={v().playSub === "ready"}>
          <div class="controls">
            <p class="hint">Sieging column {(v().targetCol ?? 0) + 1} — top is {readyTop()}.</p>
            <div class="btnrow">
              <button class="btn" onClick={() => act({ type: "roll" })}>Roll 2d6{v().bonus ? ` ${v().bonus! > 0 ? "+" : ""}${v().bonus}` : ""}</button>
              <button class="btn sm" onClick={() => act({ type: "unaim" })}>Aim elsewhere</button>
            </div>
          </div>
        </Match>
        <Match when={v().playSub === "pair"}>
          <div class="controls">
            <p class="hint">Spend a pair (once per turn):</p>
            <For each={pairs()}>
              {(r) => (
                <div class="pair-row">
                  <span class="mono pair-name">pair of {rankLabel(r)}</span>
                  <button class="btn sm" onClick={() => act({ type: "batter", rank: r })}>+{r - 3} to a roll</button>
                  <button class="btn sm" onClick={() => act({ type: "beginReinforce", rank: r })}>reinforce a column</button>
                </div>
              )}
            </For>
            <button class="linkbtn" onClick={() => act({ type: "cancelPair" })}>never mind</button>
          </div>
        </Match>
        <Match when={v().playSub === "reinforce"}>
          <div class="controls">
            <p class="hint">Click one of YOUR columns to add a {rankLabel(v().reinforceRank ?? 0)} on top.</p>
            <button class="linkbtn" onClick={() => act({ type: "cancelPair" })}>never mind</button>
          </div>
        </Match>
        <Match when={v().playSub === "resolve"}>
          <div class="controls">
            <ResultBlock v={v()} />
            <div class="spacer-sm" />
            <button class="btn" onClick={() => act({ type: "endTurn" })}>End turn</button>
          </div>
        </Match>
      </Switch>
    </Show>
  );
}

// Captured cards are public — each player's pile of the opponent-coloured cards
// they've taken. Shown as ranks (a pile reveals its own pairs at a glance).
function Captured(props: { ranks: number[]; cardColor: Color; label: string }): JSX.Element {
  return (
    <Show when={props.ranks.length}>
      <div class="captured">
        <span class="lbl">{props.label}</span>
        <div class="cap-row">
          <For each={[...props.ranks].sort((a, b) => a - b)}>
            {(r) => <span class={`cap-card ${props.cardColor}`}>{rankLabel(r)}</span>}
          </For>
        </div>
      </div>
    </Show>
  );
}

function PlayScreen(props: { v: SiegeView; act: (a: Action) => void }): JSX.Element {
  const v = () => props.v;
  const mine = () => v().yourTurn;
  const canAim = () => mine() && v().playSub === "choose";
  const canReinforce = () => mine() && v().playSub === "reinforce";
  return (
    <>
      <div class="topbar">
        <div>
          <div class="lbl">{(v().turnColor ?? v().youColor).toUpperCase()}'s turn</div>
          <div class="mono muted">{mine() ? `siege ${v().oppColor.toUpperCase()}'s castle` : `${(v().turnColor ?? v().oppColor).toUpperCase()} is besieging you`}</div>
        </div>
        <div class="topbar-right">
          <Show when={v().bonus}><span class="mono">roll bonus {v().bonus! > 0 ? "+" : ""}{v().bonus}</span></Show>
        </div>
      </div>

      <Castle
        castle={v().enemy}
        title={`${v().oppColor.toUpperCase()}${mine() ? " — under siege" : ""}`}
        aimCol={mine() ? v().targetCol : null}
        onAim={canAim() ? (i) => props.act({ type: "aim", col: i }) : undefined}
      />
      <Captured ranks={v().enemy.captured} cardColor={v().youColor} label={`${v().oppColor.toUpperCase()} captured`} />

      <div class="controls-panel panel"><Controls v={v()} act={props.act} /></div>

      <Castle
        castle={v().you}
        title={`${v().youColor.toUpperCase()} — your castle${!mine() ? " — under siege" : ""}`}
        aimCol={!mine() ? v().targetCol : null}
        pickable={canReinforce()}
        onCol={canReinforce() ? (i) => props.act({ type: "reinforce", col: i }) : undefined}
      />
      <Captured ranks={v().you.captured} cardColor={v().oppColor} label={`${v().youColor.toUpperCase()} captured`} />
    </>
  );
}

function EndScreen(props: { v: SiegeView; session: Session }): JSX.Element {
  const v = () => props.v;
  return (
    <div class="panel" style="text-align:center">
      <div class="lbl">The castle has fallen</div>
      <h1>{(v().winnerColor ?? v().youColor).toUpperCase()} wins</h1>
      <p class="muted">{(v().winnerColor ?? v().youColor).toUpperCase()} breached both hidden king columns.</p>
      <ResultBlock v={v()} />
      <div class="spacer" />
      <Show
        when={props.session.mode === "local"}
        fallback={<a class="btn" href="./play.html" style="text-decoration:none;display:inline-block">New room</a>}
      >
        <button class="btn" onClick={props.session.restart}>New game</button>
      </Show>
    </div>
  );
}

function Game(props: { session: Session }): JSX.Element {
  const s = props.session;
  const v = createMemo(() => s.view());
  return (
    <Show when={v()} fallback={<p class="waiting">Loading…</p>}>
      <Show when={s.pass()} fallback={
        <Switch>
          <Match when={v()!.phase === "setup"}><Setup v={v()!} act={s.act} /></Match>
          <Match when={v()!.phase === "play"}><PlayScreen v={v()!} act={s.act} /></Match>
          <Match when={v()!.phase === "end"}><EndScreen v={v()!} session={s} /></Match>
        </Switch>
      }>
        <PassScreen color={s.pass()!} onContinue={s.continuePass} />
      </Show>
      <div style="text-align:center;margin-top:1.5rem"><span class="mono muted">{s.seatNote()}</span></div>
    </Show>
  );
}

export default function SiegeBoard(props: { mode: "local" | "online" }): JSX.Element {
  const session = props.mode === "local" ? localSession() : onlineSession();
  return <Game session={session} />;
}
