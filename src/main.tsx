import React from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Hud } from "./components/Hud";
import { PresenterWindow } from "@pro/PresenterWindow";
import "./index.css";

// The same bundle serves the main window, the heads-up notification window (#hud) and the
// presenter view (#presenter, Pro).
const hud = window.location.hash === "#hud";
const presenter = window.location.hash === "#presenter";
if (hud) document.documentElement.classList.add("hud");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{hud ? <Hud /> : presenter ? <PresenterWindow /> : <ErrorBoundary where="app"><App /></ErrorBoundary>}</React.StrictMode>,
);
