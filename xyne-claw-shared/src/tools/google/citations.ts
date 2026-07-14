/**
 * Citation helpers for Google Workspace tools.
 *
 * Google content is fetched live (not Vespa-indexed), so it has no native
 * `[clf-…]` tokens. We mint them here exactly like the Spaces tools do: each
 * citeable row gets an inline `[clf-__TOOL_CALL_ID__#<n>]` token in the result
 * TEXT plus a matching `Citation` (kind:"external") returned in the MCP result's
 * `_meta.citations`. The `__TOOL_CALL_ID__` placeholder is the cross-system
 * contract — xyne-claw's `injectToolCallIdIntoClawCitations` swaps it for the
 * real toolCallId at tool-return time, and the dashboard resolves the token to
 * the matching citation chip. See xyne-claw-auth/.../xyne-spaces-tools.ts for
 * the original (Spaces-side) implementation of the same pattern.
 */

import type { Citation } from "../../types/citation.js";

/** What a citation-aware Google tool returns: text (with inline tokens) + the
 *  structured citations that back those tokens. */
export interface CitedText {
  text: string;
  citations?: Citation[];
}

/** Cross-system placeholder claw replaces with the real toolCallId. Must match
 *  the value xyne-claw's injectToolCallIdIntoClawCitations() splits on. */
export const TOOL_CALL_ID_PLACEHOLDER = "__TOOL_CALL_ID__";

/** Inline citation token for the Nth (1-based) citeable row in a result. */
export function inlineCitationToken(chunkIndex: number): string {
  return `[clf-${TOOL_CALL_ID_PLACEHOLDER}#${chunkIndex}]`;
}

/** App tag — drives an app-specific icon/label in the dashboard citation UI. */
export type GoogleApp = "gmail" | "gcal" | "gdrive";

/** Build a kind:"external" citation tagged with its Google app. Returns null
 *  when there's no URL (caller should then emit no token for that row). */
export function externalCitation(opts: {
  app: GoogleApp;
  url: string | undefined;
  chunkIndex: number;
  label: string;
}): Citation | null {
  if (!opts.url) return null;
  return { kind: "external", app: opts.app, url: opts.url, chunkIndex: opts.chunkIndex, label: opts.label };
}

// ── Per-surface URL builders ────────────────────────────────────────────────
// Calendar returns event.htmlLink directly (pass it straight to externalCitation).
// Gmail/Drive don't return a web URL, so construct one from the id.

/** Gmail web deep-link. NOTE: hardcodes the `u/0` account index — for users
 *  signed into multiple Google accounts this may open the wrong profile. */
export function gmailUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

/** Drive file web URL — type-aware for Workspace docs, generic otherwise. */
export function driveFileUrl(id: string, mimeType?: string): string {
  if (mimeType === "application/vnd.google-apps.document") return `https://docs.google.com/document/d/${id}/edit`;
  if (mimeType === "application/vnd.google-apps.spreadsheet") return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (mimeType === "application/vnd.google-apps.presentation") return `https://docs.google.com/presentation/d/${id}/edit`;
  return `https://drive.google.com/file/d/${id}/view`;
}
