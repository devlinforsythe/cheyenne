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
| `packages/desktop/icons/dev/*` | binary: every dev icon replaced from `~/gandalf/media/cheyenne/cheyenne-icon-1024.png` (`icon.icns` built with the macOS 824/1024 inset) |

## Added files (no merge cost)

- `packages/ui/src/theme/themes/cheyenne.json` — the Cheyenne theme. Desktop themes live here, not in
  `packages/theme` (that package is the TUI's). It is picked up by the `themes/*.json` glob, so no registry edit.
  Dark: tunnel black `#11171b`, white-caps ink `#ece8df`, rust arch primary `#b4532f`, tunnel-lamp accent `#f2a640`,
  steel info `#8fa4b0`. Light: concrete `#e4e0d8` with the same rust / lamp / steel.

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

## Not branded yet

In-app copy that says "OpenCode" (i18n strings, About, onboarding), the big `opencode` wordmark on the empty
session screen, the `opencode://` scheme, typography (white condensed capitals). Left for later so the patch stays thin.
