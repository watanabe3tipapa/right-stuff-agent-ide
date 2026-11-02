import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-vercel");
const appDir = path.join(outDir, "app");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

await rm(outDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    viteBin,
    "build",
    "--base=/app/",
    `--outDir=${path.relative(root, appDir)}`,
    "--emptyOutDir",
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await cp(
  path.join(root, "right-stuff-agent-ide-lp.html"),
  path.join(outDir, "index.html"),
);

await cp(
  path.join(root, "public", "rs-mark.svg"),
  path.join(outDir, "rs-mark.svg"),
);

for (const file of ["robots.txt", "sitemap.xml", "404.html", "og-image.png"]) {
  await cp(path.join(root, "public", file), path.join(outDir, file));
}

console.log("Vercel output ready: dist-vercel/ (LP at /, app at /app/)");
