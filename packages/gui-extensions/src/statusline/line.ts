/** The session as Claude Code hands it to a status line command on stdin. */
export function payload(input: {
  sessionID: string
  directory: string
  project?: string
  model?: { id: string; name?: string }
  cost: number
  tokens?: { input: number; output: number }
  limit?: number
  outputStyle?: string
}) {
  const used = input.tokens ? input.tokens.input + input.tokens.output : 0

  return JSON.stringify({
    hook_event_name: "Status",
    session_id: input.sessionID,
    cwd: input.directory,
    model: { id: input.model?.id ?? "", display_name: input.model?.name ?? input.model?.id ?? "" },
    workspace: { current_dir: input.directory, project_dir: input.project ?? input.directory },
    // Undefined drops out of the JSON: Cheyenne has no output style until one is set.
    output_style: input.outputStyle ? { name: input.outputStyle } : undefined,
    cost: { total_cost_usd: input.cost },
    context_window: {
      total_input_tokens: input.tokens?.input ?? 0,
      total_output_tokens: input.tokens?.output ?? 0,
      context_window_size: input.limit ?? null,
      used_percentage: input.limit ? Math.round((used / input.limit) * 100) : null,
    },
  })
}

type Style = {
  color?: string
  background?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** Splits a line into runs of text and the style its SGR escapes give them; every other escape is dropped. */
export function ansi(line: string) {
  const segments: { text: string; style: Style }[] = []
  const pattern = /\x1b\[([\d;]*)m|\x1b(?:\[[\d;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g
  let style: Style = {}
  let last = 0

  for (const match of line.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: line.slice(last, match.index), style })

    last = match.index + match[0].length

    if (match[1] !== undefined) style = sgr(style, match[1])
  }

  if (last < line.length) segments.push({ text: line.slice(last), style })

  return segments
}

// One token per attribute, a 256-colour or RGB colour kept whole; "\x1b[m" is a reset.
const sgr = (current: Style, params: string) =>
  (params.match(/[34]8;5;\d*|[34]8;2;\d*;\d*;\d*|\d+/g) ?? ["0"]).reduce<Style>(
    (style, token) => (Number(token) === 0 ? {} : Object.assign(style, attribute(token.split(";").map(Number)))),
    { ...current },
  )

function attribute(codes: number[]): Style {
  const code = codes[0] ?? 0

  if (code === 38 || code === 48) {
    const value =
      codes[1] === 5
        ? indexed(codes[2] ?? 0)
        : `rgb(${codes
            .slice(2)
            .map((n) => n || 0)
            .join(", ")})`

    return code === 38 ? { color: value } : { background: value }
  }

  if (code >= 30 && code <= 37) return { color: BASIC[code - 30] }

  if (code >= 90 && code <= 97) return { color: BASIC[code - 82] }

  if (code >= 40 && code <= 47) return { background: BASIC[code - 40] }

  if (code >= 100 && code <= 107) return { background: BASIC[code - 92] }

  return FLAGS[code] ?? {}
}

const FLAGS: Record<number, Style> = {
  1: { bold: true },
  2: { dim: true },
  3: { italic: true },
  4: { underline: true },
  22: { bold: undefined, dim: undefined },
  23: { italic: undefined },
  24: { underline: undefined },
  39: { color: undefined },
  49: { background: undefined },
}

// The xterm palette.
const BASIC = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
]

function indexed(n: number) {
  if (n < 16) return BASIC[n]

  if (n >= 232) return `rgb(${8 + (n - 232) * 10}, ${8 + (n - 232) * 10}, ${8 + (n - 232) * 10})`

  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  const i = n - 16

  return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`
}
