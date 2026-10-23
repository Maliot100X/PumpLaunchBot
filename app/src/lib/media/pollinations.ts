/**
 * Pollinations image generation — the artwork half of the recreate flow.
 *
 * Rules taken from the owner's instruction and from the provider's own docs (gen.pollinations.ai):
 *  - the ONLY image model used here is `black-forest-labs/flux.1-schnell`. No fal, no MiniMax, no
 *    OpenAI image models. Measured live: GET /image/{prompt}?model=black-forest-labs/flux.1-schnell
 *    answers 200 image/jpeg, and the returned EXIF itself reports
 *    `manufacturer=black-forest-labs/flux.1-schnell`.
 *  - the API key stays on the server. It is never put in a URL the browser can read, which is why the
 *    bytes are fetched here and handed on (to be pinned) rather than returning a keyed URL.
 */

const BASE = "https://gen.pollinations.ai";
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.1-schnell";
export const DEFAULT_EDIT_MODEL = "black-forest-labs/flux.1-kontext-pro";

export type GeneratedImage = {
  /** Raw image bytes, ready to pin. */
  bytes: Uint8Array;
  contentType: string;
  model: string;
  prompt: string;
};

function apiKey(): string | null {
  return process.env.POLLINATIONS_API_KEY?.trim() || null;
}

/** The model this deployment will use. Defaults to flux.1-schnell and nothing else. */
export function imageModel(): string {
  return process.env.POLLINATIONS_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

export function isConfigured(): boolean {
  return apiKey() !== null;
}

/** Prompt URL WITHOUT the key — safe to log or show. */
export function promptUrl(prompt: string, opts: { width?: number; height?: number; seed?: number } = {}): string {
  const model = imageModel();
  const params = new URLSearchParams({ model, width: String(opts.width ?? 1024), height: String(opts.height ?? 1024) });
  if (opts.seed !== undefined) params.set("seed", String(opts.seed));
  return `${BASE}/image/${encodeURIComponent(prompt)}?${params.toString()}`;
}

/**
 * Generate an image and return its bytes. Throws a named error when the provider refuses, so the
 * caller can report the real reason instead of shipping a broken <img>.
 */
export async function generateImage(
  prompt: string,
  opts: { width?: number; height?: number; seed?: number; timeoutMs?: number } = {},
): Promise<GeneratedImage> {
  const key = apiKey();
  if (!key) throw new Error("POLLINATIONS_API_KEY is not configured");
  if (!prompt.trim()) throw new Error("refusing to generate an image without a prompt");

  const url = `${promptUrl(prompt, opts)}&key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`pollinations answered ${res.status} ${res.statusText} for model ${imageModel()}`);
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      throw new Error(`pollinations returned ${contentType}, not an image`);
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType,
      model: imageModel(),
      prompt,
    };
  } finally {
    clearTimeout(timer);
  }
}
