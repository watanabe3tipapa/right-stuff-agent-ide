import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "screenshots");
const chrome =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.SCREENSHOT_PORT ?? 1421);
const base = `http://localhost:${port}`;

const shots = [
  {
    name: "editor",
    url: "/?shot=1&file=README.md",
    width: 1440,
    height: 960,
  },
  {
    name: "preview",
    url: "/?shot=1&file=README.md&preview=1",
    width: 1440,
    height: 960,
  },
  {
    name: "skills",
    url: "/?shot=1&tab=skills&file=src/components/AgentPanel.tsx",
    width: 1440,
    height: 960,
  },
  {
    name: "plan",
    url: "/?shot=1&tab=plan&file=README.md",
    width: 1440,
    height: 960,
  },
];

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start within ${timeoutMs}ms: ${url}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 1}`);
  }
}

async function capture(url, output, width, height, scale = 2) {
  const profile = await mkdtemp(path.join(tmpdir(), "rsai-shot-"));
  try {
    run(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${scale}`,
      "--virtual-time-budget=10000",
      "--run-all-compositor-stages-before-draw",
      `--screenshot=${output}`,
      url,
    ]);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

async function renderOgImage() {
  const templatePath = path.join(root, "public", "og-template.tmp.html");
  const template = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #0d1117; color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    display: flex; align-items: stretch;
  }
  .copy { width: 540px; padding: 56px 0 56px 56px; display: flex; flex-direction: column; justify-content: center; }
  .badge { display: inline-flex; align-items: center; gap: 8px; width: fit-content; padding: 6px 14px; border: 1px solid #30363d; border-radius: 999px; color: #58a6ff; font: 600 14px/1 ui-monospace, monospace; letter-spacing: .08em; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; }
  h1 { margin-top: 24px; font-size: 46px; line-height: 1.14; letter-spacing: -0.03em; }
  h1 span { color: #58a6ff; white-space: nowrap; }
  p { margin-top: 20px; color: #8b949e; font-size: 19px; line-height: 1.6; }
  .meta { margin-top: 28px; color: #484f58; font: 500 14px/1.5 ui-monospace, monospace; }
  .shot { position: absolute; right: -80px; top: 82px; width: 720px; border: 1px solid #30363d; border-radius: 16px; overflow: hidden; background: #161b22; box-shadow: 0 30px 80px -20px rgba(0,0,0,.8); transform: rotate(-2deg); }
  .shot img { display: block; width: 100%; }
  .bar { display: flex; gap: 7px; padding: 11px 14px; border-bottom: 1px solid #30363d; background: #1c2128; }
  .bar i { width: 10px; height: 10px; border-radius: 50%; background: #484f58; }
  .bar i:nth-child(1) { background: #ff5f57; } .bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; }
</style>
</head>
<body>
  <div class="copy">
    <div class="badge"><span class="dot"></span>HOBBY PROJECT / EARLY ACCESS</div>
    <h1>自分が使うために<br>作っている、<br><span>エージェント IDE</span>。</h1>
    <p>書く、任せる、実機で確かめる。macOS 専用・ローカルファースト・MIT。</p>
    <div class="meta">macOS 11+ / v0.4.3 / right-stuff-agent-ide.vercel.app</div>
  </div>
  <div class="shot">
    <div class="bar"><i></i><i></i><i></i></div>
    <img src="/screenshots/editor.webp" alt="">
  </div>
</body>
</html>`;

  await writeFile(templatePath, template, "utf8");
  try {
    await capture(
      `${base}/og-template.tmp.html`,
      path.join(root, "public", "og-image.png"),
      1200,
      630,
      1,
    );
  } finally {
    await rm(templatePath, { force: true });
  }
}

await mkdir(outDir, { recursive: true });

const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => process.stdout.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(`${base}/`);

  for (const shot of shots) {
    const png = path.join(outDir, `${shot.name}.png`);
    const webp = path.join(outDir, `${shot.name}.webp`);
    console.log(`Capturing ${shot.name}...`);
    await capture(`${base}${shot.url}`, png, shot.width, shot.height);
    run("cwebp", ["-quiet", "-q", "84", png, "-o", webp]);
    await rm(png, { force: true });
  }

  console.log("Capturing social preview...");
  await renderOgImage();
  console.log("Screenshots ready: public/screenshots/, public/og-image.png");
} finally {
  server.kill("SIGTERM");
}
