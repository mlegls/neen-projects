// Shared client shell for the two-player games. Each game's play.tsx mounts
// <PlayApp> with its own Board; this handles the site chrome, the start screen
// (pass-and-play / create / join), and the online room flow. The room code lives
// in the URL as ?room=CODE so links are shareable without any server-side route.
import { Show, createSignal, createEffect, type JSX } from "solid-js";
import { net, createRoom, joinRoom } from "./net";

export function Shell(props: { children: JSX.Element }): JSX.Element {
  return (
    <div class="wrap">
      <header class="site-header">
        <a href="/" style="text-decoration:none;color:inherit;">
          <strong>ZMZM</strong><span class="subtitle"> &nbsp; 玄之又玄 众妙之门</span>
        </a>
      </header>
      <main>{props.children}</main>
      <footer>
        <a href="/">Home</a><span class="sep">·</span><a href="/posts">Posts</a><span class="sep">·</span><a href="/projects">Projects</a><span class="sep">·</span>@mlegls<span class="sep">·</span>yz [at] mmon.co
      </footer>
    </div>
  );
}

type BoardComponent = (p: { mode: "local" | "online" }) => JSX.Element;

function roomFromUrl(): string | null {
  const c = new URLSearchParams(location.search).get("room");
  return c ? c.toUpperCase() : null;
}
function putRoomInUrl(code: string | null): void {
  const url = new URL(location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  history.replaceState(null, "", url);
}

function StartScreen(props: {
  game: string;
  name: string;
  tagline: string;
  onLocal: () => void;
  onJoin: (code: string) => void;
}): JSX.Element {
  let codeInput!: HTMLInputElement;
  return (
    <>
      <h1>{props.name}</h1>
      <div class="tagline">{props.tagline}</div>
      <p style="margin:-.75rem 0 1.25rem"><a href=".">How to play →</a></p>
      <div class="panel">
        <div class="lbl" style="margin-bottom:.6rem">On this device</div>
        <button class="btn" onClick={props.onLocal}>Pass &amp; play</button>
      </div>
      <div class="panel">
        <div class="lbl" style="margin-bottom:.6rem">Online — share a room code</div>
        <div class="row">
          <button class="btn" onClick={() => createRoom(props.game)}>Create a room</button>
          <span class="muted">or</span>
          <input class="code" ref={codeInput} maxlength="4" placeholder="ABCD" />
          <button class="btn sm" onClick={() => { const c = codeInput.value.trim().toUpperCase(); if (c) props.onJoin(c); }}>Join</button>
        </div>
      </div>
      <Show when={net.error}><div class="err">{net.error}</div></Show>
      <p style="margin-top:1.5rem"><a href="/projects">← all projects</a></p>
    </>
  );
}

function RoomWaiting(props: { code: string }): JSX.Element {
  const url = () => `${location.origin}${location.pathname}?room=${props.code}`;
  return (
    <>
      <div class="lbl">Room</div>
      <div style="margin:.6rem 0"><span class="codebadge">{props.code}</span></div>
      <p class="waiting">Waiting for your opponent to join…</p>
      <p class="mono muted">Share: {url()}</p>
      <button class="btn sm" onClick={() => navigator.clipboard?.writeText(url())}>Copy link</button>
      <Show when={net.error}><div class="err">{net.error}</div></Show>
    </>
  );
}

export function PlayApp(props: { game: string; name: string; tagline: string; Board: BoardComponent }): JSX.Element {
  const Board = props.Board;
  const [screen, setScreen] = createSignal<"start" | "local" | "online">(roomFromUrl() ? "online" : "start");
  const [code, setCode] = createSignal<string | null>(roomFromUrl());

  // online: join whatever room is named in the URL (or was just entered)
  createEffect(() => {
    const c = code();
    if (screen() === "online" && c && net.code !== c) joinRoom(props.game, c);
  });
  // after "create", the server hands us a code — adopt it into the URL
  createEffect(() => {
    if (screen() === "start" && net.code && net.game === props.game) {
      setCode(net.code);
      putRoomInUrl(net.code);
      setScreen("online");
    }
  });

  const join = (c: string) => { putRoomInUrl(c); setCode(c); setScreen("online"); };

  return (
    <Shell>
      <Show
        when={screen() !== "start"}
        fallback={
          <StartScreen game={props.game} name={props.name} tagline={props.tagline} onLocal={() => setScreen("local")} onJoin={join} />
        }
      >
        <Show
          when={screen() === "local"}
          fallback={
            <Show when={net.code === code() && net.view} fallback={<RoomWaiting code={code()!} />}>
              <Board mode="online" />
            </Show>
          }
        >
          <Board mode="local" />
        </Show>
      </Show>
    </Shell>
  );
}
