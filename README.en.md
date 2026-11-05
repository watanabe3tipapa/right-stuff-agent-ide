# right-stuff-agent-ide

[日本語](./README.md) | **English**

**Write, delegate, verify. An IDE where agents and your workspace share one screen.**

right-stuff-agent-ide is a macOS-only desktop IDE built with Tauri 2.0 and React 18. It combines the writing experience of [Right-Stuff Editor](https://github.com/watanabe3tipapa/right-stuff-editor-desktop) with the OS-level control of [Agent Desktop](https://github.com/vercel-labs/agent-desktop), so Markdown editing and agent-driven app operations live in the same workspace.

> **Status:** The Tauri 2.0 native app is the main development target and is available as a DMG on GitHub Releases. The landing page and browser demo on Vercel are a sample (reference implementation) for trying the UI without installing the app.

> **Files stay local. Actions stay visible.** Drafts remain in the folder you choose, and every command an agent runs is shown with its output in the UI. No accounts, telemetry, or cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v0.3.0-blue.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg)](https://tauri.app/)
[![Phase](https://img.shields.io/badge/local--first-openship-orange.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Vercel](https://img.shields.io/badge/Vercel-live-black.svg)](https://right-stuff-agent-ide.vercel.app/)
[![GitHub issues](https://img.shields.io/github/issues/watanabe3tipapa/right-stuff-agent-ide.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues)

**Quick links:** [Live site](https://right-stuff-agent-ide.vercel.app/) · [Browser demo](https://right-stuff-agent-ide.vercel.app/app/) · [Design document (JA)](./right-stuff-agent-ide-implementation-plan.html) · [Architecture](./docs/ARCHITECTURE.md) · [API](./docs/API.md) · [Security](./docs/SECURITY.md) · [Issues](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues) · [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)

## Download

v0.3.0 is available as a DMG on [GitHub Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases) (Apple Silicon and Intel) or as a build from source. See "Install and build" for build instructions.

- Apple Silicon (arm64): `Right-Stuff.Agent.IDE_0.3.0_aarch64.dmg`
- Intel (x86_64): `Right-Stuff.Agent.IDE_0.3.0_x64.dmg`

The app supports **macOS 11 or later (Apple Silicon and Intel) only**. No Windows or Linux builds are provided.

> The DMGs are not signed with an Apple Developer ID and are not notarized (arm64 is ad-hoc signed; x64 is unsigned). If macOS warns on first launch, right-click the app and choose "Open". Running the x64 build on Apple Silicon requires Rosetta 2.

## Concept

### Why an "Agent IDE"?

Editors and agents have traditionally lived in separate windows. To hand a written spec to an agent and verify what it did, you had to switch back and forth repeatedly. The Agent IDE removes that boundary and puts **your workspace and the agent's action log on the same screen**.

Phase 0 implements the foundation: workspace management, the editor, version history, and the Agent Desktop bridge. Phase 1 adds OpenAI-compatible LLM connections, API key storage in the OS keychain, streaming chat, LLM plan generation and plan-level approval, the agent policy, and the audit log. Local-first Openship integration is also available from the Deploy tab. Phase 2 adds Quick Open, a Git panel, and an integrated terminal (PTY) so editing, review, and execution stay in one workspace.

| Experience | What right-stuff-agent-ide provides |
|---|---|
| Write | Monaco-based Markdown and code editing, tabs, dirty tracking |
| Verify | Split GFM preview, command palette, status bar |
| Keep | Direct saves into the workspace, version history in SQLite |
| Protect | Atomic writes, path validation, trash-based soft delete |
| Connect | Agent Desktop CLI detection, snapshots, allowlisted actions |
| Delegate | LLM chat over OpenAI-compatible APIs, plan generation, and plan-level approval |
| Extend | Quick Open, Git panel, integrated terminal (PTY), LSP / DAP (planned) |

### Design principles

1. **Files come first** — the files in your chosen folder are the source of truth, not an app-specific database
2. **Make actions visible** — keep the agent's command, stdout / stderr, and exit code in the UI
3. **Stay on-device** — no accounts, telemetry, or cloud sync
4. **Do not break things** — atomic writes, rejection of out-of-workspace paths, trash on delete
5. **Autonomy in stages** — Passive, Assistive, and Autonomous modes

## Features

### Capabilities

- **Workspace** — pick a folder and list its files recursively; create, rename, delete, and refresh. The last workspace reopens on launch
- **Editor** — Monaco 0.52 with syntax highlighting, tabs, dirty indicators, and `⌘S` / `⌘⇧S` save. Switching workspaces or closing all tabs prompts you to save, discard, or cancel unsaved changes. Closing the window and `⌘Q` use the same prompt.
- **Markdown preview** — GFM rendering via `react-markdown` + `remark-gfm` in a split pane
- **Version history** — every save is recorded in SQLite (WAL). The latest 100 versions per file are kept; preview any version and restore it into the editor
- **File operations** — create, rename, and delete. Deletes move files to `.right-stuff/trash/<timestamp>/`
- **Agent panel** — Chat, Plan, Git, Deploy, Audit, and Runtime tabs; Passive / Assistive / Autonomous modes; `/status`, `/snapshot`, `/plan`, `/ship`, `/deploy`, `/logs`, and `/rollback` commands
- **Quick Open** — press `⌘P` to filter workspace files by name and open one without leaving the keyboard
- **Git panel** — shows the current branch, ahead / behind counts, changes, staged files, and untracked files. Stage / unstage individual files or everything, preview diffs, commit, and browse recent history. Folders that are not repositories can run `git init`
- **Integrated terminal** — press `⌘J` to open a PTY rooted at the workspace and interact through xterm.js. Resize, restart, and clear are supported; the shell resolves from `RIGHT_STUFF_SHELL` → `SHELL` → `/bin/zsh`
- **LLM chat** — OpenAI / Ollama / LM Studio / OpenRouter and other OpenAI-compatible APIs, with streaming output, cancellation, and a connection test. API keys are stored in the OS keychain
- **Plan generation and approval** — describe an intent and the LLM proposes a plan built only from allowlisted Agent Desktop actions. Every step is validated before display; plans are approved as a unit, run step by step in Assistive mode, or run sequentially in Autonomous mode. Invalid actions and arguments from the model are rejected before execution
- **Approval audit log** — plan creation, approval, rejection, and cancellation, action runs, blocks, and cancellations, policy changes, and Openship deploys and rollbacks are recorded in local SQLite. The Audit tab lists entries newest first; records older than the retention period (30 days by default) and entries beyond the latest 5,000 are pruned automatically
- **Openship integration (local-first)** — the Deploy tab handles deployment history, logs, and rollbacks. When the `openship` CLI is detected it is preferred; only when it is missing or fails does the app fall back to the self-hosted REST API. Connection settings live in SQLite, the PAT in the OS keychain, and mutating operations always pass through native approval. See the [architecture diagram](./docs/diagrams/openship-local-first.html)
- **Agent policy** — read-only actions can be set to allow / ask / block, mutating actions to ask / block. The native approval for mutating actions cannot be skipped, and blocked actions are rejected in Rust before execution
- **Agent Desktop bridge** — detects the `agent-desktop` CLI and runs only allowlisted actions, showing the command and output in the UI
- **Command palette** — `⌘K` / `⌘⇧P` to search and run workspace, editor, agent, Git, and terminal commands. `⌘P` opens Quick Open and `⌘J` toggles the terminal
- **Native dialogs** — confirmations and text input use in-app modals instead of blocking browser dialogs
- **Browser demo (sample)** — run the in-memory demo workspace with `npm run dev` without Tauri. On Vercel it is published as a sample for trying the UI without installing the app
- **Skill definitions** — agent action definitions live in `.agents/skills/*.json` (skill execution is not implemented yet)
- **Theme** — dark theme, overlay title bar, native macOS window

### Architecture

- **Frontend**: Vite 8 + React 18.3 + TypeScript 6
- **Editor**: Monaco Editor 0.52 (`@monaco-editor/react`)
- **State**: Zustand 5 (workspace / editor / agent / git)
- **Desktop shell**: Tauri 2.0 (Rust 2024 edition)
- **Backend**: Tauri commands (workspace / editor / agent / policy / llm / openship / git / terminal / settings / app), path validation, atomic writes
- **Git / terminal**: the `git` CLI runs through `std::process::Command` without shell string construction. The terminal allocates a PTY with `portable-pty` and streams output to xterm.js through Tauri events
- **Database**: SQLite (WAL, bundled `rusqlite`) for version history, settings, and the audit log
- **Bridge**: `src/lib/api.ts` wraps `invoke` and falls back to `src/lib/demo.ts` in the browser
- **Packaging**: `tauri build` (`.app` / `.dmg`)

### Data and security

- Drafts are stored as workspace files and are never sent to an external server
- No accounts, telemetry, or cloud sync
- File operations are validated in Rust; absolute paths, `..`, and writes outside the workspace are rejected
- Symlinks are not listed in the file tree
- Writes use a temporary file plus `rename` (atomic write); deletes move entries to trash
- Agent Desktop enforces an action allowlist plus argument length/shape checks, the agent policy, and a native approval dialog for mutating actions; output is truncated at 200,000 characters
- Git operations run the `git` CLI without a shell, and staged paths are limited to relative paths inside the workspace. Diffs and command output are capped before display
- The integrated terminal only launches an absolute shell path and fixes the working directory to the workspace root. PTY input and output stay local and are never sent off-device
- The audit log is stored only in local SQLite and is never sent externally. It contains command arguments, output excerpts, and errors, so take care when backing up or sharing it
- Snapshots are held in memory only and are not persisted to SQLite
- API keys and the Openship PAT are stored only in the OS keychain and never in SQLite, logs, or error messages. LLM and Openship requests are sent from Rust; the WebView never calls external APIs directly
- Openship REST connections assume a self-hosted server, and `http://` is allowed only for localhost / 127.0.0.1 / ::1. Deploy and rollback are disabled in Passive mode and always require native approval in the other modes
- CSP is configured with a `default-src 'self'` baseline for both Tauri (separate production and development policies) and Vercel
- Report vulnerabilities through the private form in [SECURITY.md](./SECURITY.md), not in public issues
- Dependabot handles weekly and security updates for dependencies, and CI runs `cargo-audit`

## Install and build

### Prerequisites

| Tool | Required version | Check |
|---|---:|---|
| macOS | 11 or later | `sw_vers` |
| Node.js | `^20.19.0 \|\| >=22.12.0` (`.nvmrc` pins 24) | `node --version` |
| Rust | >= 1.88 (edition 2024, let chains) | `rustc --version` |
| Xcode Command Line Tools | — | `xcode-select -p` |

Verified on macOS 27 with Node.js 26.9 (CI uses Node.js 24) and Rust 1.99.

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

To cross-build for Intel (x86_64) on Apple Silicon:

```bash
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin
```

Bundles are written to `src-tauri/target/x86_64-apple-darwin/release/bundle/`. If `cargo` resolves to Homebrew's Rust, the x86_64 standard library is missing and the build fails; use the rustup toolchain instead (for example, `PATH="$HOME/.cargo/bin:$PATH"`).

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
| `npm run lint` | Static analysis with ESLint |
| `npm test` | Unit tests with Vitest |
| `npm run check` | Type check + `cargo check` |
| `npm run tauri build` | Build the macOS app (`.app` / `.dmg`) |
| `npm run preview` | Preview `dist/` locally |

### Dependency audit

```bash
npm audit
cargo install cargo-audit --locked   # first run only
cargo audit --file src-tauri/Cargo.lock
```

The `Dependency audit (RustSec)` GitHub Actions job runs the same check. Dependabot proposes npm and Cargo updates weekly.

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
7. Press `⌘K` to search and run commands from the palette, or `⌘P` to open a file by name
8. Use the Git tab in the agent panel to review changes and stage, commit, inspect diffs, and browse history
9. Press `⌘J` to open the integrated terminal at the workspace root
10. Run `/status` in the agent panel to check whether Agent Desktop was detected
11. Run `/snapshot` to capture a desktop snapshot

## Distribution

- The app itself is not distributed over the web
- v0.3.0 is available both as a DMG on GitHub Releases and as a build from source
- The DMGs are not signed with an Apple Developer ID and are not notarized (arm64 is ad-hoc signed; x64 is unsigned). Signing and notarization are deferred; releases stay in this state for now
- Supports macOS 11 or later (Apple Silicon and Intel) only. No Windows or Linux builds are provided

## Sample deployment (Vercel)

The landing page and browser demo are live on Vercel as a sample for trying the UI without installing the app. The native Tauri 2.0 app is distributed as a DMG on GitHub Releases and remains the main development target.

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

### v0.3.0

- [x] Quick Open (`⌘P`) — search workspace files by name and open them
- [x] Git panel — branch / ahead / behind, changes, staged and untracked files, stage / unstage, diffs, commits, history, and `git init`
- [x] Integrated terminal (`⌘J`) — interactive shell via `portable-pty` and xterm.js with resize, restart, and clear
- [x] Real Git branch in the status bar; clicking it opens the Git tab
- [x] PTY cleanup on terminal close and shutdown of all sessions on app exit

### v0.2.1

- [x] Support `clippy::collapsible_match` on Rust 1.99
- [x] Restore green Frontend and Rust CI
- [x] Maintenance release carrying the post-v0.2.0 CI fix

### v0.2.0

- [x] LLM plan generation (Plan tab, `/plan <intent>`)
- [x] Client-side action and argument validation with risk labels
- [x] Plan-level approve / reject and per-step execution in Assistive mode
- [x] Sequential execution of an approved plan in Autonomous mode (stops on failure)
- [x] Per-step result output (stdout / stderr / exit code)
- [x] Approval, execution, and policy-change audit log (SQLite, with retention period and row cap)
- [x] Agent policy settings UI (read-only: allow / ask / block; mutating: ask / block)
- [x] Openship CLI detection and `openship --json deploy`
- [x] Self-hosted REST fallback (deploy, history, logs, rollback)
- [x] Openship settings UI, PAT storage in the OS keychain, and the Deploy tab
- [x] `/ship`, `/deploy`, `/logs`, and `/rollback` commands with audit logging

### v0.1.1

- [x] OpenAI-compatible LLM connections (OpenAI / Ollama / LM Studio / OpenRouter / custom)
- [x] Streaming chat, cancellation, and connection test
- [x] API key storage and deletion in the OS keychain
- [x] LLM settings dialog with model list
- [x] API key redaction, HTTP response body limits, and disabled redirects
- [x] README / API / SECURITY / ARCHITECTURE / landing page updates

### v0.1.0

- [x] Tauri 2.0 + React 18 + Vite foundation and native window
- [x] Workspace selection and restore, file tree, create / rename / delete
- [x] Monaco editor, tabs, dirty tracking, save all
- [x] In-app confirmation and input dialogs
- [x] GFM Markdown preview
- [x] SQLite (WAL) version history (latest 100 per file) and restore
- [x] Path validation, atomic writes, trash-based soft delete
- [x] Agent Desktop detection, snapshots, allowlisted action execution
- [x] Agent Desktop argument validation and native approval dialog
- [x] CSP (Tauri / Vercel) and security headers
- [x] ESLint / Vitest / GitHub Actions CI
- [x] Agent panel (Chat / Runtime, three modes, `/status` and `/snapshot`)
- [x] Command palette
- [x] Browser demo workspace
- [x] Architecture / API / security docs and skill definitions

### Next candidates

- [ ] Skill execution and verification loop
- [ ] LSP / DAP
- [ ] Anthropic-specific API adapter

### Constraints

- This app is macOS-only (macOS 11 or later); no Windows or Linux builds are provided. Verified on macOS (Apple Silicon) only; launch on Intel hardware has not been verified. Notarization is deferred, and the distribution DMGs are not Developer ID signed (arm64 is ad-hoc signed; x64 is unsigned)
- The `agent-desktop` CLI is not bundled and must be installed separately
- LLM support covers OpenAI-compatible APIs only. The Tauri app connects through the settings dialog; the browser demo does not support LLM chat. Anthropic-specific APIs are not supported yet
- Plans can only run allowlisted Agent Desktop actions. Editor, Git, and terminal skill execution is not implemented yet
- The Git panel uses the local `git` CLI. If `git` is missing, the panel reports an error. Merge, rebase, push, and other history operations are not implemented
- The integrated terminal is Tauri-only. Git and the terminal are disabled in the browser demo. PTYs stop when the app exits
- The terminal shell can be changed with `RIGHT_STUFF_SHELL` or `SHELL`. Only an existing executable at an absolute path is launched
- Plans and their results are kept in memory only and are lost on restart. Mutating steps still show the native OS approval dialog even after the plan is approved (the policy cannot set them to allow)
- The audit log is stored in local SQLite with a default retention of 30 days and a 5,000-row cap. Disabling it leaves existing records in place
- Snapshots live in memory only and are lost on restart
- Browser demo changes are not persisted
- No sync or collaborative editing
- Quitting from the macOS Dock menu, logging out, or restarting bypasses the unsaved-changes prompt because the OS terminates the app directly (`⌘Q` and the app menu Quit item are guarded)
- No auto-update

## Directory layout

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / tabs / Markdown split preview
│   ├── FileTree.tsx                # Workspace tree and file operations
│   ├── AgentPanel.tsx              # Chat / Plan / Git / Deploy / Audit / Runtime
│   ├── PlanPanel.tsx               # Plan generation, approval, and execution
│   ├── GitPanel.tsx                # Git status, diffs, and commits
│   ├── QuickOpen.tsx               # ⌘P Quick Open
│   ├── TerminalDock.tsx            # ⌘J integrated terminal (xterm.js)
│   ├── DeployPanel.tsx             # Openship history, logs, and deploys
│   ├── AuditPanel.tsx              # Audit log list
│   ├── AgentPolicySettings.tsx     # Agent policy settings
│   ├── OpenShipSettings.tsx        # Openship connection and PAT settings
│   ├── CommandPalette.tsx          # ⌘K command palette
│   ├── HistoryDialog.tsx           # Version history
│   ├── UnsavedChangesDialog.tsx    # Save / discard / cancel unsaved changes
│   └── ConfirmDialog.tsx           # Confirmation modal
├── lib/
│   ├── api.ts                      # Tauri invoke wrapper
│   ├── demo.ts                     # In-memory browser workspace
│   ├── llm.ts                      # LLM prompts and request conversion
│   ├── plan.ts                     # Plan prompt, JSON parsing, argument validation
│   ├── policy.ts                   # Policy defaults and display labels
│   └── monaco.ts                   # Monaco themes and worker setup
├── shared/types.ts                 # Shared frontend / backend types
└── stores/                         # Zustand (workspace / editor / agent / git)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / policy / llm / openship / git / terminal / settings / app
│   ├── db.rs                       # SQLite (WAL) history, settings, and audit log
│   ├── paths.rs                    # Path validation
│   ├── state.rs                    # AppState
│   └── lib.rs                      # Command registration
├── icons/
└── tauri.conf.json                 # Window and bundle configuration

.agents/skills/                     # Skill definitions (JSON)
docs/                               # Architecture / API / security
docs/diagrams/                      # archify diagrams (JSON / HTML / PNG)
public/openship-local-first.png     # Diagram preview for the LP
public/diagrams/                    # Interactive diagram published with the site
public/rs-mark.svg                  # App icon source
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
```

## Documentation

1. [SECURITY.md](./SECURITY.md) — vulnerability reporting, supported versions, research scope
2. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — layers, process model, save flow
3. [API.md](./docs/API.md) — Tauri commands and types
4. [docs/SECURITY.md](./docs/SECURITY.md) — path validation, agent permissions, stored data
5. [Implementation plan (JA)](./right-stuff-agent-ide-implementation-plan.html) — overall design and roadmap
6. [Openship architecture diagram](./docs/diagrams/openship-local-first.html) — local-first deployment path (interactive)
7. [Landing page (JA)](./right-stuff-agent-ide-lp.html) — product overview (static mock)
8. [README (Japanese)](./README.md) — 日本語の概要

## License

MIT License — see the [LICENSE](LICENSE) file for details.

RIGHT-STUFF AGENT IDE is a personal project. Tauri, React, Monaco Editor, and Agent Desktop remain under their respective licenses.
