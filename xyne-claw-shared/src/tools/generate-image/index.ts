/**
 * Generate Image tool — AI-powered image generation via LiteLLM/image-gen APIs.
 * Creates images from text prompts and returns them as attachments.
 */

import https from "node:https";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";

import { createLogger } from "../../logger.js";
const log = createLogger("index");

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** POST JSON using native https */
function httpsPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

// ─── Config schema ────────────────────────────────────────────────────────────

export const GENERATE_IMAGE_CONFIG_SCHEMA = {
  IMAGE_GENERATION_MODEL: {
    label: "Image Generation Model",
    default: "",
    required: true as const,
    placeholder: "dall-e-3, stability-diffusion-xl, etc.",
  },
  IMAGE_GENERATION_ENDPOINT: {
    label: "Image Generation Endpoint",
    default: "",
    required: true as const,
    placeholder: "https://api.openai.com/v1/images/generations",
  },
  IMAGE_GENERATION_API_KEY: {
    label: "Image Generation API Key",
    default: "",
    required: true as const,
    placeholder: "sk-...",
  },
  FILE_STORAGE_PROVIDER: {
    label: "File Storage Provider",
    default: "gcs",
    required: false as const,
    placeholder: "gcs | s3 | local",
  },
  GCS_BUCKET_NAME: {
    label: "GCS Bucket Name",
    default: "",
    required: false as const,
    placeholder: "my-bucket",
  },
  GCS_FAKE_GCS_HOST: {
    label: "Fake GCS Host (for local dev)",
    default: "",
    required: false as const,
    placeholder: "localhost:4443",
  },
};

// ─── Tool definition ──────────────────────────────────────────────────────────

export const generateImageTool: ToolDefinition = {
  slug: "generate-image",
  name: "Generate Image",
  description:
    "Generate an image from a text description using AI image generation models. " +
    "Returns the generated image as an attachment that can be viewed or downloaded. " +
    "Best for: illustrations, diagrams, artwork, concept visualization.",
  source: "custom:generate-image",
  configSchema: GENERATE_IMAGE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed description of the image to generate. Include subject, style, colors, " +
          "mood, lighting, and composition for best results. Be specific about what you want.",
      },
      height: {
        type: "integer",
        minimum: 256,
        maximum: 2048,
        description: "Height of the generated image in pixels (default: 1024).",
      },
      width: {
        type: "integer",
        minimum: 256,
        maximum: 2048,
        description: "Width of the generated image in pixels (default: 1024).",
      },
    },
    required: ["prompt"],
  },

  async execute(params, context: ToolExecutionContext | undefined): Promise<string> {
    const prompt = (params["prompt"] as string | undefined)?.trim();
    const height = (params["height"] as number | undefined) ?? 1024;
    const width = (params["width"] as number | undefined) ?? 1024;

    if (!prompt) return "Error: prompt is required.";

    const config = context?.config ?? {};
    const imageModel = String(config["IMAGE_GENERATION_MODEL"] || process.env["IMAGE_GENERATION_MODEL"] || "").trim();
    const imageEndpoint = String(config["IMAGE_GENERATION_ENDPOINT"] || process.env["IMAGE_GENERATION_ENDPOINT"] || "").trim();
    const apiKey = String(config["IMAGE_GENERATION_API_KEY"] || process.env["IMAGE_GENERATION_API_KEY"] || "").trim();

    if (!imageModel) return "Error: IMAGE_GENERATION_MODEL is not configured.";
    if (!imageEndpoint) return "Error: IMAGE_GENERATION_ENDPOINT is not configured.";
    if (!apiKey) return "Error: IMAGE_GENERATION_API_KEY is not configured.";

    

    try {
      // Call image generation API
      const imgRes = await httpsPost(
        imageEndpoint,
        JSON.stringify({ model: imageModel, prompt, height, width }),
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      );

      if (imgRes.status < 200 || imgRes.status >= 300) {
        throw new Error(`Image generation failed: ${imgRes.status} — ${imgRes.text.slice(0, 300)}`);
      }

      const imgData = JSON.parse(imgRes.text) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };

      const item = imgData.data?.[0];
      if (!item) throw new Error("No image data returned from model");

      // Get image buffer and MIME type
      let imageBuffer: Buffer;
      let mimeType = "image/png";
      let ext = "png";

      if (item.b64_json) {
        imageBuffer = Buffer.from(item.b64_json, "base64");
      } else if (item.url) {
        const urlLower = item.url.toLowerCase();
        if (urlLower.includes(".jpg") || urlLower.includes(".jpeg")) {
          mimeType = "image/jpeg";
          ext = "jpg";
        } else if (urlLower.includes(".webp")) {
          mimeType = "image/webp";
          ext = "webp";
        }
        imageBuffer = await fetchBuffer(item.url);
      } else {
        throw new Error("Response contained neither b64_json nor url");
      }

      // Create safe filename from prompt
      const safePrompt = prompt.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const fileName = `${safePrompt}.${ext}`;


      // Return attachment marker format used by the system
      return (
        `[ATTACHMENT:${fileName}:${mimeType}]\n` +
        `${imageBuffer.toString("base64")}\n\n` +
        `Generated image "${fileName}" (${width}x${height}px) from prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[generate-image] error: ${msg}`);
      return `Error generating image: ${msg}`;
    }
  },
};