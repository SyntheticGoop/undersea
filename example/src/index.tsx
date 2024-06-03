/* @refresh reload */
import { render } from "solid-js/web";

import "./index.css";
import App from "./App";

const root = document.getElementById("root");

// biome-ignore lint/style/noNonNullAssertion: Root is expected to always exist.
render(() => <App />, root!);
