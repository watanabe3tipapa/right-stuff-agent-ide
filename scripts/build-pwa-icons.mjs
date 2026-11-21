import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// PWA icons are generated from public/rs-mark.svg with macOS's built-in sips.
// The project only ships a macOS app, so sips is always available.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public", "rs-mark.svg");
const outDir = path.join(root, "public", "icons");

function sips(args) {
  const result = spawnSync("sips", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`sips exited with ${result.status ?? 1}`);
  }
}

async function main() {
  const scratch = await mkdtemp(path.join(tmpdir(), "rsai-icons-"));
  try {
    const jobs = [
      { size: 192, name: "icon-192.png" },
      { size: 512, name: "icon-512.png" },
      { size: 180, name: "apple-touch-icon.png" },
    ];

    for (const { size, name } of jobs) {
      sips([
        "-s",
        "format",
        "png",
        "-z",
        String(size),
        String(size),
        source,
        "--out",
        path.join(outDir, name),
      ]);
    }

    // Maskable icons need a safe zone inside the 512x512 canvas. Render the
    // mark at 75% and pad the rest with the app background.
    const mark = path.join(scratch, "maskable-mark.png");
    sips([
      "-s",
      "format",
      "png",
      "-z",
      "384",
      "384",
      source,
      "--out",
      mark,
    ]);
    sips([
      "-p",
      "512",
      "512",
      "--padColor",
      "0D1117",
      mark,
      "--out",
      path.join(outDir, "icon-512-maskable.png"),
    ]);

    console.log(`PWA icons written to ${path.relative(root, outDir)}/`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
