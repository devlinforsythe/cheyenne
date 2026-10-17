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
