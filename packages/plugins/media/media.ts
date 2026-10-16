#!/usr/bin/env bun
// Cheyenne C4: image generation + brand LoRAs, ported from Gandalf's bin/gandalf-imagegen and bin/gandalf-lora.
// Keys and brand data stay where Gandalf keeps them: GOOGLE_AI_API_KEY / FAL_KEY from the environment or
// ~/gandalf/.env (gitignored), LoRA references from ~/gandalf/brand_context/<brand>/loras/<name>.json.
// Images land in ~/.cheyenne/media/<brand>/.
//   bun media.ts generate "<prompt>" [brand] [lora]   |   bun media.ts loras
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { extname, join } from "node:path"

const GANDALF = join(homedir(), "gandalf")
const BRANDS = join(GANDALF, "brand_context")
const MEDIA = join(homedir(), ".cheyenne", "media")

function key(name: string) {
  if (process.env[name]) return process.env[name]
  const env = join(GANDALF, ".env")
  if (!existsSync(env)) return undefined
  for (const line of readFileSync(env, "utf8").split("\n")) {
    const [k, ...v] = line.trim().split("=")
    if (k === name) return v.join("=").trim().replace(/^["']|["']$/g, "") || undefined
  }
}

export type Lora = { name: string; brand: string; trigger: string; lora_url: string; scale?: number; infer_model?: string }

export function loras(): Lora[] {
  if (!existsSync(BRANDS)) return []
  return readdirSync(BRANDS).flatMap((brand) => {
    const dir = join(BRANDS, brand, "loras")
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ brand, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }) as Lora)
  })
}

function brands() {
  return existsSync(BRANDS) ? readdirSync(BRANDS).filter((b) => existsSync(join(BRANDS, b, "brand.md"))) : []
}

async function post(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}: ${text.slice(0, 600)}`)
  return JSON.parse(text)
}

async function google(prompt: string, n: number, model: string, signal?: AbortSignal) {
  const k = key("GOOGLE_AI_API_KEY")
  if (!k) throw new Error("GOOGLE_AI_API_KEY not set (environment or ~/gandalf/.env)")
  const out: Buffer[] = []
  for (let i = 0; i < n; i++) {
    // free image models return one image per call
    const res = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } },
      { "x-goog-api-key": k },
      signal,
    )
    const parts = (res.candidates ?? []).flatMap((c: any) => c.content?.parts ?? [])
    const data = parts.map((p: any) => (p.inlineData ?? p.inline_data)?.data).filter(Boolean)
    if (!data.length) throw new Error(`No image in Google response: ${JSON.stringify(res).slice(0, 600)}`)
    out.push(...data.map((d: string) => Buffer.from(d, "base64")))
  }
  return out
}

async function fal(model: string, payload: Record<string, unknown>, signal?: AbortSignal) {
  const k = key("FAL_KEY")
  if (!k) throw new Error("FAL_KEY not set (environment or ~/gandalf/.env)")
  const res = await post(`https://fal.run/${model}`, payload, { Authorization: `Key ${k}` }, signal)
  const out: Buffer[] = []
  for (const img of res.images ?? []) out.push(Buffer.from(await (await fetch(img.url, { signal })).arrayBuffer()))
  if (!out.length) throw new Error(`No images in FAL response: ${JSON.stringify(res).slice(0, 600)}`)
  return out
}

function dataUri(path: string) {
  const ext = extname(path).slice(1).toLowerCase()
  const mime = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] ?? "application/octet-stream"
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`
}

function ext(raw: Buffer) {
  if (raw[0] === 0xff && raw[1] === 0xd8) return "jpg"
  if (raw.subarray(1, 4).toString() === "PNG") return "png"
  if (raw.subarray(8, 12).toString() === "WEBP") return "webp"
  return "img"
}

export type GenerateInput = {
  prompt: string
  brand?: string
  provider?: "google" | "fal"
  model?: string
  lora?: string
  lora_scale?: number
  n?: number
  size?: string
  image?: string
  strength?: number
  name?: string
}

export async function generate(input: GenerateInput, signal?: AbortSignal) {
  const n = Math.max(1, Math.min(input.n ?? 1, 4))
  let brand = input.brand
  const envProvider = (key("GANDALF_IMAGE_PROVIDER") as "google" | "fal" | undefined) || "google"
  let provider = input.provider ?? envProvider
  // the .env model id belongs to the .env provider (it is fal-ai/flux/dev today), so it is not applied to the other one
  let model = input.model ?? (provider === envProvider ? key("GANDALF_IMAGE_MODEL") : undefined)
  let prompt = input.prompt
  let lora: string | undefined

  const size = input.size?.match(/^(\d+)x(\d+)$/i)
  const image_size = size ? { width: +size[1], height: +size[2] } : input.size
  const image_url = input.image && (/^(https?|data):/.test(input.image) ? input.image : dataUri(input.image))

  let images: Buffer[]
  if (input.lora) {
    const ref = loras().find((l) => l.name === input.lora && (!brand || l.brand === brand))
    if (!ref) throw new Error(`No LoRA '${input.lora}'. Saved: ${loras().map((l) => l.name).join(", ") || "none"}`)
    brand = ref.brand
    // LoRAs run on the FAL flux-lora engine whatever the default provider is; the trigger word must be in the prompt
    if (!prompt.toLowerCase().includes(ref.trigger.toLowerCase())) prompt = `${ref.trigger} ${prompt}`
    const scale = input.lora_scale ?? ref.scale ?? 1
    model = ref.infer_model ?? "fal-ai/flux-lora"
    if (image_url && !model.includes("image-to-image")) model = `${model}/image-to-image`
    provider = "fal"
    lora = `${ref.name}@${scale}`
    images = await fal(model, payload(prompt, n, image_size, image_url, input.strength, [{ path: ref.lora_url, scale }]), signal)
  } else if (provider === "fal") {
    model ??= "fal-ai/flux/dev"
    if (image_url && !model.includes("image-to-image")) model = `${model}/image-to-image`
    images = await fal(model, payload(prompt, n, image_size, image_url, input.strength), signal)
  } else {
    if (image_url) throw new Error("image-to-image needs provider fal (or a lora)")
    model ??= "gemini-2.5-flash-image"
    images = await google(prompt, n, model, signal)
  }

  brand ??= readIfExists(join(GANDALF, "identity", "active_brand")) || brands()[0] || "default"
  const dir = join(MEDIA, brand)
  mkdirSync(dir, { recursive: true })
  const slug = (input.name ?? `img-${new Date().toISOString().replace(/[:.]/g, "-")}`).replace(/\//g, "-")
  const paths = images.map((raw, i) => {
    const p = join(dir, `${slug}${images.length > 1 ? `-${i + 1}` : ""}.${ext(raw)}`)
    writeFileSync(p, raw)
    return p
  })
  return { provider, model, brand, lora, prompt, paths }
}

function payload(prompt: string, n: number, image_size: unknown, image_url?: string, strength?: number, loras?: unknown) {
  return {
    prompt,
    num_images: n,
    ...(image_size ? { image_size } : {}),
    ...(image_url ? { image_url } : {}),
    ...(strength !== undefined ? { strength } : {}),
    ...(loras ? { loras } : {}),
  }
}

function readIfExists(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : ""
}

if (import.meta.main) {
  const [cmd, prompt, brand, lora] = process.argv.slice(2)
  if (cmd === "loras") console.log(JSON.stringify(loras(), null, 2))
  else if (cmd === "generate" && prompt)
    console.log(JSON.stringify(await generate({ prompt, brand: brand || undefined, lora: lora || undefined }), null, 2))
  else console.log('usage: bun media.ts generate "<prompt>" [brand] [lora]  |  bun media.ts loras')
}
