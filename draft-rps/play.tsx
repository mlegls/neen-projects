import { render } from "solid-js/web";
import { PlayApp } from "../_play/app";
import Board from "./ui";

render(
  () => <PlayApp game="draft-rps" name="Draft RPS" tagline="Draft a hand, play it out, repeat." Board={Board} />,
  document.getElementById("root")!,
);
