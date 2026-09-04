/**
 * PPT tools — LLM-driven slide-JSON generation + PptxGenJS renderer.
 *
 * - create-ppt: takes a brief + slide count, produces a fresh deck.
 * - edit-ppt:   takes previous slide JSON + a change request, rewrites only
 *               the parts that need to change.
 *
 * Both return the rendered file as an attachment marker followed by the slide
 * JSON so the main agent has the source-of-truth JSON available for
 * subsequent edits.
 */

import https from "node:https";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { PPTX_DESIGNER_SYSTEM_PROMPT } from "./prompt.js";

import { createLogger } from "../../logger.js";
const log = createLogger("tools");

// ─── HTTP helper ─────────────────────────────────────────────────────────────

/** POST JSON using native https — bypasses undici/fetch HTTP/2 GOAWAY issues. */
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
        port: parsed.port || undefined,
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

// ─── Sanitizers ──────────────────────────────────────────────────────────────

function stripHashes(val: unknown): unknown {
  if (typeof val === "string") return /^#[0-9A-Fa-f]{3,8}$/.test(val) ? val.slice(1) : val;
  if (Array.isArray(val)) return val.map(stripHashes);
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = stripHashes(v);
    return out;
  }
  return val;
}

function sanitizeOptions(options: unknown, elementType: string): Record<string, unknown> {
  if (!options || typeof options !== "object") return {};

  const opts = stripHashes({ ...(options as Record<string, unknown>) }) as Record<string, unknown>;

  if (typeof opts["fill"] === "string") opts["fill"] = { color: opts["fill"] };
  if (typeof opts["line"] === "string") opts["line"] = { color: opts["line"] };

  if ("transparency" in opts) {
    if (elementType === "text") {
      delete opts["transparency"];
    } else {
      const fill = opts["fill"];
      if (fill && typeof fill === "object") {
        opts["fill"] = { ...(fill as Record<string, unknown>), transparency: opts["transparency"] };
      } else {
        opts["fill"] = { transparency: opts["transparency"] };
      }
      delete opts["transparency"];
    }
  }

  if (opts["font"] && !opts["fontFace"]) {
    opts["fontFace"] = opts["font"];
    delete opts["font"];
  }
  if (opts["size"] && !opts["fontSize"]) {
    opts["fontSize"] = opts["size"];
    delete opts["size"];
  }
  if (opts["fontsize"] && !opts["fontSize"]) {
    opts["fontSize"] = opts["fontsize"];
    delete opts["fontsize"];
  }
  if (opts["textAlign"] && !opts["align"]) {
    opts["align"] = opts["textAlign"];
    delete opts["textAlign"];
  }
  if (opts["verticalAlign"] && !opts["valign"]) {
    opts["valign"] = opts["verticalAlign"];
    delete opts["verticalAlign"];
  }

  for (const k of [
    "bold",
    "italic",
    "underline",
    "strike",
    "subscript",
    "superscript",
    "wrap",
    "isTextBox",
    "autoFit",
    "shrinkText",
  ]) {
    if (opts[k] === "true") opts[k] = true;
    else if (opts[k] === "false") opts[k] = false;
  }

  for (const k of [
    "x",
    "y",
    "w",
    "h",
    "fontSize",
    "margin",
    "charSpacing",
    "paraSpaceAfter",
    "paraSpaceBefore",
    "indentLevel",
    "lineSpacingMultiple",
    "rotate",
    "rectRadius",
  ]) {
    const v = opts[k];
    if (typeof v === "string" && !isNaN(Number(v))) opts[k] = Number(v);
  }

  if (opts["fill"] && typeof opts["fill"] === "object") opts["fill"] = stripHashes(opts["fill"]);
  if (opts["line"] && typeof opts["line"] === "object") opts["line"] = stripHashes(opts["line"]);
  if (opts["shadow"] && typeof opts["shadow"] === "object")
    opts["shadow"] = stripHashes(opts["shadow"]);

  return opts;
}

function sanitizeBackground(bg: unknown): unknown {
  if (!bg) return bg;
  if (typeof bg === "string") return { color: bg.replace(/^#/, "") };
  const out = { ...(bg as Record<string, unknown>) };
  if (typeof out["color"] === "string") out["color"] = (out["color"] as string).replace(/^#/, "");
  return out;
}

/** Extract a JSON object from an LLM response string. */
function extractJson(raw: string): string {
  const text = raw.trim();

  try {
    JSON.parse(text);
    return text;
  } catch {}

  const fenceStripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  try {
    JSON.parse(fenceStripped);
    return fenceStripped;
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  return text;
}

// ─── Shared constants ────────────────────────────────────────────────────────

const DEFAULT_PPT_MODEL = "kimi-latest";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Delimiters used to expose the slide JSON back to the agent. */
const JSON_START = "SLIDE_JSON_START";
const JSON_END = "SLIDE_JSON_END";

export const CREATE_PPT_CONFIG_SCHEMA = {
  // Provider/key/base-url for slide-JSON generation are no longer configured
  // here — the tool inherits the agent's resolved provider via
  // ToolExecutionContext.providerConfig (set by xyne-claw's run dispatcher).
  // Only the LiteLLM fallback (used when the run has no BYO provider) and an
  // optional model override for that fallback remain.
  LITELLM_URL: {
    label: "LiteLLM Proxy URL",
    default: "",
    required: true as const,
    placeholder: "https://grid.ai.example.com",
  },
  LITELLM_API_KEY: {
    label: "LiteLLM API Key",
    default: "",
    required: true as const,
    placeholder: "sk-...",
  },
  PPT_MODEL: {
    label: "Model for slide-JSON generation",
    // Default is empty so resolveLlmConfig can fall through to
    // process.env["PPT_MODEL"] → process.env["LITELLM_MODEL"] → DEFAULT_PPT_MODEL.
    // Otherwise resolveToolConfig would always populate config[PPT_MODEL] with
    // the schema default and the env fallback would be unreachable.
    default: "",
    required: false as const,
    placeholder: DEFAULT_PPT_MODEL,
  },
};

// ─── Internal helpers ────────────────────────────────────────────────────────

interface LlmConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  api: "openai-completions" | "anthropic-messages";
  authType: "api_key" | "oauth_token";
}

function resolveLlmConfig(context: ToolExecutionContext | undefined): LlmConfig | string {
  const config = context?.config ?? {};

  // Primary path: inherit the agent's resolved provider from the run context.
  // This is how slide generation uses "whatever model is configured" for the
  // agent (copilot proxy + base-URL defaulting already applied upstream).
  const pc = context?.providerConfig;
  if (pc?.apiKey && pc.model) {
    const provider = pc.provider.trim().toLowerCase();
    const authType = (pc.authType ?? "api_key").trim().toLowerCase() === "oauth_token"
      ? "oauth_token"
      : "api_key";
    if (provider === "claude") {
      let base = (pc.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      if (!/\/v1\/messages$/.test(base)) {
        if (/\/v1$/.test(base)) base = `${base}/messages`;
        else base = `${base}/v1/messages`;
      }
      return { endpoint: base, apiKey: pc.apiKey, model: pc.model, api: "anthropic-messages", authType };
    }
    let base = (pc.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
    return { endpoint: `${base}/chat/completions`, apiKey: pc.apiKey, model: pc.model, api: "openai-completions", authType };
  }

  // Fallback path: shared LiteLLM env/config (runs with no BYO provider).
  const baseUrlRaw =
    config["LITELLM_URL"] ||
    config["LITELLM_BASE_URL"] ||
    process.env["LITELLM_URL"] ||
    process.env["LITELLM_BASE_URL"] ||
    "";
  const apiKey = config["LITELLM_API_KEY"] || process.env["LITELLM_API_KEY"] || "";
  const model =
    config["PPT_MODEL"] ||
    process.env["PPT_MODEL"] ||
    process.env["LITELLM_MODEL"] ||
    DEFAULT_PPT_MODEL;

  if (!baseUrlRaw) return "Error: LITELLM_URL is not configured.";
  if (!apiKey) return "Error: LITELLM_API_KEY is not configured.";

  let base = baseUrlRaw.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
  return {
    endpoint: `${base}/chat/completions`,
    apiKey,
    model,
    api: "openai-completions",
    authType: "api_key",
  };
}

async function callLlmForSlides(
  llm: LlmConfig,
  userPrompt: string,
): Promise<{ title?: string; layout?: string; slides: unknown[] }> {
  if (llm.api === "anthropic-messages") {
    // x-api-key only: Claude creds are Anthropic API keys — the OAuth Bearer
    // path (subscription tokens) was removed.
    const authHeader = { "x-api-key": llm.apiKey };
    const res = await httpsPost(
      llm.endpoint,
      JSON.stringify({
        model: llm.model,
        system: PPTX_DESIGNER_SYSTEM_PROMPT,
        max_tokens: 8192,
        messages: [{ role: "user", content: userPrompt }],
        temperature: 0.3,
      }),
      {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...authHeader,
      },
    );

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`LLM call failed: ${res.status} — ${res.text.slice(0, 300)}`);
    }

    const data = JSON.parse(res.text) as { content?: Array<{ type?: string; text?: string }> };
    const rawContent = (data.content ?? [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (!rawContent) throw new Error("Empty LLM response");

    let parsed: { title?: string; layout?: string; slides: unknown[] };
    try {
      parsed = JSON.parse(extractJson(rawContent));
    } catch (err) {
      log.error(`[ppt] JSON parse failed. Raw (first 600): ${rawContent.slice(0, 600)}`);
      throw new Error(
        `LLM returned invalid JSON: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
      throw new Error("LLM returned no slides");
    }
    return parsed;
  }

  const res = await httpsPost(
    llm.endpoint,
    JSON.stringify({
      model: llm.model,
      messages: [
        { role: "system", content: PPTX_DESIGNER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      thinking: { type: "disabled" },
    }),
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llm.apiKey}`,
    },
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`LLM call failed: ${res.status} — ${res.text.slice(0, 300)}`);
  }

  const data = JSON.parse(res.text) as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("Empty LLM response");

  let parsed: { title?: string; layout?: string; slides: unknown[] };
  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch (err) {
    log.error(`[ppt] JSON parse failed. Raw (first 600): ${rawContent.slice(0, 600)}`);
    throw new Error(
      `LLM returned invalid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    throw new Error("LLM returned no slides");
  }
  return parsed;
}

async function renderPptBuffer(pptConfig: {
  title?: string;
  layout?: string;
  slides: unknown[];
}): Promise<{ buffer: Buffer; title: string; slideCount: number; skipped: number }> {
  // pptxgenjs v4 ships a dual CJS/ESM build. Under Node 22.12+ the ESM build
  // (pptxgen.es.js) can trip "Cannot require() ES Module … in a cycle" when
  // another dep loads it synchronously. Bypass by loading through createRequire,
  // which runs CJS resolution and hits the package's `require` condition →
  // pptxgen.cjs.js (a plain CommonJS module with `module.exports = PptxGenJS`).
  // We can't reference the dist path directly because pptxgenjs's `exports`
  // map doesn't expose subpaths.
  const { createRequire } = await import("node:module");
  const requireCjs = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires
  const PptxGenJS = requireCjs("pptxgenjs") as any;
  const pptx = new PptxGenJS();
  const title = pptConfig.title ?? "Presentation";
  const layout = pptConfig.layout ?? "LAYOUT_16x9";
  (pptx as unknown as { layout: string }).layout = layout;
  pptx.title = title;
  pptx.author = "Xyne AI";

  const pptxShapes = (pptx as unknown as { shapes: Record<string, unknown> }).shapes;
  const pptxCharts = (pptx as unknown as { charts: Record<string, unknown> }).charts;

  const slides = pptConfig.slides;
  let skipped = 0;

  for (let si = 0; si < slides.length; si++) {
    const slideConfig = slides[si] as Record<string, unknown> | undefined;
    if (!slideConfig) continue;

    let slide: ReturnType<typeof pptx.addSlide>;
    try {
      slide = pptx.addSlide();
      if (slideConfig["background"]) {
        (slide as unknown as { background: unknown }).background = sanitizeBackground(
          slideConfig["background"],
        );
      }
    } catch (slideErr) {
      log.warn(`[ppt] slide ${si + 1} init failed, skipping: ${slideErr}`);
      skipped++;
      continue;
    }

    const items = (slideConfig["objects"] ??
      slideConfig["elements"] ??
      slideConfig["content"] ??
      []) as unknown[];

    for (let oi = 0; oi < items.length; oi++) {
      const obj = items[oi] as Record<string, unknown> | undefined;
      if (!obj || typeof obj !== "object") continue;

      try {
        const type = String(obj["type"] ?? "").toLowerCase();
        const opts = sanitizeOptions(obj["options"] ?? {}, type);

        switch (type) {
          case "text": {
            const rawText = obj["text"];
            const content = Array.isArray(rawText)
              ? (rawText as Array<Record<string, unknown>>).map((r) => ({
                  text: String(r["text"] ?? r["value"] ?? ""),
                  options: sanitizeOptions(r["options"] ?? {}, "text"),
                }))
              : String(rawText ?? obj["value"] ?? "");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addText(content, opts);
            break;
          }
          case "shape":
          case "rect":
          case "rectangle": {
            const rawKey = String(
              obj["shape"] ??
                obj["shape_type"] ??
                (type === "rect" || type === "rectangle" ? "RECTANGLE" : "RECTANGLE"),
            ).toUpperCase();
            const shapeVal = pptxShapes[rawKey] ?? pptxShapes["RECTANGLE"];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addShape(shapeVal, opts);
            break;
          }
          case "image": {
            const imgOpts: Record<string, unknown> = { ...opts };
            if (!imgOpts["path"] && !imgOpts["data"] && obj["src"]) imgOpts["path"] = obj["src"];
            if (!imgOpts["path"] && !imgOpts["data"] && obj["url"]) imgOpts["path"] = obj["url"];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addImage(imgOpts);
            break;
          }
          case "chart": {
            const rawChartKey = String(
              obj["chart_type"] ?? obj["chartType"] ?? obj["type"] ?? "BAR",
            ).toUpperCase();
            const chartVal = pptxCharts[rawChartKey] ?? pptxCharts["BAR"];
            const rawData = (obj["data"] ?? obj["chart_data"] ?? []) as unknown[];
            const chartData = rawData.map((s) => {
              if (Array.isArray(s)) return s;
              const series = s as Record<string, unknown>;
              return {
                name: series["name"] ?? series["series"] ?? series["label"] ?? "Series",
                labels: series["labels"] ?? series["categories"] ?? [],
                values: series["values"] ?? series["data"] ?? [],
              };
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addChart(chartVal, chartData, opts);
            break;
          }
          case "table": {
            const rows = (obj["rows"] ?? obj["data"] ?? []) as unknown[];
            const normRows = rows.map((row) =>
              Array.isArray(row)
                ? row.map((cell) =>
                    typeof cell === "string" || typeof cell === "number"
                      ? { text: String(cell) }
                      : {
                          text: String(
                            (cell as Record<string, unknown>)["text"] ??
                              (cell as Record<string, unknown>)["value"] ??
                              "",
                          ),
                          options: sanitizeOptions(
                            (cell as Record<string, unknown>)["options"] ?? {},
                            "text",
                          ),
                        },
                  )
                : [],
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addTable(normRows, opts);
            break;
          }
          case "notes":
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (slide as any).addNotes(String(obj["text"] ?? obj["notes"] ?? ""));
            break;
          default:
            skipped++;
        }
      } catch (objErr) {
        skipped++;
        log.warn(
          `[ppt] slide ${si + 1} obj ${oi + 1} (type="${String(obj["type"])}") failed — skipping: ${
            objErr instanceof Error ? objErr.message : objErr
          }`,
        );
      }
    }
  }

  if (skipped > 0) log.warn(`[ppt] ${skipped} objects skipped due to errors`);

  const buffer = Buffer.from((await pptx.write({ outputType: "nodebuffer" })) as ArrayBuffer);
  return { buffer, title, slideCount: slides.length, skipped };
}

function formatAttachmentResponse(
  buffer: Buffer,
  title: string,
  pptConfig: { title?: string; layout?: string; slides: unknown[] },
): string {
  const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "presentation";
  const fileName = `${safeTitle}.pptx`;
  // Slide JSON is returned to the agent so it can pass it to edit-ppt on the
  // next turn. xyne-claw/src/custom-tools.ts strips the attachment marker and
  // keeps the remaining body as the tool result.
  const slidesJson = JSON.stringify(pptConfig);
  return (
    `[ATTACHMENT:${fileName}:${PPTX_MIME}]\n` +
    `${buffer.toString("base64")}\n\n` +
    `Rendered ${fileName} (${pptConfig.slides.length} slides). ` +
    `Slide JSON is below — pass it to edit-ppt if the user requests changes.\n\n` +
    `${JSON_START}\n${slidesJson}\n${JSON_END}`
  );
}

// ─── create-ppt ──────────────────────────────────────────────────────────────

export const createPptTool: ToolDefinition = {
  slug: "create-ppt",
  name: "Create Presentation",
  description:
    "Generate a PowerPoint (.pptx) presentation from a brief. The tool calls an LLM to design slide JSON, " +
    "renders it with pptxgenjs, and returns both the file attachment and the underlying slide JSON. " +
    "Pass the JSON back to edit-ppt if the user wants changes. " +
    "Provide a rich brief (topic, purpose, audience, tone, key points) and the number of slides (3–20).",
  source: "custom:create-ppt",
  configSchema: CREATE_PPT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Rich presentation brief: topic, purpose, audience, tone, key content points, " +
          "color/style preferences, and any specific slides or data to include.",
      },
      num_slides: {
        type: "integer",
        minimum: 3,
        maximum: 20,
        description: "Number of slides to generate (typically 8–12; default 10).",
      },
    },
    required: ["query", "num_slides"],
  },

  async execute(params, context) {
    const query = (params["query"] as string | undefined)?.trim();
    const numSlides = params["num_slides"] as number | undefined;

    if (!query) return "Error: query is required.";
    if (!numSlides || numSlides < 3 || numSlides > 20) {
      return "Error: num_slides must be an integer between 3 and 20.";
    }

    const llm = resolveLlmConfig(context);
    if (typeof llm === "string") return llm;

    const preview = query.length > 80 ? `${query.slice(0, 80)}...` : query;
    log.info(`[create-ppt] ${numSlides} slides, model=${llm.model}, query="${preview}"`);

    try {
      const userPrompt =
        `Create a ${numSlides}-slide presentation for the following request:\n\n${query}\n\n` +
        `Respond with ONLY the raw JSON object — no markdown fences, no extra text.`;

      const pptConfig = await callLlmForSlides(llm, userPrompt);
      if (!pptConfig.title) pptConfig.title = query.slice(0, 60);
      if (!pptConfig.layout) pptConfig.layout = "LAYOUT_16x9";

      const { buffer, title } = await renderPptBuffer(pptConfig);
      log.info(
        `[create-ppt] rendered (${(buffer.length / 1024).toFixed(0)}KB), slides=${pptConfig.slides.length}`,
      );
      return formatAttachmentResponse(buffer, title, pptConfig);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[create-ppt] error: ${msg}`);
      return `Error creating presentation: ${msg}`;
    }
  },
};

// ─── edit-ppt ────────────────────────────────────────────────────────────────

export const editPptTool: ToolDefinition = {
  slug: "edit-ppt",
  name: "Edit Presentation",
  description:
    "Modify an existing presentation's slide JSON and re-render. Pass the previous slide JSON " +
    "(returned by create-ppt or a prior edit-ppt call, between SLIDE_JSON_START/SLIDE_JSON_END) " +
    "plus a plain-language change request. The tool preserves unrelated slides/elements and only " +
    "changes what was requested.",
  source: "custom:create-ppt",
  configSchema: CREATE_PPT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      previous_slides_json: {
        type: "string",
        description:
          "The complete slide JSON from a previous create-ppt or edit-ppt tool result. " +
          "Copy the JSON object verbatim (from between SLIDE_JSON_START and SLIDE_JSON_END).",
      },
      change_request: {
        type: "string",
        description:
          "Plain-language description of the change: e.g. 'make slide 3 shorter', 'add a quote slide before closing', 'change theme to Ocean Gradient'.",
      },
      num_slides: {
        type: "integer",
        minimum: 3,
        maximum: 20,
        description:
          "Optional — final number of slides after edit (only needed if adding/removing slides).",
      },
    },
    required: ["previous_slides_json", "change_request"],
  },

  async execute(params, context) {
    const previousJson = (params["previous_slides_json"] as string | undefined)?.trim();
    const changeRequest = (params["change_request"] as string | undefined)?.trim();
    const numSlides = params["num_slides"] as number | undefined;

    if (!previousJson) return "Error: previous_slides_json is required.";
    if (!changeRequest) return "Error: change_request is required.";

    // Be tolerant — the agent may have quoted the JSON with surrounding markers.
    let prevObj: { title?: string; layout?: string; slides: unknown[] };
    try {
      prevObj = JSON.parse(extractJson(previousJson));
    } catch (err) {
      return `Error: previous_slides_json is not valid JSON: ${err instanceof Error ? err.message : err}`;
    }
    if (!Array.isArray(prevObj.slides) || prevObj.slides.length === 0) {
      return "Error: previous_slides_json must contain a non-empty 'slides' array.";
    }

    const llm = resolveLlmConfig(context);
    if (typeof llm === "string") return llm;

    const preview = changeRequest.length > 80 ? `${changeRequest.slice(0, 80)}...` : changeRequest;
    log.info(
      `[edit-ppt] prev=${prevObj.slides.length} slides, target=${numSlides ?? "same"}, model=${llm.model}, change="${preview}"`,
    );

    try {
      const slideCountInstruction = numSlides
        ? `The edited deck should have exactly ${numSlides} slides.`
        : `Keep the same number of slides unless the change explicitly adds or removes slides.`;

      const userPrompt =
        `You are EDITING an existing presentation, not creating a new one.\n\n` +
        `## Existing slide JSON\n` +
        `\`\`\`json\n${JSON.stringify(prevObj)}\n\`\`\`\n\n` +
        `## Change request\n${changeRequest}\n\n` +
        `## Rules\n` +
        `- Preserve slides, objects, colors, and layout EXCEPT where the change request directs otherwise.\n` +
        `- ${slideCountInstruction}\n` +
        `- Keep the same color palette and fonts unless the change request asks for a new theme.\n` +
        `- Respond with ONLY the complete, updated JSON object — no markdown fences, no explanation.`;

      const pptConfig = await callLlmForSlides(llm, userPrompt);
      if (!pptConfig.title) pptConfig.title = prevObj.title ?? "Presentation";
      if (!pptConfig.layout) pptConfig.layout = prevObj.layout ?? "LAYOUT_16x9";

      const { buffer, title } = await renderPptBuffer(pptConfig);
      log.info(
        `[edit-ppt] rendered (${(buffer.length / 1024).toFixed(0)}KB), slides=${pptConfig.slides.length}`,
      );
      return formatAttachmentResponse(buffer, title, pptConfig);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[edit-ppt] error: ${msg}`);
      return `Error editing presentation: ${msg}`;
    }
  },
};
