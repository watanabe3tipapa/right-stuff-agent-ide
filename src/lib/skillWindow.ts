import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { isTauri } from "./api";

const WINDOW_LABEL = "skill-library";

/**
 * Open the skill showcase in its own window. In the Tauri app this is a real
 * secondary window; in the browser demo it opens a new tab with the same
 * standalone route.
 */
export async function openSkillLibraryWindow(): Promise<void> {
  if (!isTauri) {
    const url = new URL(window.location.href);
    url.searchParams.set("window", "skills");
    url.hash = "";
    window.open(url.toString(), WINDOW_LABEL, "width=1120,height=780");
    return;
  }

  const existing = await WebviewWindow.getByLabel(WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const webview = new WebviewWindow(WINDOW_LABEL, {
    url: "index.html?window=skills",
    title: "Skill Library — Right-Stuff Agent IDE",
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d1117",
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once("tauri://error", (event) => {
      reject(new Error(String(event.payload)));
    });
  });
}

export function isSkillLibraryWindow(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("window") === "skills";
}
