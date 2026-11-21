import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkillLibrary } from "./components/SkillLibrary";
import { isTauri } from "./lib/api";
import { isSkillLibraryWindow } from "./lib/skillWindow";
import "./styles.css";

const libraryWindow = isSkillLibraryWindow();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {libraryWindow ? <SkillLibrary /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);

// The Tauri build also sets PROD, but it loads the app from a custom protocol
// and does not need a service worker. Register only for the browser demo.
if (import.meta.env.PROD && !isTauri && "serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((error: unknown) => {
        console.warn("Service worker registration failed", error);
      });
  });
}
