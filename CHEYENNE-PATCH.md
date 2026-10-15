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
- **grok: not verified.** xAI's Grok Build CLI (`grok` 1.0.52, installed with `curl -fsSL https://x.ai/cli/install.sh
  | bash` into `~/.grok`; the same CLI Paperclip's `grok_local` adapter drives) runs headless with `--single` and
  signs in with the subscription (`grok login --device-auth`, stored in `~/.grok/auth.json`), no API key. The
  owner has not finished that sign-in, so `grok models` says "You are not authenticated" and no grok run was made.
  After `grok login --device-auth`, the grok row needs no change. `gbot` was not used (Keychain prompt).
- **Gotcha:** the Grok installer overwrote `~/.local/bin/agent` (Cursor's `agent` link). It was put back:
  `ln -sf "$(readlink ~/.local/bin/cursor-agent)" ~/.local/bin/agent`. `cursor-agent` itself was untouched.

## Not branded yet

In-app copy that says "OpenCode" (i18n strings, About, onboarding), the big `opencode` wordmark on the empty
session screen, the `opencode://` scheme, typography (white condensed capitals). Left for later so the patch stays thin.
