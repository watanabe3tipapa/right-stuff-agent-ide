# right-stuff-agent-ide

[日本語](./README.md) | **English**

**Write, delegate, verify. An IDE where agents and your workspace share one screen.**

right-stuff-agent-ide is a macOS desktop IDE built with Tauri 2.0 and React 18. It combines the writing experience of [Right-Stuff Editor](https://github.com/watanabe3tipapa/right-stuff-editor-desktop) with the OS-level control of [Agent Desktop](https://github.com/vercel-labs/agent-desktop), so Markdown editing and agent-driven app operations live in the same workspace.

> **Status:** The Tauri 2.0 native app is the main development target. The landing page and browser demo on Vercel are a sample (reference implementation) published until the Tauri version is ready for release.

> **Files stay local. Actions stay visible.** Drafts remain in the folder you choose, and every command an agent runs is shown with its output in the UI. No accounts, telemetry, or cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg)](https://tauri.app/)
[![Phase](https://img.shields.io/badge/phase-0%20foundation-orange.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Vercel](https://img.shields.io/badge/Vercel-live-black.svg)](https://right-stuff-agent-ide.vercel.app/)
[![GitHub issues](https://img.shields.io/github/issues/watanabe3tipapa/right-stuff-agent-ide.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues)

**Quick links:** [Live site](https://right-stuff-agent-ide.vercel.app/) · [Browser demo](https://right-stuff-agent-ide.vercel.app/app/) · [Design document (JA)](./right-stuff-agent-ide-implementation-plan.html) · [Architecture](./docs/ARCHITECTURE.md) · [API](./docs/API.md) · [Security](./docs/SECURITY.md) · [Issues](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues) · [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)

## Download

v0.1.0 currently assumes a build from source. Distribution binaries are not published yet.

> Builds are ad-hoc signed. There is no Apple Developer ID signature or notarization. If macOS warns on first launch, right-click the app and choose "Open".

## Concept

### Why an "Agent IDE"?

Editors and agents have traditionally lived in separate windows. To hand a written spec to an agent and verify what it did, you had to switch back and forth repeatedly. The Agent IDE removes that boundary and puts **your workspace and the agent's action log on the same screen**.

Phase 0 implements the foundation: workspace management, the editor, version history, and the Agent Desktop bridge. LLM planning and an approval queue arrive in Phase 1.

| Experience | What right-stuff-agent-ide provides |
|---|---|
| Write | Monaco-based Markdown and code editing, tabs, dirty tracking |
| Verify | Split GFM preview, command palette, status bar |
| Keep | Direct saves into the workspace, version history in SQLite |
| Protect | Atomic writes, path validation, trash-based soft delete |
| Connect | Agent Desktop CLI detection, snapshots, allowlisted actions |
| Delegate | LLM planning and approval flow (Phase 1) |
| Extend | Terminal, Git, LSP / DAP (Phase 2+) |

### Design principles

1. **Files come first** — the files in your chosen folder are the source of truth, not an app-specific database
2. **Make actions visible** — keep the agent's command, stdout / stderr, and exit code in the UI
3. **Stay on-device** — no accounts, telemetry, or cloud sync
4. **Do not break things** — atomic writes, rejection of out-of-workspace paths, trash on delete
5. **Autonomy in stages** — Passive, Assistive, and Autonomous modes

## Features

### Capabilities

- **Workspace** — pick a folder and list its files recursively; create, rename, delete, and refresh. The last workspace reopens on launch
- **Editor** — Monaco 0.52 with syntax highlighting, tabs, dirty indicators, and `⌘S` / `⌘⇧S` save
- **Markdown preview** — GFM rendering via `react-markdown` + `remark-gfm` in a split pane
- **Version history** — every save is recorded in SQLite (WAL). The latest 100 versions per file are kept; preview any version and restore it into the editor
- **File operations** — create, rename, and delete. Deletes move files to `.right-stuff/trash/<timestamp>/`
- **Agent panel** — Chat and Runtime tabs, Passive / Assistive / Autonomous modes, `/status` and `/snapshot` commands
- **Agent Desktop bridge** — detects the `agent-desktop` CLI and runs only allowlisted actions, showing the command and output in the UI
- **Command palette** — `⌘K` / `⌘⇧P` to search and run workspace, editor, and agent commands
- **Native dialogs** — confirmations and text input use in-app modals instead of blocking browser dialogs
- **Browser demo (sample)** — run the in-memory demo workspace with `npm run dev` without Tauri. On Vercel it is published as a sample until the Tauri version is ready
- **Skill definitions** — agent action definitions live in `.agents/skills/*.json` (execution lands in Phase 1)
- **Theme** — dark theme, overlay title bar, native macOS window

### Architecture

- **Frontend**: Vite 8 + React 18.3 + TypeScript 6
- **Editor**: Monaco Editor 0.52 (`@monaco-editor/react`)
- **State**: Zustand 5 (workspace / editor / agent)
- **Desktop shell**: Tauri 2.0 (Rust 2024 edition)
- **Backend**: Tauri commands (workspace / editor / agent / settings / app), path validation, atomic writes
- **Database**: SQLite (WAL, bundled `rusqlite`) for version history and settings
- **Bridge**: `src/lib/api.ts` wraps `invoke` and falls back to `src/lib/demo.ts` in the browser
- **Packaging**: `tauri build` (`.app` / `.dmg`)

### Data and security

- Drafts are stored as workspace files and are never sent to an external server
- No accounts, telemetry, or cloud sync
- File operations are validated in Rust; absolute paths, `..`, and writes outside the workspace are rejected
- Symlinks are not listed in the file tree
- Writes use a temporary file plus `rename` (atomic write); deletes move entries to trash
- Agent Desktop runs only allowlisted action names, and output is truncated at 200,000 characters
- Snapshots are held in memory only and are not persisted to SQLite
- API keys are not stored yet (Phase 1 will use the OS keychain)
- CSP is currently `null` for development. It will be tightened to a `default-src 'self'` policy before release

## Install and build

### Prerequisites

| Tool | Required version | Check |
|---|---:|---|
| macOS | 11 or later | `sw_vers` |
| Node.js | >= 20 | `node --version` |
| Rust | >= 1.85 (edition 2024) | `rustc --version` |
| Xcode Command Line Tools | — | `xcode-select -p` |

Verified on macOS 15 with Node.js 22 and Rust 1.94.

### Basic steps

1. Clone the repository

```bash
git clone https://github.com/watanabe3tipapa/right-stuff-agent-ide.git
cd right-stuff-agent-ide
```

2. Install dependencies

```bash
npm ci
```

3. Launch the native window

```bash
npm run tauri dev
```

Vite serves `http://localhost:1420` and Tauri loads it in a native window. If a previous workspace exists, it opens automatically.

4. Build the app

```bash
npm run tauri build
open "src-tauri/target/release/bundle/macos/Right-Stuff Agent IDE.app"
```

To verify a debug build without bundling:

```bash
npm run tauri build -- --debug --no-bundle
./src-tauri/target/debug/right-stuff-agent-ide
```

### Preview the UI in a browser

```bash
npm run dev
```

Open `http://localhost:1420` to use the in-memory workspace from `src/lib/demo.ts`. Changes reset when the page reloads.

### Main commands

| Command | Purpose |
|---|---|
| `npm run tauri dev` | Native development window (HMR) |
| `npm run dev` | Vite dev server only (browser demo) |
| `npm run build` | Type-check and build the frontend into `dist/` |
| `npm run typecheck` | TypeScript type check |
| `npm run check` | Type check + `cargo check` |
| `npm run tauri build` | Build the macOS app (`.app` / `.dmg`) |
| `npm run preview` | Preview `dist/` locally |

### Pointing at Agent Desktop

If `agent-desktop` is not on `PATH`, set the binary explicitly:

```bash
AGENT_DESKTOP_BIN=/path/to/agent-desktop npm run tauri dev
```

Detection order:

1. `AGENT_DESKTOP_BIN`
2. `agent-desktop` on `PATH`
3. `agent-desktop-cli` on `PATH`
4. `agent` on `PATH`

## Usage

1. On launch, choose a workspace from the folder name in the sidebar
2. Create a file with "＋" or open one from the tree
3. Edit in Monaco; unsaved tabs show a dirty indicator
4. Press `⌘S` to save or `⌘⇧S` to save all
5. Toggle the split preview for Markdown from the toolbar
6. Open history to inspect past versions and restore one into the editor (save with `⌘S`)
7. Press `⌘K` to search and run commands from the palette
8. Run `/status` in the agent panel to check whether Agent Desktop was detected
9. Run `/snapshot` to capture a desktop snapshot

## Distribution

- The app itself is not distributed over the web
- v0.1.0 assumes building from source
- GitHub Releases distribution is not ready yet
- Builds are ad-hoc signed; no Developer ID signature or notarization
- Targets macOS (Apple Silicon and Intel)

## Sample deployment (Vercel)

The landing page and browser demo are live on Vercel as a sample until the Tauri version is ready for release. The native Tauri 2.0 app remains the main development target.

| URL | Content |
|---|---|
| https://right-stuff-agent-ide.vercel.app/ | Landing page |
| https://right-stuff-agent-ide.vercel.app/app/ | Browser demo |

Paths in the repository:

| Path | Content |
|---|---|
| `/` | Landing page (`right-stuff-agent-ide-lp.html`) |
| `/app/` | Browser demo (Vite build using the in-memory workspace from `src/lib/demo.ts`) |

```bash
npm run build:vercel   # Produce dist-vercel/ (LP + /app/)
vercel                 # Deploy to a preview environment
vercel --prod          # Deploy to production
```

`vercel.json` defines the build command and output directory. The demo runs in browser memory, so changes are not persisted.

## Known limitations and roadmap

### v0.1.0

- [x] Tauri 2.0 + React 18 + Vite foundation and native window
- [x] Workspace selection and restore, file tree, create / rename / delete
- [x] Monaco editor, tabs, dirty tracking, save all
- [x] In-app confirmation and input dialogs
- [x] GFM Markdown preview
- [x] SQLite (WAL) version history (latest 100 per file) and restore
- [x] Path validation, atomic writes, trash-based soft delete
- [x] Agent Desktop detection, snapshots, allowlisted action execution
- [x] Agent panel (Chat / Runtime, three modes, `/status` and `/snapshot`)
- [x] Command palette
- [x] Browser demo workspace
- [x] Architecture / API / security docs and skill definitions

### Next candidates

- [ ] Connect LLM providers (OpenAI-compatible APIs, Ollama, Claude, etc.)
- [ ] Approval queue and argument-level policy validation
- [ ] Skill execution and verification loop
- [ ] Terminal (PTY), Git, LSP / DAP
- [ ] Tighten CSP and store API keys in the OS keychain
- [ ] CI (typecheck / cargo check / build) and release packaging
- [ ] Windows / Linux support

### Constraints

- Verified on macOS only; distribution signing and notarization are not implemented
- The `agent-desktop` CLI is not bundled and must be installed separately
- LLM inference is not connected. Chat only answers `/status`, `/snapshot`, and setup guidance
- Snapshots live in memory only and are lost on restart
- Browser demo changes are not persisted
- No sync or collaborative editing
- No auto-update

## Directory layout

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / tabs / Markdown split preview
│   ├── FileTree.tsx                # Workspace tree and file operations
│   ├── AgentPanel.tsx              # Chat / Runtime
│   ├── CommandPalette.tsx          # ⌘K command palette
│   ├── HistoryDialog.tsx           # Version history
│   └── ConfirmDialog.tsx           # Confirmation modal
├── lib/
│   ├── api.ts                      # Tauri invoke wrapper
│   ├── demo.ts                     # In-memory browser workspace
│   └── monaco.ts                   # Monaco themes and worker setup
├── shared/types.ts                 # Shared frontend / backend types
└── stores/                         # Zustand (workspace / editor / agent)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / settings / app
│   ├── db.rs                       # SQLite (WAL) history and settings
│   ├── paths.rs                    # Path validation
│   ├── state.rs                    # AppState
│   └── lib.rs                      # Command registration
├── icons/
└── tauri.conf.json                 # Window and bundle configuration

.agents/skills/                     # Skill definitions (JSON)
docs/                               # Architecture / API / security
public/rs-mark.svg                  # App icon source
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
```

## Documentation

1. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — layers, process model, save flow
2. [API.md](./docs/API.md) — Tauri commands and types
3. [SECURITY.md](./docs/SECURITY.md) — path validation, agent permissions, stored data
4. [Implementation plan (JA)](./right-stuff-agent-ide-implementation-plan.html) — overall design and roadmap
5. [Landing page (JA)](./right-stuff-agent-ide-lp.html) — product overview (static mock)
6. [README (Japanese)](./README.md) — 日本語の概要

## License

MIT License — see the [LICENSE](LICENSE) file for details.

RIGHT-STUFF AGENT IDE is a personal project. Tauri, React, Monaco Editor, and Agent Desktop remain under their respective licenses.
