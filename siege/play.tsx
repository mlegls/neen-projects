import { render } from "solid-js/web";
import { PlayApp } from "../_play/app";
import Board from "./ui";

render(
  () => <PlayApp game="siege" name="Siege" tagline="Storm four columns. Find the two hidden kings." Board={Board} />,
  document.getElementById("root")!,
);
