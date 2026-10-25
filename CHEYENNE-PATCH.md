# Cheyenne patch on OpenCode

Fork of `anomalyco/opencode` (`dev` branch, MIT) at `devlinforsythe/cheyenne`; `upstream` remote = anomalyco.
Plan: `~/gandalf/CHEYENNE-PLAN.md`. Fork rule: a thin branding patch + our own extensions/plugins, no broad core edits.

Cheyenne is built as OpenCode's **dev** channel with the dev identity renamed. Beta/prod entries are untouched.
Every edited code line carries a `// cheyenne` comment, so `git grep -n "// cheyenne"` lists the patch.

## Core files touched (C0)

| File | Change |
|---|---|
| `packages/desktop/src/main/constants.ts` | dev app name `Cheyenne`, dev app id `com.devlinforsythe.cheyenne`; unpackaged fallbacks read the dev entry |
| `packages/desktop/electron-builder.config.ts` | dev `appId` + `productName` |
| `packages/desktop/src/main/windows/appearance.ts` | window title |
| `packages/desktop/src/main/windows/early.ts` | early window title |
| `packages/app/src/app.tsx` | `defaultTheme="cheyenne"` on `ThemeProvider` (a theme the user picks still wins) |
| `packages/desktop/icons/dev/*` | binary: every dev icon replaced from `~/gandalf/media/cheyenne/cheyenne-icon-1024.png` (owner-approved sketch, 2026-10-15; after changing icons run `bun ./scripts/copy-icons.ts dev` before electron-builder) (`icon.icns` built with the macOS 824/1024 inset) |

## Core files touched (C1)

| File | Change |
|---|---|
| `packages/gui-extensions/src/renderer.ts` | registers the `command-center` extension (2 imports + 1 list entry) |
| `packages/gui-extensions/src/main.ts` | registers its main entry (1 import + 1 list entry) |
| `packages/gui-extensions/README.md` | the two `builtins` blocks mirror those entries (`sdk-docs` lint checks they match) |

## Added files (no merge cost)

- `packages/gui-extensions/src/command-center/` — the Command Center panel (C1), a GUI extension (macOS only).
  Main process (`main.ts`) reads Airtable base `appLcCdYRMLbuEQ7R` (open Tasks, Events from yesterday on, New
  Requests) and runs `brain context --all` through `zsh -lc` (Electron's PATH has no `~/bin`); the window
  (`panel.tsx`) only talks to it over the `command-center` Ipc. Ticking a to-do PATCHes its Status to `Done`;
  unticking restores the status it had. Everything else is read-only.
  **Token:** `AIRTABLE_TOKEN` from the environment, else its line in `~/.hermes/.env` (same as the mail-job). It
  stays in the main process; nothing is committed. Open it from the command palette (`⌘⇧P` → "Open Command
  Center") or the side-panel `+` menu; it is a side tab, so it needs an open session (not on Home).

- `packages/ui/src/theme/themes/cheyenne.json` — the Cheyenne theme. Desktop themes live here, not in
  `packages/theme` (that package is the TUI's). It is picked up by the `themes/*.json` glob, so no registry edit.
  Dark: tunnel black `#11171b`, white-caps ink `#ece8df`, rust arch primary `#b4532f`, tunnel-lamp accent `#f2a640`,
  steel info `#8fa4b0`. Light: concrete `#e4e0d8` with the same rust / lamp / steel.

- `packages/plugins/workers/` — the `run_worker(worker, stage_brief, mission_dir, business?, topic?)` server tool
  (C2), a V2 plugin (no core edits). It shells out to each worker's own CLI on its own subscription login, through
  `zsh -lc` (the server's PATH has no `~/bin` / `~/.local/bin`; the brief is passed as an argument, never spliced
  into the script), streams stdout+stderr as tool progress (`metadata.output`, ~2/s), returns the output, and then
  runs `brain log -a <worker> [-b business] [-t topic]`. Unattended flags: `claude -p --permission-mode acceptEdits`,
  `codex exec -m gpt-5.6-sol --sandbox workspace-write --skip-git-repo-check`, `cursor-agent -p --force
  --output-format text`, `grok --always-approve --single`. 30-minute cap; the session's stop button kills the run.
  **Loaded by config, not the build:** the server is the prebuilt `opencode-cli`, so the plugin is listed in
  `~/.config/opencode/opencode.jsonc` as `"plugins": ["/Users/devlinforsythe/cheyenne/packages/plugins/workers"]`
  (backup `opencode.jsonc.bak-c2`); edits hot-reload. Restart the server with `opencode-cli service` or kill
  `opencode-cli serve --service` after changing the list.
  The generic tool card shows only "Used run_worker" and the model's summary, not the live stream; a run_worker
  renderer needs `tool-renderer` exported from `packages/session-ui` (a core edit), left for later.

- **Missions (C3), no core edits.** `packages/plugins/workers/workers.ts` (the worker runner, shared) and
  `packages/plugins/workers/mission.ts` (mission state + detached stage runner + CLI); `index.ts` adds the server
  tools `mission_open` and `mission_status`.
  - A typed build request makes the model call `mission_open(goal, repo, business, name?, base?, rules?, stages?)`:
    git worktree `~/missions/<id>` on branch `mission/<id>` (from `main`), `MISSION.md` in it (goal, rules, stage
    table, results), state in `~/.cheyenne/missions/<id>.json`, worker logs in `~/.cheyenne/missions/<id>/`.
  - Default stages (per mission, overridable): plan (claude, writes PLAN.md, no code) → research + build (grok +
    cursor in parallel) → visuals/UX (codex, against `Recode Design/DESIGN-SYSTEM.md`) → verify (claude, VERIFY.md).
    Every stage pauses for the owner unless its template says `pause: false`.
  - **There is no approve tool for the model.** A stage starts only from the Command Center's Approve button or
    `cheyenne-mission approve <id>`; either spawns a detached `bun mission.ts run <id>` that runs the stage, stores
    notes, sets the next stage to waiting and writes `brain status -b <business> -t mission-<id>` (with
    `--blocked "Owner: approve stage …"` while it waits). Workers are told never to merge, push or install.
  - CLI: `~/bin/cheyenne-mission` is a symlink to `mission.ts` (`list [--json] | show <id> | approve <id> | run <id>`).
  - Command Center: a Missions section (stage chips; Approve/Retry on the waiting or failed stage; refresh every
    5 s) via two new Ipc methods `missions` / `approve` (contract, main, i18n, panel; all inside `command-center/`).

- `packages/plugins/media/` — Gandalf's image generation and brand LoRAs (C4), no core edits. `media.ts` is a
  stdlib-only TS port of `~/gandalf/bin/gandalf-imagegen` + the use side of `gandalf-lora`; `index.ts` adds the
  server tools `image_generate(prompt, brand?, provider?, model?, lora?, lora_scale?, n?, size?, image?, strength?,
  name?)` and `lora_list()`. Providers: `fal` (Flux, Gandalf's active provider) and `google` (Gemini image). A
  `lora` forces FAL `fal-ai/flux-lora` and prepends its trigger word; `image` routes to `/image-to-image`.
  **Keys and brand data stay in Gandalf:** `GOOGLE_AI_API_KEY` / `FAL_KEY` / `GANDALF_IMAGE_PROVIDER` /
  `GANDALF_IMAGE_MODEL` from the environment, else `~/gandalf/.env` (gitignored); LoRA refs from
  `~/gandalf/brand_context/<brand>/loras/*.json`. Images land in `~/.cheyenne/media/<brand>/`. Nothing committed.
  Loaded the same way as workers: `"plugins": [".../plugins/workers", ".../plugins/media"]` in
  `~/.config/opencode/opencode.jsonc`, applied with `opencode-cli reload` (no service restart).
  - The `.env` model id is applied only to the `.env` provider (Gandalf applied `fal-ai/flux/dev` to google too → 404).
  - Tool `metadata` must be plain JSON: a `lora: undefined` field made the server drop the whole result (tool stuck
    "running", model saw "Tool result missing") while the image was written; it is JSON round-tripped now.
  - LoRA training stays the Gandalf CLI (`~/gandalf/bin/gandalf-lora train`); `bun media.ts loras|generate` runs
    the engine from a terminal.

## Build (macOS arm64, unsigned)

```bash
cd packages/desktop
export OPENCODE_CHANNEL=dev CSC_IDENTITY_AUTO_DISCOVERY=false
bun run prebuild && bun run build
bunx electron-builder --mac dir --arm64 --config electron-builder.config.ts -c.mac.notarize=false -c.mac.identity=null
open dist/mac-arm64/Cheyenne.app
```

`prebuild` on the dev channel downloads `@opencode/cli-darwin-arm64@dev` as the bundled server.

## Upstream merge

```bash
git fetch upstream && git merge upstream/dev
```

Conflicts can only land in the rows above; re-apply them and keep the `// cheyenne` markers.

## Verified (2026-10-15)

`docs/c0-proof.jpg`: Cheyenne.app (menu bar + window title "Cheyenne", bundle `com.devlinforsythe.cheyenne`),
Cheyenne theme on by default (light variant follows the macOS appearance), chat answered by DeepSeek V4.1 Flash
via the owner's existing OpenCode Zen key.

Models: the app uses the shared `~/.config/opencode/opencode.jsonc`. An `ollama` provider (`Qwen 3.5 (local)`,
`127.0.0.1:11434/v1`) was added there (backup `opencode.jsonc.pre-cheyenne`); new models are hidden until switched
on in Manage models. On this Mac it ran ~4 tok/s with Ollama's default 4096 context and timed out
("waiting for response headers") behind the title request, so the local path needs a bigger context and a faster
box (the mini / R630) before it is usable.

`docs/c1-proof.jpg` (C1): Command Center side tab in a session with upcoming events, new requests, 158 open
to-dos and the brain briefing; ticking "dsh: add workspace…" (`rech6CII2n6BwKews`) struck it through and Airtable
read `Done`; unticking set it back to `To do`, confirmed through the API (`docs/c1-undone.jpg`). The to-do list
takes ~10 s to load (every open task, all pages).

`docs/c2-proof.jpg` (C2): three sessions on the app's background server, each calling `run_worker` once with a
one-line brief, and the brain entries they wrote (`-b infra -t cheyenne`): claude 6 s, cursor 9 s, codex 6 s.
Screen control of Cheyenne.app was declined, so the sessions were started with the app's own
`opencode-cli run --auto` and photographed in the same server's web UI (`opencode-cli pair`); they show in the
app's session list too.
- **codex:** `~/.codex/config.toml` has `model = "gpt-6.1-sol"` (the Codex picker writes it), which a ChatGPT login
  refuses ("not supported when using Codex with a ChatGPT account"); so are gpt-6-sol, gpt-5.5 and gpt-5.3-codex.
  `gpt-5.6-sol` (from `~/.codex/models_cache.json`) works, so the plugin pins it. `--full-auto` no longer exists in
  codex-cli 0.150.1; `--sandbox workspace-write` replaces it. Its effort stays the config's `max`.
- **grok: signed in 2026-10-15** (`grok login --device-auth`, account devlin@recodedesign.com, `~/.grok/auth.json`).
  Headless check from the shell: `grok --always-approve --single "..."` answered as Grok 4.7. Not yet run through
  `run_worker` inside Cheyenne.app; the grok row needed no change. `gbot` was not used (Keychain prompt).
- **Gotcha:** the Grok installer overwrote `~/.local/bin/agent` (Cursor's `agent` link). It was put back:
  `ln -sf "$(readlink ~/.local/bin/cursor-agent)" ~/.local/bin/agent`. `cursor-agent` itself was untouched.

`docs/c3-proof.jpg` (C3): in Cheyenne.app, the typed request "Build a … 610-B preamp as a Recode Audio plugin …"
(GPT-5.6 Sol) loaded the recode-audio-engineering skill and called `mission_open`; the Command Center shows mission
`ra-610-preamp` with plan waiting and an **Approve plan** button, which started the claude plan stage. Grok ran
through the worker runner in the `c3-smoke` mission (78 s) and through `run_worker` ("Grok 4.7 READY").
- The screenshot was taken over a local debug port (`--remote-debugging-port`), since the app's window sat behind a
  full-screen Space; the button was pressed the same way.
- Mission `goal` text is internal (it may name the reference gear); the RA naming rule binds public copy, and every
  worker brief carries it.

## Not branded yet

In-app copy that says "OpenCode" (i18n strings, About, onboarding), the big `opencode` wordmark on the empty
session screen, the `opencode://` scheme, typography (white condensed capitals). Left for later so the patch stays thin.

`docs/c4-proof.jpg` (C4): three images generated from Cheyenne sessions (`opencode-cli run`, GPT-5.6 Sol) through
the new tools: `image_generate` on FAL `fal-ai/flux/dev` (session "C4 imagegen proof"), `lora_list` +
`image_generate lora=wolfe-standard` ("C4 LoRA proof"), and `lora=studio84-panel` on the app's background service
("C4 imagegen proof (service)").
- `provider=google` reaches Gemini but this key's free tier allows 0 image requests (429 on
  `gemini-2.5-flash-image`); it needs billing on the Google AI key before it works. FAL is the default.
- Gandalf retired the same day (owner yes to both): `~/gandalf/desktop` moved to
  `root@192.168.1.200:/tank/media-assets/gandalf-desktop` (9,303 files + 38 symlinks, SHA-256 compared,
  `fetch-from-r630.sh` left behind) and `com.gandalf.sync` unloaded with its plist kept. Inventory and verdicts:
  `~/gandalf/CHEYENNE-PLAN.md` § C4 inventory.

## C5 — Hostinger, tailnet only (2026-10-15)

No code change. The VPS (`srv1535715`) runs the stock `@opencode/cli-linux-x64` build the desktop bundles, as
systemd `cheyenne.service`, user `cheyenne`, bound to its Tailscale IP only:
`opencode serve --hostname 100.98.225.126 --port 4096`.
- The password comes from `/etc/cheyenne/env` (600). `serve` reads `OPENCODE_SERVER_PASSWORD` / `OPENCODE_PASSWORD`, and a
  client passes `OPENCODE_PASSWORD` with `--server`.
- The client sends its own working folder as the session location, so `run --server` must be started from a folder that
  exists on the server.
- `/api/*` returns 401 without the password. Non-API paths serve the static web UI shell.
- ufw is default-deny (tailscale0, 80/443 for the existing n8n, 41641/udp). Public SSH is closed and SSH is key-only. No
  worker CLIs and no plugins on the box. Checklist and proof: `~/gandalf/CHEYENNE-PLAN.md` § C5.

## 6.0b — read-only Shopify + ShipStation tabs (2026-10-16)

Command Center gets two store tabs beside the Airtable ones. `tabs.ts` marks them with `source`, and `main.ts`'s
`rows` handler sends them to `command-center/stores.ts` instead of Airtable. They have no status, edit or create, so
`writable` is empty and `allowed` refuses every write. Only one GraphQL query and one GET leave main.
- **Shopify**: open, unfulfilled orders from the last 30 days, 50 max. The date bound keeps out the TKC Matrixify import.
  Admin GraphQL `SHOPIFY_API_VERSION` (default `2026-01`) on `SHOPIFY_SHOP` (default `wolfe-cutlery.myshopify.com`). The
  token is `SHOPIFY_TOKEN` (read_orders) if set, else a 24 h token minted from the Dev Dashboard app's
  `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (client credentials grant), kept in memory until it expires. No customer or product fields: the token has no read_customers / read_products.
- **ShipStation** (API v1, Basic auth): every order awaiting shipment, 500 a page. Needs `SHIPSTATION_API_KEY` and
  `SHIPSTATION_API_SECRET`.
- Credential lookup, in main only: environment, then a `NAME=` line in `~/.config/wolfe-sync/env`, then the Keychain
  (service = NAME). A missing one shows "Did not load: NAME is not set…" in the tab.
- Check: `bun test src/command-center/stores.test.ts` in `packages/gui-extensions`.

## 6.0c — read-only Reverb tab (2026-10-16)

A third store tab, same pattern as 6.0b (`source: "reverb"`, no status/edit/create, GETs only).
- **Reverb** (API v3, `Accept-Version: 3.0`): every order awaiting shipment
  (`/api/my/orders/selling/awaiting_shipment`, following `_links.next`). Needs `REVERB_TOKEN`: a personal token from
  reverb.com → Settings → API & Integrations with only the `read_orders` scope. One row per order (Reverb orders hold
  one listing), linked to the order's web page.

## 6.1 — Claude as the main model + Claude Code sessions in the sidebar (2026-10-18, branch `cheyenne-claude`, committed 6b2f0fbb0c, not pushed)

**Provider.** `packages/plugins/claude-code/provider.ts` wraps `ai-sdk-provider-claude-code@3.6.1` (Agent SDK, Claude Code login — no API key; none is set in the service env, `~/.zshrc`, `~/.zprofile` or the config). Wired by config only, in `~/.config/opencode/opencode.jsonc` (backup: `opencode.jsonc.bak-claude`): provider `claude-code` ("Claude (subscription)", npm `file://…/packages/plugins/claude-code/provider.ts`, models `opus` / `sonnet`) and the plugin path in `plugins`. Switch the two models on in Manage models — the toggles are stored per front-end (the Electron app and the web UI each need their own).
- Runs Claude in the session's folder (the `Working directory:` line of the system prompt), gated like the workers' `claude -p`: `permissionMode: acceptEdits` + `permissionPrompts: none`, so file edits go through and anything that would need a permission prompt (most Bash, web fetches) is refused — no one is there to answer Claude's own prompts. The owner opens the gate with the provider's `options.defaultSettings.permissionMode` in `opencode.jsonc`: `auto` (Claude's classifier decides) or `bypassPermissions` (no gate; only then is `allowDangerouslySkipPermissions` set). Until 2026-10-20 bypass was the default.
- Native chats: `persistSession: false`, whole conversation sent each turn, nothing written to `~/.claude`.
- Claude's own tools show as Claude names ("Used 1 Bash"); OpenCode's show as "Used 2 Shell, Read".
- The picker also lists **OpenCode Zen** Claude models (Opus 5.5, Sonnet 5.5…): those bill the Zen key, not the subscription. Use the "(Claude Code login)" ones.
- Title generation falls back to the primary model, so a Claude chat makes one small extra Claude call for its title.
- The SDK session loads the owner's claude.ai connectors; unauthorised ones get a one-line note at the end of a reply.

**Claude Code sessions.** `packages/plugins/claude-code/imports.ts` converts `~/.claude/projects/*/<uuid>.jsonl` (read-only) into OpenCode sessions via `opencode session import` — id `ses_claude_<uuid>`, folder = the transcript's cwd, `metadata.claudeCode`. Skips headless `sdk-*` runs, sidechains/meta/compact lines, and runs Cheyenne started itself. Records: `~/.cheyenne/claude-code-imports.json`. The plugin (`index.ts`) imports the last 7 days 2 s after start, then every 5 min; by hand: `bun packages/plugins/claude-code/imports.ts [days|uuid]`.
- Converted sessions go through agent-sessions' `redact()` (since 2026-10-20; until then Claude imports were not redacted — a scan of the database then found no token in them).
- One importer per server process: `every()` (agent-sessions/common.ts) holds the timer for both importers. The server loads a copy of each plugin for every open folder (4 on 2026-10-20) and a fresh copy whenever its files change; until 2026-10-20 each copy started its own timer and none ever stopped, so up to 4 importers raced on the same transfer files (no duplicate sessions came of it: 95 Claude, 28 Codex, one each), and copies loaded before the redaction fix kept importing without it until the service restart (`opencode-cli service restart`, 2026-10-20 22:02).
- Continuing one: the first turn resumes the Claude session with `forkSession` into a deterministic fork id; later turns resume the fork; only the newest message is sent. The original transcript is never written. A session with a fork is never re-imported (it holds turns the transcript lacks).
- Core edit: `packages/app/src/home/sessions/controller.tsx` (`// cheyenne`) — group-by-agent puts these under "Claude Code".

**Verified** (through the server's own web UI at `http://127.0.0.1:<service port>` — screen control of Cheyenne.app was declined): native Opus chat streamed, ran Claude's Bash in the right folder/branch (`docs/claude-chat-proof.jpg`; that was under the old bypass default — since the gate, 2026-10-20, a Sonnet probe through `createClaudeCode()` had its Bash refused, "no approval surface", and its Write go through); stop button → "Interrupted" (`docs/claude-stop-proof.jpg`); imported "Teleport session recovery" renders and continued with its old context (`docs/claude-continue-proof.jpg`). `bun run check` passes; app rebuilt (previous build: `~/cheyenne-backups/Cheyenne-pre-claude.app`). **Not verified:** the "Claude Code" group in the Electron app (the web UI is the stock bundle) and Sonnet — owner to check.

**Next:** Codex / Grok / Cursor session import and launch buttons.

## 6.2 — Codex / Grok / Cursor sessions + agent launch buttons (2026-10-19, branch `cheyenne-claude`, committed 6b2f0fbb0c, not pushed)

**Importer.** `packages/plugins/agent-sessions/` (V2 plugin `cheyenne.agent-sessions`, path added to `plugins` in `~/.config/opencode/opencode.jsonc`, backup `opencode.jsonc.bak-agents`). Same shape as claude-code's importer: converts transcripts (read-only) with `opencode session import`, last 7 days, 4 s after start then every 5 min (one timer per server process, see 6.1). Records: `~/.cheyenne/<codex|grok|cursor>-imports.json`. By hand: `bun packages/plugins/agent-sessions/common.ts [codex|grok|cursor] [days] [--headless]`.
- Ids `ses_<codex|grok|cursor>_<uuid without dashes>`, folder = the transcript's cwd, `metadata.<agent>.{sessionId, source}`.
- A session continued in Cheyenne (more messages than were imported) is never re-imported over.
- Every converted session goes through `redact()` (common.ts): Airtable PATs, `sk-…`, `xai-…`, GitHub, AWS and Shopify tokens become `[redacted]`. Check: `bun test` in `packages/plugins/agent-sessions` (`common.test.ts`: the redaction and the one timer). The transfer file in `$TMPDIR` is deleted after each import (both importers; until 2026-10-20 they piled up: 129).
- **Codex** (`~/.codex/sessions/**/rollout-*.jsonl`, titles from `session_index.jsonl`): skips subagent threads, `codex exec` runs and Codex's own copies of Claude sessions (claude-code already shows those). 14 threads imported.
- **Grok CLI** (`~/.grok/sessions/<cwd>/<uuid>/chat_history.jsonl` + `summary.json`): skips `session_kind: headless`. Every Grok session on this Mac today is headless (worker / mission runs), so 0 imported; `--headless` imports them (tested: 7). Lines have no timestamps: times are spread from created to updated.
- **Cursor agent** (`~/.cursor/projects/*/agent-transcripts/`, meta from `~/.cursor/chats/*/*/meta.json`): imports titled chats only; every chat in the last week is an untitled `cursor-agent -p` run, so 0 imported (`--headless`: 14). Transcripts hold no tool results and no timestamps.
- **Grok Bot** (grokbot / gbot, x.ai) keeps no transcripts on this Mac: nothing to import. It is not the Grok CLI.
- Note: the one titled Cursor chat ("Airtable Token Set", 2026-09-23) contains an Airtable token in plain text in `~/.cursor` — redaction keeps it out of Cheyenne; the owner may want to rotate it.

**Launch / continue.** `packages/gui-extensions/src/terminal/agents.tsx` (new): session header buttons **+ Claude / + Codex / + Grok / + Cursor** start that CLI in the session's folder in a terminal tab (`zsh -ilc "<cli>; exec zsh -il"`, so ~/.local/bin, ~/.grok/bin are on PATH and the tab drops to a shell after). On an imported session, **Continue in <agent>** runs `claude --resume <id> --fork-session` / `codex fork <id>` / `grok --resume <id> --fork-session` / `cursor-agent --resume <id>` (Cursor has no fork: it appends to the original chat). Also in the command palette, group "Agents".
- Core edits (`// cheyenne`): `terminal/model.ts` (`new(run?)` passes command/args/title to pty create), `terminal/renderer.tsx` (one `addAgents` call), `app/src/home/sessions/controller.tsx` (group-by-agent → "Claude Code" / "Codex" / "Grok" / "Cursor").
- Known: opening the dock when it has no tabs also creates a plain "Terminal 1" beside the agent tab.

**Verified** through a throwaway server run from source (`packages/cli`, `OPENCODE_DISABLE_CHANNEL_DB=1`, port 5299) because the service's embedded web UI is built from a stale `packages/app/dist` (rebuilt now with `bun run build` in packages/app; the service CLI embeds it on its next build): group by Agent shows Claude Code + Codex groups (`docs/agents-group-by-agent.jpg`); a Codex transcript renders with the header buttons (`docs/agents-codex-transcript.jpg`); **+ Claude** opened Claude Code in ~/My Businesses in a terminal tab (`docs/agents-launch-buttons.jpg`). The continue flags were checked against each CLI's `--help`; Continue was not clicked (it would fork a real thread). `bun run check` passes; app rebuilt (previous build: `~/cheyenne-backups/Cheyenne-pre-agents.app`). **Not verified:** the Electron app itself (relaunch it — the running copy is the old build).

## 6.3 — Rooms: Agent Kanban, Loop, Pipeline, Mastermind (2026-10-21, branch `cheyenne-claude`, committed locally, not pushed)

The four Agent OS rooms the owner picked (2026-10-20), written as our own code. Agent OS (`~/agent-os`, no licence) was read for behaviour only: no file, component or prompt was copied.

**CLI.** `packages/plugins/workers/rooms.ts`, linked as `~/bin/cheyenne-rooms`. Every command prints JSON. Long jobs run in a detached runner (`cheyenne-rooms <room> run <id>`), so they outlive the app. State lives in `~/.cheyenne/rooms/{loop,pipeline,chat}/`. `cheyenne-rooms state [chat id]` returns every room at once; the tab polls it every 3 s.
- **Agent Kanban** shows the missions (mission.ts) as a board with Planner / Builder / Reviewer / Done columns, placed by the stage in hand:
  - `plan` → Planner;
  - `verify`, `review`, `judge`, `test` or `qa` → Reviewer;
  - any other stage → Builder;
  - no stage left → Done.

  A new card opens a mission on the default stages, each waiting for the owner's Approve (`cheyenne-mission approve`, as in the Command Center).
- **Loop** pairs a written definition of done with a builder and a judge.
  - The builder is a worker. It works in the mission's worktree and commits to its branch; it never merges, pushes or installs.
  - The judge must be a different model. It reads the same worktree read-only.
  - The verdict is the judge's first PASS/FAIL line. FAIL feedback goes into the next round.
  - The loop stops on PASS, at the round limit (1–8, default 4), when the builder or judge breaks, or on Stop (which kills the runner's process group).
  - It refuses to start while a mission stage runs, or while another loop runs on the mission. It ends with `brain log`.
- **Pipeline** lists the ideas in `~/My Businesses/ideas/inbox.jsonl` (inbox and parked, plus the approved ones).
  - "Classify and plan" asks a read-only agent for a route (project / action / reference / drop) and 1–6 stages.
  - The owner reviews the plan, then approves once with **Approve & build**: `idea doing <id>`, a mission whose stages run without pausing, and `brain log`.
  - Reject writes pipeline state only; the inbox is untouched.
- **Mastermind** holds group chats (`chat/<id>.jsonl`, append-only).
  - The owner's message goes to everyone in the chat. With @-tags it goes only to the tagged agents, and tagging an agent adds it to the chat.
  - claude, codex, grok and hermes reply one at a time, read-only, from `~/My Businesses`, and each sees the chat so far.
  - One runner per chat (a lock file).
- The readers (judge, planner, Mastermind) run read-only:
  - `claude -p --permission-mode plan`;
  - `codex exec --sandbox read-only`;
  - `grok --permission-mode plan -p`;
  - `hermes -t web -z`. `-z` auto-approves hermes's tools, so `-t web` limits it to the web toolset; its MCP servers may still load.

  Answers pass through agent-sessions' `redact()`. Builders keep the workers' gated flags: no yolo, bypass or full-auto.
- Edits to shared files:
  - `workers.ts`: `run()` takes an optional `onStderr`, which keeps a reader's answer apart from its logs.
  - `mission.ts`: honours `CHEYENNE_MISSIONS`.
- Env overrides, for tests and screenshots:
  - `CHEYENNE_ROOMS`;
  - `CHEYENNE_IDEA_HOME`: the home whose `My Businesses/ideas/inbox.jsonl` the Pipeline reads. `idea doing` runs with `HOME` set to it.
  - `CHEYENNE_MISSIONS`.

  The Electron main process passes its env on to the CLI.

**Tab.** `packages/gui-extensions/src/rooms/` (contract.ts, main.ts, renderer.tsx, panel.tsx, i18n/en.ts), registered in `src/main.ts`, `src/renderer.ts` and the README builtins. It is a side panel called "Rooms": open it from the session panel's add-tab menu, or with "Open Rooms" in the palette. Every button is one CLI call through main.
- Gotcha: the IPC method is `read`, not `state`. An Ipc client keeps `state()` and `on()` for itself, and the types merge without an error. In the first build, the tab rendered nothing because of this.

**Known.**
- A loop and a mission stage share the worktree. Loop Start refuses while a stage runs, but approving a stage during a loop is not blocked.
- Mastermind: if two runners take over a stale lock at the same moment, both may reply (duplicate replies at worst).
- hermes answers with HTTP 402 today: its OpenRouter credits are exhausted (owner-side). The error shows in the chat.
- The env overrides move state only. The agents and `brain` stay real, so an Approve in a test instance runs real workers and writes real brain entries. On 2026-10-21 a test card's plan stage was approved in the screenshot instance, by a click that was not the session's; it ran one claude worker in the scratchpad worktree, and the `mission-card-test` workstream was closed as not real work.

**Check.**
- `bun test rooms.test.ts` in packages/plugins/workers runs 6 tests: columns, verdicts, who replies, owed replies, plan parsing, and a Pipeline promote against a temp inbox (the real inbox is untouched).
- An end-to-end run used stub agents with a temp rooms dir, inbox and missions dir. It covered:
  - Pipeline: shape → review → reject or approve → mission done → idea marked doing;
  - Kanban: a card;
  - Loop: FAIL → PASS in 2 rounds, and Stop (the process group gone);
  - Mastermind: a chat with an @-tag;
  - the brain calls, logged.

**Verified** in the rebuilt Electron app, launched on debug port 9333 with test state (the three env overrides). Screenshots were taken over CDP and clipped to the Rooms panel, because the repo is public.
- Agent Kanban: a test card waiting on its stage's Approve (`docs/rooms-kanban.jpg`).
- Loop: the e2e's stub-agent loop, FAIL → PASS (`docs/rooms-loop.jpg`).
- Pipeline: a real claude plan of a test idea, made with the tab's "Classify and plan", then rejected from the tab (`docs/rooms-pipeline.jpg`).
- Mastermind: one message sent from the tab, @-tagging claude, codex and grok; all three replied in turn within a minute (`docs/rooms-mastermind.jpg`).
- Not clicked: Add card, Start loop, Approve, Approve & build. They start real work; their CLI paths ran in the stub e2e.
- Fixed after the first shot: the selected tab used an undefined colour token (now `bg-v2-background-bg-layer-02`), and the card's "Approve {{stage}}" overflowed the small button (now "Approve" / "Retry"; the card already shows its stage). The Command Center tab had the same undefined token on its selected tab and pending badge (`command-center/panel.tsx`); it is fixed in source and ships with the next app build.
- `bun run check` passes; previous build: `~/cheyenne-backups/Cheyenne-pre-rooms.app`.

## C6 — workers over ACP (2026-10-21, branch `cheyenne-acp`)

`run_worker` now drives each worker over the Agent Client Protocol: JSON-RPC 2.0 on the agent's stdio, one message per line, protocol v1. Cheyenne is the client.
- The client is `packages/plugins/workers/acp.ts`. It is Node stdlib only, so `bun mission.ts` still runs outside the server. The fork's own `@agentclientprotocol/sdk` is the agent side (`opencode acp`) and is not hoisted, so it isn't used.
- Each run goes through these steps:
  - initialize, with no fs or terminal capabilities offered, so each agent uses its own tools;
  - `session/new` in the mission folder;
  - `session/set_mode` (codex: `workspace-write`);
  - `session/prompt` with the brief.
- The `session/update` stream (messages, tool calls with diffs, tool results, plans) is the live view, through the same `onData` → `context.progress` path as before.
- **Permission policy** (`decide`): edits, deletes and moves are allowed only when every path is inside the mission folder (real paths, so /var ↔ /private/var). Reads are allowed anywhere, because briefs point at files like DESIGN-SYSTEM.md. Shell commands are allowed when they run in the mission folder (owner 2026-10-22): claude, cursor and grok send no cwd, so they run in the session folder; a command that names a cwd outside is denied. This is not containment (a command can still `cd ..`), only what the CLI fallback already allowed. Fetch and anything unknown are denied.
  - This replaces the gated flags, but only on the ACP path. The shell rows keep their flags.
  - Codex and grok end the turn on a rejection. The runner then tells them what was denied and lets them carry on, at most 3 times.
- **Fallback**: if the agent can't start or open a session (missing binary, no handshake in 2 minutes), `run_worker` runs the old CLI row instead and says so in the output. Kept as before: `brain log -a <worker>`, which now says `over acp` or `over cli`; the 30-minute limit (exit 124); and abort.
- The rooms readers (`ask()`: judge, planner, Mastermind) still use the shell, read-only.

| worker | agent command | install / source | login |
|---|---|---|---|
| claude | `claude-agent-acp` | `npm i -g @agentclientprotocol/claude-agent-acp` (0.94.0; `@zed-industries/claude-code-acp` is the old name) | Claude Code subscription login; no API key in the env |
| codex | `env CODEX_CONFIG={"model":"gpt-5.6-sol"} codex-acp` | `npm i -g @agentclientprotocol/codex-acp` (2.2.2, bundles codex ^0.160). The old `@zed-industries/codex-acp` 0.16 can't parse effort `max` and was removed | ChatGPT login (`~/.codex`) |
| cursor | `cursor-agent acp` | built in (hidden subcommand, 2026.10.19) | cursor-agent login |
| grok | `grok agent --no-leader stdio` | built in (grok 1.0.52) | grok login |

`codex app-server` is OpenAI's own protocol, not ACP.

**Check.** `bun test` in packages/plugins/workers runs 9 tests:
- `acp.test.ts`: the policy; a fake ACP agent (plan, diff, an allowed edit, a denied command, a cancelled turn and its follow-up); and the handshake failure that triggers the fallback;
- plus the rooms tests.

**Verified** 2026-10-21. Each worker ran "Create hello.txt containing READY" through the app's background server (`opencode-cli run -m openai/gpt-5.6-sol`, which called `run_worker`). All four wrote READY, logged `finished in 11–14s over acp`, and streamed `▸ <tool> [kind]` / `✔ allowed` / `✓` / diff lines into the tool output.
- An earlier probe from the shell gave each worker an outside write (`~/cheyenne-acp-outside-<worker>.txt`). All four were denied, and no file was created.
- Commands are gated differently by each agent:
  - claude and grok run their own "safe" commands (e.g. `date`) without asking;
  - codex runs commands in its workspace sandbox, which also allows /tmp and $TMPDIR;
  - cursor asks for them, and the policy denies them.

**Known.**
- Commands in the mission folder are allowed since 2026-10-22: cursor and grok each ran `git init` + `git commit` over ACP in a temp folder (both `end_turn`, a commit made).
- The server's default model, OpenCode Zen, fails with "This API key has expired" (owner-side). Use `-m openai/...` or renew the key.

## Gap 2 — Claude Code-style status line under the composer (2026-10-25, branch `claude/cheyenne-statusline-6aa244`)

**Setting.** `statusLine: { "type": "command", "command": "…", "padding": 0 }`, as in Claude Code. Read on every run, last one found wins: `~/.config/opencode/opencode.json(c)`, `<dir>/opencode.json(c)`, `~/.claude/settings.json`, `<dir>/.claude/settings.json`, `<dir>/.claude/settings.local.json`.

**Run.** The main process runs the command in `zsh -lc`, in the session folder, with the session JSON on stdin (5 s timeout). Keys follow Claude Code: `hook_event_name`, `session_id`, `cwd`, `model{id, display_name}`, `workspace{current_dir, project_dir}`, `cost{total_cost_usd}`, `context_window{total_input_tokens, total_output_tokens, context_window_size, used_percentage}`. `output_style` is absent until Gap 3 is merged. The first stdout line is drawn under the composer with its ANSI colours (16, 256 and truecolor; bold, dim, italic, underline); other escapes are dropped. It refreshes on message and session changes, at most every 300 ms. A failure, or no setting, draws nothing.

Core edits (each marked `// cheyenne`):
- `packages/gui-extensions/src/sdk/registries.ts`: a `session.composer` slot.
- `packages/app/src/session/composer/region.tsx`: a `footer` prop, rendered under the composer.
- `packages/app/src/session/screen.tsx`: passes `<ExtensionSlot at="session.composer">` as that footer.
- `packages/gui-extensions/src/{main,renderer}.ts`, README: register the `statusline` built-in.

Added: `packages/gui-extensions/src/statusline/` (contract, main, renderer, `line.ts` payload + ANSI parser, `line.test.ts`), `docs/statusline-sample.sh` (model, git branch, folder), proof `docs/statusline-proof.png`.

**Verified** 2026-10-25 in an isolated dev build (`OPENCODE_DESKTOP_TEST_ROOT`, own server on 3084): a session in a folder whose `.claude/settings.json` runs the sample shows `Flint 40B Free on statusline-demo in statusline-demo` in colour, and it updated live when the model was switched; a session elsewhere showed the owner's `~/.claude/settings.json` ponytail line.
