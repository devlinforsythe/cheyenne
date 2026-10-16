import { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import { generate, loras } from "./media"

// Cheyenne C4: Gandalf's image generation and brand LoRAs as tools.
export default Plugin.define({
  id: "cheyenne.media",
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "image_generate",
        options: { codemode: false },
        description: [
          "Generate images. provider google (Gemini image, the default) or fal (Flux). Pass `lora` to use a saved",
          "brand LoRA for real-product fidelity (call lora_list for names): wolfe-standard = Wölfe Cutlery knives,",
          "studio84-panel = Recode Audio Studio 84 panel style; a LoRA forces the FAL flux-lora engine and adds its",
          "trigger word. `image` (local path or URL) does image-to-image on fal. Files land in ~/.cheyenne/media/<brand>/.",
          "Brand looks live in ~/gandalf/brand_context/<brand>/visual.md; read it before writing a brand prompt.",
          "Public copy never says \"Universal Audio\" or \"UA\".",
        ].join(" "),
        input: Schema.Struct({
          prompt: Schema.String,
          brand: Schema.optionalKey(Schema.String).annotate({ description: "wolfe_cutlery or recode_audio (sets the output folder)" }),
          provider: Schema.optionalKey(Schema.Literals(["google", "fal"])),
          model: Schema.optionalKey(Schema.String).annotate({ description: "Override the provider's model id" }),
          lora: Schema.optionalKey(Schema.String),
          lora_scale: Schema.optionalKey(Schema.Number),
          n: Schema.optionalKey(Schema.Number).annotate({ description: "How many images, 1-4 (default 1)" }),
          size: Schema.optionalKey(Schema.String).annotate({ description: "fal only: WxH or a preset like landscape_4_3" }),
          image: Schema.optionalKey(Schema.String).annotate({ description: "Source image for image-to-image (fal)" }),
          strength: Schema.optionalKey(Schema.Number).annotate({ description: "img2img strength 0-1, lower = closer to source" }),
          name: Schema.optionalKey(Schema.String).annotate({ description: "Filename slug" }),
        }),
        async execute(input, context) {
          const r = await generate(input, context.signal)
          return {
            content: `${r.paths.length} image(s) via ${r.provider} ${r.model}${r.lora ? ` + ${r.lora}` : ""}:\n${r.paths.join("\n")}`,
            // ponytail: JSON round-trip drops `lora: undefined`, which otherwise loses the whole tool result
            metadata: JSON.parse(JSON.stringify(r)),
          }
        },
      })
      tools.add({
        name: "lora_list",
        options: { codemode: false },
        description: "List the saved brand LoRAs image_generate can use: name, brand, trigger word, default scale.",
        input: Schema.Struct({}),
        async execute() {
          const list = loras()
          return {
            content: list.map((l) => `${l.name} (${l.brand}) trigger=${l.trigger} scale=${l.scale ?? 1}`).join("\n") || "No LoRAs saved.",
            metadata: {},
          }
        },
      })
    })
  },
})
