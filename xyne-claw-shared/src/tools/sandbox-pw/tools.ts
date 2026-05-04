/**
 * sandbox-pw__* tools — Playwright MCP wrapped to drive a chromium running
 * INSIDE the user's sandbox pod (via sandbox-router-test → CDP forwarder).
 *
 * Each tool is shaped as a custom:sandbox tool so it bundles into the
 * existing sandbox subagent's palette (see SUBAGENT_DEFINITIONS in
 * subagents/definitions.ts and the buildSubagentTools logic in
 * xyne-claw/src/subagent-tools.ts). At execute() time the tool resolves
 * the per-conversation MCP child (xyne-claw-shared/src/tools/sandbox-pw/client.ts)
 * and forwards the call.
 *
 * The tool catalog is hardcoded against @playwright/mcp's public surface.
 * Input schemas are intentionally permissive (`additionalProperties: true`)
 * — descriptions tell the LLM what to pass; mcp-server-playwright validates
 * the schema upstream and surfaces errors back through the MCP RPC. This
 * avoids a startup-time discovery spawn (which would be flaky under
 * cold-boot conditions) and keeps the catalog stable across @playwright/mcp
 * version upgrades.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ToolDefinition } from "../types.js";
import { getOrSpawnSandboxPwClient, evictSandboxPwClient } from "./client.js";

// playwright-mcp writes screenshots / page snapshots into a `.playwright-mcp/`
// directory inside its cwd (we spawn it with cwd=/tmp). The MCP response is
// markdown text that references the file by relative path, NOT an inline
// image content block. To surface the screenshot to the LLM/user, we
// detect those references in the response, read the file from claw's
// filesystem, and append it as an ATTACHMENT marker (which xyne-claw
// recognizes and propagates to the user as an attachment).
const PLAYWRIGHT_MCP_CWD = "/tmp";
const ATTACHMENT_RE = /\.playwright-mcp\/([A-Za-z0-9._-]+\.(?:png|jpg|jpeg|gif|webp|pdf))/g;
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
};

async function inlinePlaywrightAttachments(text: string): Promise<string> {
  const matches = new Set<string>();
  for (const m of text.matchAll(ATTACHMENT_RE)) {
    if (m[1]) matches.add(m[1]);
  }
  if (matches.size === 0) return text;
  // Pick the FIRST file we can read. xyne-claw's ATTACHMENT_RE
  // (xyne-claw/src/custom-tools.ts:29) is anchored with ^ and $ so the
  // marker has to be at the start of the result and there can be exactly
  // one. base64 must be one line; anything after the first newline that
  // follows the base64 is the tool's text result.
  let chosen: { file: string; base64: string; mime: string } | null = null;
  for (const file of matches) {
    try {
      const buf = await readFile(path.join(PLAYWRIGHT_MCP_CWD, ".playwright-mcp", file));
      const ext = (file.split(".").pop() ?? "png").toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
      chosen = { file, base64: buf.toString("base64"), mime };
      break;
    } catch (err) {
      console.warn(`[sandbox-pw] failed to inline attachment ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!chosen) return text;
  // Rewrite all path references in the body text so the LLM doesn't try
  // to access them inside the sandbox VM.
  let rewritten = text;
  for (const file of matches) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(
      new RegExp(`\\[([^\\]]*)\\]\\(\\.playwright-mcp/${escaped}\\)`, "g"),
      `$1 (auto-attached as ${file} — already delivered to user; do NOT cat/cp/ls this path inside the sandbox, the file lives in claw's filesystem only)`,
    );
    rewritten = rewritten.replace(
      new RegExp(`\\.playwright-mcp/${escaped}`, "g"),
      `(attached as ${file})`,
    );
  }
  // Marker FIRST, then base64 on its own line, then the (rewritten) tool
  // text. This matches xyne-claw's regex exactly so the chat UI surfaces
  // the image as an attachment instead of leaving the marker in the
  // response text.
  return `[ATTACHMENT:${chosen.file}:${chosen.mime}]\n${chosen.base64}\n${rewritten}`;
}

export const SANDBOX_PW_CONFIG_SCHEMA = {
  SANDBOX_PW_ROUTER_URL: {
    label: "Sandbox Playwright Router URL",
    default: "http://sandbox-router-test-svc:8080",
    required: false,
    placeholder: "http://sandbox-router-test-svc:8080",
  },
};

interface PwToolSpec {
  slug: string;
  name: string;
  description: string;
  upstreamName: string; // tool name in @playwright/mcp's catalog
  parameters: Record<string, { type: string; description: string }>;
  required?: string[];
}

const PW_TOOLS: PwToolSpec[] = [
  {
    slug: "sandbox-pw-navigate",
    name: "Sandbox Browser Navigate",
    upstreamName: "browser_navigate",
    description:
      "Navigate the sandbox-internal browser to a URL. Use http://localhost:5173 " +
      "to drive the dashboard or http://localhost:3001 for the backend. " +
      "Returns the page snapshot (ARIA tree) after navigation completes.",
    parameters: {
      url: { type: "string", description: "Target URL — typically http://localhost:5173 or http://localhost:3001 inside the sandbox." },
    },
    required: ["url"],
  },
  {
    slug: "sandbox-pw-snapshot",
    name: "Sandbox Browser Snapshot",
    upstreamName: "browser_snapshot",
    description:
      "Return the current page's accessibility tree (ARIA snapshot). Use this to " +
      "find element refs/selectors before clicking or typing. Cheaper than a " +
      "screenshot; preferred for navigation.",
    parameters: {},
  },
  {
    slug: "sandbox-pw-click",
    name: "Sandbox Browser Click",
    upstreamName: "browser_click",
    description:
      "Click an element on the current page. The 'ref' is from the latest " +
      "browser_snapshot output. 'element' is a human-readable description.",
    parameters: {
      element: { type: "string", description: "Human-readable description of the element being clicked (e.g. 'Login button')." },
      ref: { type: "string", description: "Element ref from the latest browser_snapshot output." },
    },
    required: ["element", "ref"],
  },
  {
    slug: "sandbox-pw-type",
    name: "Sandbox Browser Type",
    upstreamName: "browser_type",
    description:
      "Type text into an input element. ref is from browser_snapshot. " +
      "Set submit=true to press Enter after typing.",
    parameters: {
      element: { type: "string", description: "Human-readable description of the input." },
      ref: { type: "string", description: "Element ref from browser_snapshot." },
      text: { type: "string", description: "Text to type." },
      submit: { type: "boolean", description: "Press Enter after typing. Default false." },
    },
    required: ["element", "ref", "text"],
  },
  {
    slug: "sandbox-pw-press-key",
    name: "Sandbox Browser Press Key",
    upstreamName: "browser_press_key",
    description:
      "Press a single key (e.g. 'Enter', 'Escape', 'ArrowDown'). Useful for " +
      "form navigation and modal dismissal.",
    parameters: {
      key: { type: "string", description: "Key name to press, e.g. 'Enter' or 'Tab'." },
    },
    required: ["key"],
  },
  {
    slug: "sandbox-pw-screenshot",
    name: "Sandbox Browser Screenshot",
    upstreamName: "browser_take_screenshot",
    description:
      "Capture a PNG screenshot of the current page. Use this only when the " +
      "ARIA snapshot doesn't carry enough info (e.g. visual layout / CSS bugs / " +
      "rendering glitches).",
    parameters: {
      fullPage: { type: "boolean", description: "Whole-page screenshot (default false = viewport only)." },
    },
  },
  {
    slug: "sandbox-pw-evaluate",
    name: "Sandbox Browser Evaluate",
    upstreamName: "browser_evaluate",
    description:
      "Run a JS expression in the page context. Returns the JSON-serialized " +
      "result. Useful for reading window state / triggering UI flows that " +
      "the ARIA tree doesn't expose.",
    parameters: {
      function: { type: "string", description: "JavaScript function as a string, e.g. '() => window.location.href'." },
    },
    required: ["function"],
  },
  {
    slug: "sandbox-pw-wait-for",
    name: "Sandbox Browser Wait For",
    upstreamName: "browser_wait_for",
    description:
      "Wait for text to appear / disappear or for a fixed time. Use BEFORE " +
      "snapshot/screenshot if the page is still loading.",
    parameters: {
      text: { type: "string", description: "Text to wait for (use textGone for disappearance)." },
      textGone: { type: "string", description: "Text whose disappearance to wait for." },
      time: { type: "number", description: "Seconds to wait unconditionally." },
    },
  },
  {
    slug: "sandbox-pw-console-messages",
    name: "Sandbox Browser Console Messages",
    upstreamName: "browser_console_messages",
    description:
      "Return all console messages logged in the page since navigation. " +
      "Useful for debugging frontend errors.",
    parameters: {},
  },
  {
    slug: "sandbox-pw-network-requests",
    name: "Sandbox Browser Network Requests",
    upstreamName: "browser_network_requests",
    description:
      "Return all network requests made by the page since navigation, with " +
      "URLs, status codes, and resource types.",
    parameters: {},
  },
  {
    slug: "sandbox-pw-close",
    name: "Sandbox Browser Close",
    upstreamName: "browser_close",
    description:
      "Close the current page. Subsequent navigations open a fresh page.",
    parameters: {},
  },
];

const STALE_PATTERNS = [
  /could not connect to the backend sandbox/i,
  /sandbox(?:claim)?.*not found/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /HTTP request failed/i,
  /Target page, context or browser has been closed/i,
];

function makeSandboxPwTool(spec: PwToolSpec): ToolDefinition {
  return {
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    source: "custom:sandbox",
    configSchema: SANDBOX_PW_CONFIG_SCHEMA,
    inputSchema: {
      type: "object",
      properties: spec.parameters,
      required: spec.required ?? [],
    },

    async execute(params, context) {
      if (!context) return "Error: No execution context available.";
      const conversationId = context.meta?.["conversationId"];
      if (!conversationId) return "Error: No conversationId in context.";
      const agentSlug = context.meta?.["agentSlug"] ?? "";
      const storeKey = agentSlug ? `${conversationId}_${agentSlug}` : conversationId;

      // URL validation for navigate. Common upstream bug: chat UI renders a
      // markdown link as visible text "Open link" / similar, parent agent
      // extracts the visible text and passes it as the URL. Catch malformed
      // URLs here so the LLM gets a clear hint instead of an
      // "ERR_NAME_NOT_RESOLVED" / DNS error 30s later from chromium.
      if (spec.upstreamName === "browser_navigate") {
        const raw = (params as Record<string, unknown>)?.["url"];
        if (typeof raw !== "string" || raw.trim() === "") {
          return "Error: missing or empty `url` parameter for sandbox-pw-navigate.";
        }
        const url = raw.trim();
        // Reject URLs that look like UI placeholders ("Open link", "click here", etc.)
        // or are missing a scheme, or have whitespace inside the URL itself.
        try {
          const parsed = new URL(url);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return `Error: unsupported URL scheme '${parsed.protocol}'. Use http:// or https://. Got: ${url}`;
          }
          // /\s/ catches the "Open link" / "Open%20link"-after-scheme cases.
          if (/\s/.test(parsed.hostname) || parsed.hostname.includes("%20")) {
            return `Error: malformed hostname '${parsed.hostname}' in URL '${url}'. Looks like a UI placeholder ("Open link" etc.) was passed instead of an actual URL. Ask the user for the literal URL (e.g. http://localhost:5173).`;
          }
          // Catch the specific "https://https//..." double-scheme cookie.
          if (/^https?:\/\/https?[:/]/i.test(url)) {
            return `Error: URL has duplicated scheme: '${url}'. Pass a single http://... or https://... URL.`;
          }
        } catch {
          return `Error: '${url}' is not a valid URL. Pass a literal URL like http://localhost:5173, not visible link text.`;
        }
      }

      const routerUrl =
        context.config["SANDBOX_PW_ROUTER_URL"] ??
        SANDBOX_PW_CONFIG_SCHEMA.SANDBOX_PW_ROUTER_URL.default;

      const got = await getOrSpawnSandboxPwClient(storeKey, routerUrl);
      if (!got.ok) return `Error: ${got.error}`;

      try {
        const result = await got.client.callTool({
          name: spec.upstreamName,
          arguments: (params ?? {}) as Record<string, unknown>,
        });
        const content = (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

        // Translate MCP content blocks back into our string-result contract.
        // - text blocks: concatenated.
        // - image blocks: emit ATTACHMENT marker (xyne-claw recognizes it
        //   as a base64 attachment and surfaces it as an image to the LLM).
        const parts: string[] = [];
        for (const c of content) {
          if (c.type === "text" && typeof c.text === "string") {
            parts.push(c.text);
          } else if ((c.type === "image" || c.type === "resource") && typeof c.data === "string") {
            const ext = (c.mimeType ?? "image/png").split("/").pop() ?? "png";
            parts.push(`[ATTACHMENT:browser-${spec.upstreamName}.${ext}:${c.mimeType ?? "image/png"}]\n${c.data}`);
          }
        }
        const text = parts.join("\n") || "(no result)";
        // playwright-mcp doesn't return image content blocks for screenshot
        // tools — it writes the file to .playwright-mcp/ in its cwd and
        // references it from a markdown link in the text response. We read
        // those files from claw's filesystem (cwd=/tmp from client.ts) and
        // inline them as ATTACHMENT so the user sees the actual image.
        return await inlinePlaywrightAttachments(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (STALE_PATTERNS.some((re) => re.test(msg))) {
          evictSandboxPwClient(storeKey);
          return `Error: sandbox-pw client died (${msg}). Re-run sandbox-repo-setup if the sandbox was replaced; otherwise retry this tool to respawn the MCP child.`;
        }
        return `Error: ${msg}`;
      }
    },
  };
}

export const SANDBOX_PW_TOOLS: ToolDefinition[] = PW_TOOLS.map(makeSandboxPwTool);
