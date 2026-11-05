import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkillLibrary } from "./components/SkillLibrary";
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
