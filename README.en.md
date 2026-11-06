# right-stuff-agent-ide

[日本語](./README.md) | **English**

**Write, delegate, verify. An IDE where agents and your workspace share one screen.**

right-stuff-agent-ide is a macOS-only desktop IDE built with Tauri 2.0 and React 18. It combines the writing experience of [Right-Stuff Editor](https://github.com/watanabe3tipapa/right-stuff-editor-desktop) with the OS-level control of [Agent Desktop](https://github.com/vercel-labs/agent-desktop), so Markdown editing and agent-driven app operations live in the same workspace.

> **Status:** The Tauri 2.0 native app is the main development target and is available as a DMG on GitHub Releases. The landing page and browser demo on Vercel are a sample (reference implementation) for trying the UI without installing the app.

> **Files stay local. Actions stay visible.** Drafts remain in the folder you choose, and every command an agent runs is shown with its output in the UI. No accounts, telemetry, or cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/watanabe3tipapa/right-stuff-agent-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-v0.3.7-blue.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB.svg)](https://tauri.app/)
[![Phase](https://img.shields.io/badge/local--first-openship-orange.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide)
[![Vercel](https://img.shields.io/badge/Vercel-live-black.svg)](https://right-stuff-agent-ide.vercel.app/)
[![GitHub issues](https://img.shields.io/github/issues/watanabe3tipapa/right-stuff-agent-ide.svg)](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues)

**Quick links:** [Live site](https://right-stuff-agent-ide.vercel.app/) · [Browser demo](https://right-stuff-agent-ide.vercel.app/app/) · [Design document (JA)](./right-stuff-agent-ide-implementation-plan.html) · [Architecture](./docs/ARCHITECTURE.md) · [Skill design (JA)](./docs/SKILLS.md) · [API](./docs/API.md) · [Security](./docs/SECURITY.md) · [Issues](https://github.com/watanabe3tipapa/right-stuff-agent-ide/issues) · [Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases)

## Download

v0.3.7 is available as a DMG on [GitHub Releases](https://github.com/watanabe3tipapa/right-stuff-agent-ide/releases) (Apple Silicon and Intel) or as a build from source. See "Install and build" for build instructions.

- Apple Silicon (arm64): `Right-Stuff.Agent.IDE_0.3.7_aarch64.dmg`
- Intel (x86_64): `Right-Stuff.Agent.IDE_0.3.7_x64.dmg`

The app supports **macOS 11 or later (Apple Silicon and Intel) only**. No Windows or Linux builds are provided.

> The DMGs are not signed with an Apple Developer ID and are not notarized (arm64 is ad-hoc signed; x64 is unsigned). If macOS warns on first launch, right-click the app and choose "Open". Running the x64 build on Apple Silicon requires Rosetta 2.

## Concept

### Why an "Agent IDE"?

Editors and agents have traditionally lived in separate windows. To hand a written spec to an agent and verify what it did, you had to switch back and forth repeatedly. The Agent IDE removes that boundary and puts **your workspace and the agent's action log on the same screen**.

Workspace management, the Monaco editor, SQLite version history, the Agent Desktop bridge, LLM chat and planning, the Git panel, the integrated terminal, LSP, and DAP are implemented. Skill execution now covers the editor, Git, the terminal, and debugging, with a verification loop after writes and a self-contained HTML report that summarizes each run.

| Experience | What right-stuff-agent-ide provides |
|---|---|
| Write | Monaco-based Markdown and code editing, tabs, dirty tracking |
| Verify | Split GFM preview, command palette, verification loop (typecheck / lint / test), HTML reports |
| Keep | Direct saves into the workspace, version history in SQLite |
| Protect | Atomic writes, path validation, trash-based soft delete |
| Connect | Agent Desktop CLI detection, snapshots, allowlisted actions |
| Delegate | LLM chat, plan generation, and skill execution (Git / terminal / debug) |
| Extend | Quick Open, Git panel, integrated terminal (PTY), LSP, DAP debugging |

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
- **Agent panel** — Chat, Plan, Skills, Git, Debug, Deploy, Audit, and Runtime tabs; Passive / Assistive / Autonomous modes; `/status`, `/snapshot`, `/plan`, `/ship`, `/deploy`, `/logs`, and `/rollback` commands
- **Language Server (LSP)** — detects rust-analyzer / typescript-language-server / pyright / gopls / clangd / sourcekit-lsp / lua-language-server from a fixed registry and wires Monaco completion, go-to-definition, hover, diagnostics, rename (F2), find references (⇧F12), and code actions. `⌘T` opens workspace symbol search. Open tabs are synchronized with didOpen / didChange / didSave / didClose, and diagnostic counts appear in the status bar
- **Debugger (DAP)** — detects lldb-dap (C / C++ / Rust / Swift / Objective-C) and debugpy (Python) from a fixed registry. The Debug tab starts and stops sessions, manages breakpoints, and shows the call stack, variables, and output. Toggle breakpoints from the glyph margin or with F9
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
- **Skill execution** — v1 manifests in `.agents/skills/*.json` are loaded and validated, and `editor.readFile` / `replaceText` / `createFile` run with policy and approval (from the Skills tab in the agent panel and the Skills tab in settings)
- **Git skills ** — `git.status` / `diff` / `branches` / `stage` / `stageAll` / `commit` run through fixed handlers. Reads need no approval; writes pass through the native approval dialog and are recorded in the local audit log
- **Terminal skill ** — `terminal.run` executes npm / pnpm / yarn / cargo / node / python3 / pytest / make as `program + args`, never as a shell string, with an isolated process group, timeout, and output cap
- **Debug skills ** — `debug.start` / `stop` / `continue` / `next` / `stepIn` / `pause` / `setBreakpoint` / `evaluate` drive DAP request/response and share the Debug tab session. `debug.start` performs the initialize → launch → initialized → configurationDone handshake
- **HTML reports ** — turn a skill run into a self-contained HTML report with an inline SVG approval → run → verify → result flow, light/dark themes, parameters, changed files, and verification output. Preview it in the app or save it under `.agents/reports/`; no CDN or telemetry
- **Theme** — dark theme, overlay title bar, native macOS window

### Architecture

- **Frontend**: Vite 8 + React 18.3 + TypeScript 6
- **Editor**: Monaco Editor 0.52 (`@monaco-editor/react`)
- **State**: Zustand 5 (workspace / editor / agent / git / lsp / dap)
- **Desktop shell**: Tauri 2.0 (Rust 2024 edition)
- **Backend**: Tauri commands (workspace / editor / agent / policy / llm / openship / git / terminal / lsp / dap / settings / app), path validation, atomic writes
- **Git / terminal**: the `git` CLI runs through `std::process::Command` without shell string construction. The terminal allocates a PTY with `portable-pty` and streams output to xterm.js through Tauri events
- **LSP / DAP**: a shared Content-Length framed JSON-RPC transport (`src-tauri/src/rpc.rs`). Only servers and adapters in the fixed registry can be launched; the WebView cannot start arbitrary commands
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
- LSP / DAP launch only executables from the fixed registry and never accept arbitrary commands or shell strings. Debug targets are limited to executables inside the workspace, and all LSP / DAP traffic stays local. Every session is terminated when the workspace changes and when the app exits
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

### LSP / DAP tools

Language servers and debug adapters are detected from a fixed registry. If one is missing, check its status under Settings → Tools or from the LSP indicator in the status bar.

| Language | Language server | Install example |
|---|---|---|
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| TypeScript / JavaScript | `typescript-language-server` | `npm install -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `npm install -g pyright` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| C / C++ / Objective-C | `clangd` | `xcode-select --install` |
| Swift | `sourcekit-lsp` | `xcode-select --install` |
| Lua | `lua-language-server` | `brew install lua-language-server` |

| Debugger | Targets | Install example |
|---|---|---|
| `lldb-dap` | C / C++ / Rust / Swift / Objective-C | `xcode-select --install` (also resolved through `xcrun -f lldb-dap`) |
| `debugpy` | Python | `pip install debugpy` |

Apps launched from Finder see a limited `PATH`, so detection also checks `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, and `~/.cargo/bin`.

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
10. When an LSP server is detected, completion, go-to-definition, hover, rename (F2), find references (⇧F12), and code actions are available. Press `⌘T` to search workspace symbols; diagnostics appear in the editor and status bar
11. In the Debug tab of the agent panel, choose an adapter and executable to start debugging. Toggle breakpoints from the glyph margin or with F9, and inspect the call stack, variables, and output
12. Run `/status` in the agent panel to check whether Agent Desktop was detected
13. Run `/snapshot` to capture a desktop snapshot

## Distribution

- The app itself is not distributed over the web
- v0.3.7 is available both as a DMG on GitHub Releases and as a build from source
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

## Known limitations

- This app is macOS-only (macOS 11 or later); no Windows or Linux builds are provided. Verified on macOS (Apple Silicon) only; launch on Intel hardware has not been verified. Notarization is deferred, and the distribution DMGs are not Developer ID signed (arm64 is ad-hoc signed; x64 is unsigned)
- The `agent-desktop` CLI is not bundled and must be installed separately
- LLM support covers OpenAI-compatible APIs only. The Tauri app connects through the settings dialog; the browser demo does not support LLM chat. Anthropic-specific APIs are not supported yet
- Plans can run allowlisted Agent Desktop actions and manifest-declared skills. Skill execution is limited to the fixed editor, Git, allowlisted program, and DAP handlers
- The terminal skill runs only allowlisted programs and does not accept PTY input or arbitrary shell strings. Debugging supports `lldb-dap` and `debugpy` only
- The Git panel uses the local `git` CLI. If `git` is missing, the panel reports an error. Merge, rebase, push, and other history operations are not implemented
- The integrated terminal is Tauri-only. Git and the terminal are disabled in the browser demo. PTYs stop when the app exits
- The verification loop only targets workspaces with `package.json` (npm / pnpm / yarn) or `Cargo.toml`. It runs a fixed set of commands such as `npm run typecheck` and never arbitrary commands
- LSP supports completion, go-to-definition, hover, diagnostics, rename, references, code actions, and workspace symbol search. Signature help, semantic tokens, formatting, and refactors that create or delete files are not implemented. DAP supports start, stop, stepping, breakpoints, and variable views only; attach and conditional breakpoints are not implemented. Language servers and debug adapters must be installed separately
- The terminal shell can be changed with `RIGHT_STUFF_SHELL` or `SHELL`. Only an existing executable at an absolute path is launched
- Plans and their results are kept in memory only and are lost on restart. Mutating steps still show the native OS approval dialog even after the plan is approved (the policy cannot set them to allow)
- The audit log is stored in local SQLite with a default retention of 30 days and a 5,000-row cap. Disabling it leaves existing records in place
- Snapshots live in memory only and are lost on restart
- Browser demo changes are not persisted
- No sync or collaborative editing
- Quitting from the macOS Dock menu, logging out, or restarting bypasses the unsaved-changes prompt because the OS terminates the app directly (`⌘Q` and the app menu Quit item are guarded)
- No auto-update

## Changelog

Release history, development commands, release steps, and design notes live in [DEV-MEMO.md](./DEV-MEMO.md) (Japanese).

## Directory layout

```text
src/
├── components/                     # React UI
│   ├── EditorPane.tsx              # Monaco / tabs / Markdown split preview
│   ├── FileTree.tsx                # Workspace tree and file operations
│   ├── AgentPanel.tsx              # Chat / Plan / Skills / Git / Debug / Deploy / Audit / Runtime
│   ├── PlanPanel.tsx               # Plan generation, approval, and execution
│   ├── SkillsPanel.tsx             # Skill runs, verification, and HTML reports
│   ├── SkillLibrary.tsx            # Skill library window
│   ├── GitPanel.tsx                # Git status, diffs, and commits
│   ├── DebugPanel.tsx              # DAP debugging
│   ├── QuickOpen.tsx               # ⌘P Quick Open
│   ├── TerminalDock.tsx            # ⌘J integrated terminal (xterm.js)
│   ├── DeployPanel.tsx             # Openship history, logs, and deploys
│   ├── AuditPanel.tsx              # Audit log list
│   ├── AgentPolicySettings.tsx     # Agent policy settings
│   ├── OpenShipSettings.tsx        # Openship connection and PAT settings
│   ├── SettingsDialog.tsx          # Settings dialog
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
│   ├── skillLibrary.ts             # Skill library definitions
│   ├── skillWindow.ts              # Skill library window
│   ├── report.ts                   # HTML report generation for skill runs
│   ├── lsp.ts / lspMapping.ts      # LSP client and Monaco conversion
│   ├── dap.ts                      # DAP client
│   └── monaco.ts                   # Monaco themes and worker setup
├── shared/types.ts                 # Shared frontend / backend types
└── stores/                         # Zustand (workspace / editor / agent / git / lsp / dap)

src-tauri/
├── src/
│   ├── commands/                   # workspace / editor / agent / policy / llm / openship / git / terminal / lsp / dap / skills / report / settings / app
│   ├── skills/                     # mod / editor / git / terminal / debug / exec / params / policy / verify
│   ├── db.rs                       # SQLite (WAL) history, settings, and audit log
│   ├── paths.rs                    # Path validation
│   ├── rpc.rs                      # JSON-RPC transport for LSP / DAP
│   ├── state.rs                    # AppState
│   └── lib.rs                      # Command registration
├── icons/
└── tauri.conf.json                 # Window and bundle configuration

.agents/skills/                     # Skill definitions (JSON)
.agents/reports/                    # HTML reports for skill runs
docs/                               # Architecture / API / skills / security
docs/diagrams/                      # archify diagrams (JSON / HTML / PNG)
public/openship-local-first.png     # Diagram preview for the LP
public/diagrams/                    # Interactive diagram published with the site
public/rs-mark.svg                  # App icon source
right-stuff-agent-ide-implementation-plan.html
right-stuff-agent-ide-lp.html
DEV-MEMO.md                         # Release history and development steps
```

## Documentation

1. [SECURITY.md](./SECURITY.md) — vulnerability reporting, supported versions, research scope
2. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — layers, process model, save flow
3. [SKILLS.md (JA)](./docs/SKILLS.md) — skill manifests, execution policy, approval, verification loop
4. [skills.schema.json](./docs/skills.schema.json) — JSON Schema for skill manifest v1
5. [API.md](./docs/API.md) — Tauri commands and types
6. [docs/SECURITY.md](./docs/SECURITY.md) — path validation, agent permissions, stored data
7. [Implementation plan (JA)](./right-stuff-agent-ide-implementation-plan.html) — overall design and roadmap
8. [Openship architecture diagram](./docs/diagrams/openship-local-first.html) — local-first deployment path (interactive)
9. [Landing page (JA)](./right-stuff-agent-ide-lp.html) — product overview (static mock)
10. [README (Japanese)](./README.md) — 日本語の概要
11. [DEV-MEMO.md (JA)](./DEV-MEMO.md) — release history, development commands, release steps, design notes

## License

MIT License — see the [LICENSE](LICENSE) file for details.

RIGHT-STUFF AGENT IDE is a personal project. Tauri, React, Monaco Editor, and Agent Desktop remain under their respective licenses.
