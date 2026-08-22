import type { FlowComponent } from "./builder.js";

/**
 * Flow JSON message helpers.
 *
 * App/bot "block" messages (e.g. Unified Alerts) are stored as an HTML envelope:
 *   <div data-flow-json="{…&quot;-escaped JSON…}">Flow JSON</div>
 * The only visible text node ("Flow JSON") is a placeholder — the real content
 * lives inside the escaped `data-flow-json` attribute as a component tree whose
 * text nodes carry their text in `props.content`.
 *
 * This is the single shared implementation used by every reader that needs the
 * human-readable body of such a message (agent message reads, notification
 * previews, mention scanning). Do NOT re-implement tree-walking inline — import
 * from here so the behaviour cannot drift.
 */

const FLOW_JSON_ATTR = /data-flow-json="([^"]+)"/;

/** True when a stored message body carries a Flow JSON payload. */
export function isFlowJsonContent(content: string): boolean {
  return typeof content === "string" && content.includes("data-flow-json");
}

/**
 * Parse the escaped `data-flow-json` attribute into its component list.
 * Returns null when there is no Flow JSON payload or the JSON is malformed.
 */
export function parseFlowJsonComponents(content: string): FlowComponent[] | null {
  if (typeof content !== "string") return null;
  const match = content.match(FLOW_JSON_ATTR);
  const escaped = match?.[1];
  if (escaped === undefined) return null;
  try {
    const json = escaped
      .replace(/&quot;/g, '"')
      .replace(/&#10;/g, "\n")
      .replace(/&#13;/g, "\r")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      // Repair stray backslashes that are NOT valid JSON escape sequences.
      // Slack mrkdwn leaves fragments like "\1" / "\6" in the content, which
      // are invalid JSON escapes; without this, JSON.parse aborts the ENTIRE
      // message and the alert falls back to the bare "Flow JSON" placeholder.
      .replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    const flow = JSON.parse(json) as { components?: unknown };
    return Array.isArray(flow.components) ? (flow.components as FlowComponent[]) : null;
  } catch {
    return null;
  }
}

/** Depth-first collect of every non-empty text `props.content`, in tree order. */
function collectContent(components: FlowComponent[], out: string[]): void {
  for (const comp of components) {
    if (!comp || typeof comp !== "object") continue;
    const content = comp.props?.["content"];
    if (typeof content === "string" && content.trim()) out.push(content.trim());
    if (Array.isArray(comp.children)) collectContent(comp.children, out);
  }
}

/**
 * Flatten a Flow JSON message body to plain text, preserving Slack-style mrkdwn
 * tokens (`<userid:…>`, `<url|label>`, …). Returns "" for non-flow content or
 * for cards whose text is not carried in text `props.content` (e.g. `plan`),
 * so callers can fall back to their default handling.
 */
export function extractTextFromFlowJson(content: string): string {
  const components = parseFlowJsonComponents(content);
  if (!components) return "";
  const out: string[] = [];
  collectContent(components, out);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Like {@link extractTextFromFlowJson} but strips Slack-style mrkdwn tokens so
 * the result is clean prose suitable for model input or a notification preview.
 */
export function extractCleanTextFromFlowJson(content: string): string {
  const raw = extractTextFromFlowJson(content);
  if (!raw) return "";
  return raw
    .replace(/<userid:[^>]+>/g, "")
    .replace(/<channelid:[^>]+>/g, "#channel")
    .replace(/<broadcast:channel>/gi, "@channel ")
    .replace(/<broadcast:here>/gi, "@here ")
    .replace(/<broadcast:([^>]+)>/gi, "@$1")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
