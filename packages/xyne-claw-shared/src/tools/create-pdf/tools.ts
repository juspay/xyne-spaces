/**
 * PDF tools — LLM-driven document generation + Puppeteer/Playwright PDF rendering.
 *
 * - create-pdf: takes a brief + page count, produces a fresh PDF document.
 * - edit-pdf:   takes previous document JSON + a change request, rewrites only
 *               the parts that need to change.
 *
 * Both return the rendered file as an attachment marker followed by the document
 * JSON so the main agent has the source-of-truth JSON available for
 * subsequent edits.
 */

import https from "node:https";
import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { PDF_DESIGNER_SYSTEM_PROMPT } from "./prompt.js";

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

// ─── Utilities ───────────────────────────────────────────────────────────────

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

const DEFAULT_PDF_MODEL = "kimi-latest";
const PDF_MIME = "application/pdf";

/** Delimiters used to expose the document JSON back to the agent. */
const JSON_START = "DOCUMENT_JSON_START";
const JSON_END = "DOCUMENT_JSON_END";

export const CREATE_PDF_CONFIG_SCHEMA = {
  PDF_PROVIDER: {
    label: "PDF Provider",
    default: "",
    required: false as const,
    placeholder: "codex | copilot | claude | spaces",
  },
  PDF_BASE_URL: {
    label: "PDF Provider Base URL",
    default: "",
    required: false as const,
    placeholder: "https://api.openai.com/v1 or https://api.anthropic.com",
  },
  PDF_API_KEY: {
    label: "PDF Provider API Key",
    default: "",
    required: false as const,
    placeholder: "sk-...",
  },
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
  PDF_MODEL: {
    label: "Model for document JSON generation",
    default: "",
    required: false as const,
    placeholder: DEFAULT_PDF_MODEL,
  },
  PDF_AUTH_TYPE: {
    label: "PDF Auth Type",
    default: "api_key",
    required: false as const,
    placeholder: "api_key (oauth_token deprecated — Claude OAuth removed)",
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
  const provider = String(config["PDF_PROVIDER"] ?? "").trim().toLowerCase();
  const explicitBase = String(config["PDF_BASE_URL"] ?? "").trim();
  const explicitApiKey = String(config["PDF_API_KEY"] ?? "").trim();
  const explicitModel = String(config["PDF_MODEL"] ?? "").trim();
  const explicitAuthType = String(config["PDF_AUTH_TYPE"] ?? "api_key").trim().toLowerCase() === "oauth_token"
    ? "oauth_token"
    : "api_key";

  // New path: provider-aware runtime config injected by xyne-claw/run.ts.
  if (provider && explicitApiKey && explicitModel) {
    if (provider === "claude") {
      let base = (explicitBase || "https://api.anthropic.com").replace(/\/+$/, "");
      if (!/\/v1\/messages$/.test(base)) {
        if (/\/v1$/.test(base)) base = `${base}/messages`;
        else base = `${base}/v1/messages`;
      }
      return {
        endpoint: base,
        apiKey: explicitApiKey,
        model: explicitModel,
        api: "anthropic-messages",
        authType: explicitAuthType,
      };
    }

    let base = (explicitBase || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
    return {
      endpoint: `${base}/chat/completions`,
      apiKey: explicitApiKey,
      model: explicitModel,
      api: "openai-completions",
      authType: explicitAuthType,
    };
  }

  // Legacy path: shared LiteLLM env/config.
  const baseUrlRaw =
    config["LITELLM_URL"] ||
    config["LITELLM_BASE_URL"] ||
    process.env["LITELLM_URL"] ||
    process.env["LITELLM_BASE_URL"] ||
    "";
  const apiKey = config["LITELLM_API_KEY"] || process.env["LITELLM_API_KEY"] || "";
  const model =
    config["PDF_MODEL"] ||
    process.env["PDF_MODEL"] ||
    process.env["LITELLM_MODEL"] ||
    DEFAULT_PDF_MODEL;

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

async function callLlmForDocument(
  llm: LlmConfig,
  userPrompt: string,
): Promise<{ title?: string; style?: string; pages: unknown[] }> {
  if (llm.api === "anthropic-messages") {
    // x-api-key only: Claude creds are Anthropic API keys — the OAuth Bearer
    // path (subscription tokens) was removed.
    const authHeader = { "x-api-key": llm.apiKey };
    const res = await httpsPost(
      llm.endpoint,
      JSON.stringify({
        model: llm.model,
        system: PDF_DESIGNER_SYSTEM_PROMPT,
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

    let parsed: { title?: string; style?: string; pages: unknown[] };
    try {
      parsed = JSON.parse(extractJson(rawContent));
    } catch (err) {
      log.error(`[pdf] JSON parse failed. Raw (first 600): ${rawContent.slice(0, 600)}`);
      throw new Error(
        `LLM returned invalid JSON: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      throw new Error("LLM returned no pages");
    }
    return parsed;
  }

  const res = await httpsPost(
    llm.endpoint,
    JSON.stringify({
      model: llm.model,
      messages: [
        { role: "system", content: PDF_DESIGNER_SYSTEM_PROMPT },
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

  let parsed: { title?: string; style?: string; pages: unknown[] };
  try {
    parsed = JSON.parse(extractJson(rawContent));
  } catch (err) {
    log.error(`[pdf] JSON parse failed. Raw (first 600): ${rawContent.slice(0, 600)}`);
    throw new Error(
      `LLM returned invalid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error("LLM returned no pages");
  }
  return parsed;
}

async function renderPdfBuffer(docConfig: {
  title?: string;
  style?: string;
  pages: unknown[];
}): Promise<{ buffer: Buffer; title: string; pageCount: number }> {
  const title = docConfig.title ?? "Document";
  const pages = docConfig.pages;
  
  // Generate HTML from the document structure
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 2cm; }
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .page { page-break-after: always; padding: 2cm; }
    .page:last-child { page-break-after: auto; }
    h1 { font-size: 24pt; color: #1a1a1a; border-bottom: 2px solid #ddd; padding-bottom: 0.3cm; }
    h2 { font-size: 18pt; color: #333; margin-top: 1cm; }
    h3 { font-size: 14pt; color: #555; }
    p { font-size: 11pt; margin: 0.5cm 0; }
    ul, ol { margin: 0.5cm 0; padding-left: 1cm; }
    li { font-size: 11pt; margin: 0.2cm 0; }
    table { width: 100%; border-collapse: collapse; margin: 0.5cm 0; }
    th, td { border: 1px solid #ddd; padding: 0.3cm; font-size: 10pt; }
    th { background: #f5f5f5; font-weight: bold; }
    .header { text-align: center; margin-bottom: 1cm; }
    .footer { text-align: center; font-size: 9pt; color: #666; margin-top: 1cm; border-top: 1px solid #ddd; padding-top: 0.5cm; }
  </style>
</head>
<body>
`;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as Record<string, unknown>;
    html += `<div class="page">\n`;
    
    // Page header (except first page if it has a title)
    if (i > 0 || !page.title) {
      html += `<div class="header" style="font-size: 10pt; color: #666;">${title} — Page ${i + 1}</div>\n`;
    }
    
    // Page title
    if (page.title) {
      html += `<h1>${String(page.title)}</h1>\n`;
    }
    
    // Page content (sections)
    const sections = (page.sections ?? page.content ?? []) as unknown[];
    for (const section of sections) {
      if (typeof section === "string") {
        html += `<p>${section}</p>\n`;
      } else if (section && typeof section === "object") {
        const sec = section as Record<string, unknown>;
        const type = String(sec.type ?? "paragraph").toLowerCase();
        
        switch (type) {
          case "heading":
          case "h1":
            html += `<h1>${String(sec.text ?? sec.content ?? "")}</h1>\n`;
            break;
          case "h2":
          case "subheading":
            html += `<h2>${String(sec.text ?? sec.content ?? "")}</h2>\n`;
            break;
          case "h3":
            html += `<h3>${String(sec.text ?? sec.content ?? "")}</h3>\n`;
            break;
          case "paragraph":
          case "text":
            html += `<p>${String(sec.text ?? sec.content ?? "")}</p>\n`;
            break;
          case "list":
          case "ul": {
            const items = (sec.items ?? sec.content ?? []) as string[];
            html += `<ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>\n`;
            break;
          }
          case "ol":
          case "numbered_list": {
            const items = (sec.items ?? sec.content ?? []) as string[];
            html += `<ol>${items.map(item => `<li>${item}</li>`).join("")}</ol>\n`;
            break;
          }
          case "table": {
            const rows = (sec.rows ?? sec.data ?? []) as Array<Record<string, unknown>>;
            html += `<table>\n`;
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r];
              if (!row) continue;
              const cells = (row.cells ?? row.columns ?? row) as string[];
              html += `<tr>${cells.map((cell) =>
                r === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`
              ).join("")}</tr>\n`;
            }
            html += `</table>\n`;
            break;
          }
          default:
            html += `<p>${String(sec.text ?? sec.content ?? JSON.stringify(sec))}</p>\n`;
        }
      }
    }
    
    html += `</div>\n`;
  }

  html += `</body></html>`;

  // Convert HTML to PDF using Playwright
  const buffer = await convertHtmlToPdf(html);
  
  return { buffer, title, pageCount: pages.length };
}

async function convertHtmlToPdf(html: string): Promise<Buffer> {
  // playwright is an optional runtime-only dep — present in the deployed
  // image's node_modules, not declared in xyne-claw-shared's package.json.
  // We cast through `any` so TS doesn't fail to resolve the module type at
  // compile time. Runtime resolution works in any image that has playwright
  // installed (xyne-claw-auth's container does).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playwright = (await import("playwright" as unknown as string)) as any;
    const { chromium } = playwright;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set content and wait for it to render
    await page.setContent(html, { waitUntil: "networkidle" });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "2cm", right: "2cm", bottom: "2cm", left: "2cm" },
      printBackground: true,
    });
    
    return Buffer.from(pdfBuffer);
  } catch (err) {
    log.error("[pdf] Playwright PDF conversion failed:", err instanceof Error ? err.message : err);
    throw new Error(`PDF conversion failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function formatAttachmentResponse(
  buffer: Buffer,
  title: string,
  docConfig: { title?: string; style?: string; pages: unknown[] },
): string {
  const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "document";
  const fileName = `${safeTitle}.pdf`;
  // Document JSON is returned to the agent so it can pass it to edit-pdf on the
  // next turn. xyne-claw/src/custom-tools.ts strips the attachment marker and
  // keeps the remaining body as the tool result.
  const docJson = JSON.stringify(docConfig);
  return (
    `[ATTACHMENT:${fileName}:${PDF_MIME}]\n` +
    `${buffer.toString("base64")}\n\n` +
    `Rendered ${fileName} (${docConfig.pages.length} pages). ` +
    `Document JSON is below — pass it to edit-pdf if the user requests changes.\n\n` +
    `${JSON_START}\n${docJson}\n${JSON_END}`
  );
}

// ─── create-pdf ──────────────────────────────────────────────────────────────

export const createPdfTool: ToolDefinition = {
  slug: "create-pdf",
  name: "Create PDF Document",
  description:
    "Generate a PDF document from a content brief. The tool calls an LLM to design document JSON, " +
    "renders it as a styled PDF, and returns both the file attachment and the underlying document JSON. " +
    "Pass the JSON back to edit-pdf if the user wants changes. " +
    "Provide a rich brief (title, purpose, sections, content details, formatting preferences) and the target page count (1–50).",
  source: "custom:create-ppt",
  configSchema: CREATE_PDF_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Rich document brief: title, document type (report/memo/whitepaper), purpose, target audience, " +
          "section outlines with content, formatting preferences (formal/modern/minimalist), and any tables or special elements.",
      },
      pages: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Target number of pages (typically 2–10; default 5).",
      },
    },
    required: ["query", "pages"],
  },

  async execute(params, context) {
    const query = (params["query"] as string | undefined)?.trim();
    const numPages = params["pages"] as number | undefined;

    if (!query) return "Error: query is required.";
    if (!numPages || numPages < 1 || numPages > 50) {
      return "Error: pages must be an integer between 1 and 50.";
    }

    const llm = resolveLlmConfig(context);
    if (typeof llm === "string") return llm;

    const preview = query.length > 80 ? `${query.slice(0, 80)}...` : query;
    log.info(`[create-pdf] ${numPages} pages, model=${llm.model}, query="${preview}"`);

    try {
      const userPrompt =
        `Create a ${numPages}-page PDF document for the following request:\n\n${query}\n\n` +
        `Respond with ONLY the raw JSON object — no markdown fences, no extra text.`;

      const docConfig = await callLlmForDocument(llm, userPrompt);
      if (!docConfig.title) docConfig.title = query.slice(0, 60);
      if (!docConfig.style) docConfig.style = "professional";

      const { buffer, title } = await renderPdfBuffer(docConfig);
      log.info(
        `[create-pdf] rendered (${(buffer.length / 1024).toFixed(0)}KB), pages=${docConfig.pages.length}`,
      );
      return formatAttachmentResponse(buffer, title, docConfig);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[create-pdf] error: ${msg}`);
      return `Error creating PDF: ${msg}`;
    }
  },
};

// ─── edit-pdf ────────────────────────────────────────────────────────────────

export const editPdfTool: ToolDefinition = {
  slug: "edit-pdf",
  name: "Edit PDF Document",
  description:
    "Modify an existing PDF document's JSON and re-render. Pass the previous document JSON " +
    "(returned by create-pdf or a prior edit-pdf call, between DOCUMENT_JSON_START/DOCUMENT_JSON_END) " +
    "plus a plain-language change request. The tool preserves unrelated pages/sections and only " +
    "changes what was requested.",
  source: "custom:create-ppt",
  configSchema: CREATE_PDF_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      previous_document_json: {
        type: "string",
        description:
          "The complete document JSON from a previous create-pdf or edit-pdf tool result. " +
          "Copy the JSON object verbatim (from between DOCUMENT_JSON_START and DOCUMENT_JSON_END).",
      },
      change_request: {
        type: "string",
        description:
          "Plain-language description of the change: e.g. 'add an executive summary page', 'make section 2 shorter', 'change font to serif', 'add a table of contents'.",
      },
      pages: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description:
          "Optional — final number of pages after edit (only needed if adding/removing pages).",
      },
    },
    required: ["previous_document_json", "change_request"],
  },

  async execute(params, context) {
    const previousJson = (params["previous_document_json"] as string | undefined)?.trim();
    const changeRequest = (params["change_request"] as string | undefined)?.trim();
    const numPages = params["pages"] as number | undefined;

    if (!previousJson) return "Error: previous_document_json is required.";
    if (!changeRequest) return "Error: change_request is required.";

    // Be tolerant — the agent may have quoted the JSON with surrounding markers.
    let prevObj: { title?: string; style?: string; pages: unknown[] };
    try {
      prevObj = JSON.parse(extractJson(previousJson));
    } catch (err) {
      return `Error: previous_document_json is not valid JSON: ${err instanceof Error ? err.message : err}`;
    }
    if (!Array.isArray(prevObj.pages) || prevObj.pages.length === 0) {
      return "Error: previous_document_json must contain a non-empty 'pages' array.";
    }

    const llm = resolveLlmConfig(context);
    if (typeof llm === "string") return llm;

    const preview = changeRequest.length > 80 ? `${changeRequest.slice(0, 80)}...` : changeRequest;
    log.info(
      `[edit-pdf] prev=${prevObj.pages.length} pages, target=${numPages ?? "same"}, model=${llm.model}, change="${preview}"`,
    );

    try {
      const pageCountInstruction = numPages
        ? `The edited document should have exactly ${numPages} pages.`
        : `Keep the same number of pages unless the change explicitly adds or removes pages.`;

      const userPrompt =
        `You are EDITING an existing PDF document, not creating a new one.\n\n` +
        `## Existing document JSON\n` +
        `\`\`\`json\n${JSON.stringify(prevObj)}\n\`\`\`\n\n` +
        `## Change request\n${changeRequest}\n\n` +
        `## Rules\n` +
        `- Preserve pages, sections, content, and styling EXCEPT where the change request directs otherwise.\n` +
        `- ${pageCountInstruction}\n` +
        `- Keep the same document style and tone unless the change request asks for a different approach.\n` +
        `- Respond with ONLY the complete, updated JSON object — no markdown fences, no explanation.`;

      const docConfig = await callLlmForDocument(llm, userPrompt);
      if (!docConfig.title) docConfig.title = prevObj.title ?? "Document";
      if (!docConfig.style) docConfig.style = prevObj.style ?? "professional";

      const { buffer, title } = await renderPdfBuffer(docConfig);
      log.info(
        `[edit-pdf] rendered (${(buffer.length / 1024).toFixed(0)}KB), pages=${docConfig.pages.length}`,
      );
      return formatAttachmentResponse(buffer, title, docConfig);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      log.error(`[edit-pdf] error: ${msg}`);
      return `Error editing PDF: ${msg}`;
    }
  },
};