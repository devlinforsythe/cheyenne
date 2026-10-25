import { expect, test } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compose, current, load, save } from "./styles"

test("loads built-in, user and project styles and composes the system prompt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "output-styles-"))
  const home = path.join(root, "home")
  const project = path.join(root, "project")
  await mkdir(path.join(home, ".claude", "output-styles"), { recursive: true })
  await Bun.write(
    path.join(home, ".claude", "output-styles", "pirate.md"),
    "---\nname: Pirate\ndescription: Talk like a pirate\n---\nAlways answer like a pirate.\n",
  )
  await Bun.write(
    path.join(project, ".claude", "output-styles", "terse.md"),
    "---\nname: Terse\ndescription: Short answers\nkeep-coding-instructions: true\n---\nKeep answers under three lines.\n",
  )

  const styles = await load(project, home)
  expect(styles.map((style) => style.name)).toEqual(["Default", "Explanatory", "Learning", "Pirate", "Terse"])
  expect(await current(project, home)).toBe("Default")

  await save(project, "Pirate")
  expect(await current(project, home)).toBe("Pirate")

  const pirate = styles.find((style) => style.name === "Pirate")!
  const terse = styles.find((style) => style.name === "Terse")!
  expect(compose("CODING", pirate)).toBe("Always answer like a pirate.")
  expect(compose("CODING", terse)).toBe("CODING\n\nKeep answers under three lines.")
  expect(compose("CODING", styles[0])).toBe("CODING")
})
