import { createHash } from "node:crypto";
import type { IncomingError } from "./types.js";

/**
 * Stable identity for an error across time — used for queue dedup and the
 * agent's "is there already a PR for this?" search. The SAME error must always
 * produce the SAME key, so we hash a normalized form (variable ids stripped),
 * scoped by source so an identical string from backend vs client stays distinct.
 *
 * Prefer Grafana's normMessage (it already deduped on it); otherwise normalize
 * the raw message ourselves.
 */
function normalize(msg: string): string {
  let m = msg.replace(/\s+/g, " ").trim();
  m = m.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
  m = m.replace(/https?:\/\/\S+/g, "<url>");
  m = m.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>");
  m = m.replace(/\b[a-z0-9]{20,}\b/gi, "<id>"); // cuid/opaque ids
  m = m.replace(/\b\d+\b/g, "<n>");
  m = m.replace(/'[^']*'/g, "'<x>'").replace(/"[^"]*"/g, '"<x>"');
  return m.toLowerCase().slice(0, 500);
}

export function errorKeyFor(e: IncomingError): string {
  const basis = e.normMessage && e.normMessage.length > 0 ? e.normMessage : normalize(e.message);
  const h = createHash("sha1").update(`${e.source}\n${basis}`).digest("hex").slice(0, 16);
  return `${e.source}:${h}`;
}
