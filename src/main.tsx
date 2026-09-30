import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Hud } from "./components/Hud";
import "./index.css";

// The same bundle serves the main window and the heads-up notification window (#hud).
const hud = window.location.hash === "#hud";
if (hud) document.documentElement.classList.add("hud");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{hud ? <Hud /> : <App />}</React.StrictMode>,
);
