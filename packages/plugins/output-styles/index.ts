import { Plugin } from "@opencode/plugin"
import { OutputStylesRpc } from "./rpc"
import { compose, current, load, save } from "./styles"

export default Plugin.define({
  id: "cheyenne.output-styles",
  async setup(ctx) {
    const project = ctx.location.project.directory

    const hook = async (event: { agent: string; system: { text: string }[] }) => {
      const system = event.system[0]
      if (!system) return
      const name = (await current(project)).toLowerCase()
      const style = (await load(project)).find((style) => style.name.toLowerCase() === name)
      if (!style?.prompt) return
      // Agents with their own system prompt (plan, explore, …) keep it, as with the built-in prompt plugins.
      if ((await ctx.agent.get({ agentID: event.agent })).data.system) return
      event.system[0] = { ...system, text: compose(system.text, style) }
    }
    await ctx.session.hook("context", hook)
    await ctx.session.hook("generate", hook)

    const set = async (name: string) => {
      const style = (await load(project)).find((style) => style.name.toLowerCase() === name.toLowerCase())
      if (!style) return undefined
      await save(project, style.name)
      return style.name
    }

    await ctx.command.transform((editor) =>
      editor.add({
        name: "output-style",
        description: "Show or switch the output style (Default, Explanatory, Learning, or your own)",
        execute: async ({ sessionID, prompt }) => {
          const name = prompt.text.trim()
          const chosen = name ? await set(name) : undefined
          const styles = await load(project)
          const active = await current(project)
          const list = styles.map((style) => `- ${style.name}${style.name === active ? " (current)" : ""}: ${style.description}`)
          const text = [
            name && !chosen ? `No output style named "${name}".` : `Output style: ${active}`,
            ...(name && chosen ? [] : ["", ...list, "", "Switch with /output-style <name>."]),
          ].join("\n")
          await ctx.session.synthetic({ sessionID, text, resume: false })
        },
      }),
    )

    await ctx.rpc.register(OutputStylesRpc, {
      list: async () => ({
        current: await current(project),
        styles: (await load(project)).map((style) => ({
          name: style.name,
          description: style.description,
          source: style.source,
        })),
      }),
      set: async (input) => {
        const name = await set(input.name)
        if (!name) throw new Error(`No output style named "${input.name}"`)
        return { current: name }
      },
    })
  },
})
