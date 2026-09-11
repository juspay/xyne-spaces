/**
 * Structured citation metadata produced by tools and propagated through
 * subagents to the parent agent. Consumers (claw-auth's appendCitations)
 * use these to render a `### Citations` block without grepping prose for IDs.
 */
export interface Citation {
  /** Optional human-friendly label, e.g., "Spaces thread", "Ticket FOO-123". */
  label?: string;
  /** What kind of resource this citation points to. */
  kind: "thread" | "canvas" | "ticket" | "external" | "collection-item" | "recording";
  /** For kind="thread": channel + conversation IDs. */
  channelId?: string;
  conversationId?: string;
  /**
   * For kind="thread": specific message inside the conversation. When set,
   * the frontend deep-links to this message via the `&messageId=<id>` hash
   * fragment (matches the pattern used by `navigateToMessage` in
   * searchNavigation.ts) so users land on the Nth reply instead of the
   * thread start.
   */
  messageId?: string;
  /** Display name of the channel (e.g. "testing-claw"). Optional but
   *  recommended — citation labels render much better with it. */
  channelName?: string;
  /** Channel scope type: DEFAULT | DM | GROUP_DM | TICKET | DOCUMENT. */
  channelType?: string;
  /**
   * Underlying `channel.type` (EMAIL | SLACK | DEFAULT | SUPPORT). Used to
   * detect desk-typed tickets so the frontend can route them to the Support
   * view (`/support/<channelId>/<xyneId>`) instead of the chat view —
   * mirrors the `isDeskChannelType(channel.type)` check in
   * `navigateToTicket` in searchNavigation.ts. Distinct from `channelType`
   * above which carries the scope type.
   */
  channelKind?: string;
  /** For kind="canvas": shareable view ID. */
  viewAccessId?: string;
  /** For kind="ticket": display ID like "FOO-123". */
  ticketId?: string;
  /**
   * Human-readable ticket key (e.g. "XYNE-123"). For desk-typed tickets
   * (EMAIL/SLACK channels) the Support view route uses this as the path
   * segment: `/support/<channelId>/<xyneId>`. Typically equals `ticketId`
   * for ticket-kind citations; kept separate so callers can carry it on
   * thread-kind citations too without overloading `ticketId`.
   */
  xyneId?: string;
  /**
   * Specific mail/email id inside a desk ticket's conversation. When set,
   * the Support URL appends `?mail=<mailId>` so the SupportScreen scrolls
   * to that EmailThreadItem — matches `navigateToMail` in
   * searchNavigation.ts.
   */
  mailId?: string;
  /** For kind="external": absolute URL. */
  url?: string;
  /** For kind="external": optional source app. Used by `citationIconUrl()` to
   *  pick the brand icon (Gmail / Google Calendar / Google Drive). Omit for a
   *  generic web link. */
  app?: "gmail" | "gcal" | "gdrive";
  /**
   * Lightweight, stable icon KEY for the citation chip (e.g. "gmail", "spaces"),
   * stamped by claw (see `citationIconKey`). This is the field that gets
   * PERSISTED — a few bytes — so the heavy `data:` SVG never lands in the DB.
   * claw-auth re-attaches the actual URI onto `iconUrl` only at the send
   * boundary (backend `hydrateCitationIcons`). Adding a new source's icon is a
   * one-file change in `CITATION_ICONS` below (+ a `citationIconKey` mapping for
   * new external apps).
   */
  iconKey?: string;
  /**
   * Resolved brand-icon for the chip — an inline `data:image/svg+xml,…` URI
   * derived from `iconKey`. NOT persisted: it's hydrated onto the citation only
   * on the way out to the dashboard, which renders `<img src={iconUrl}>`. Legacy
   * rows may carry a root-relative path here instead; both render the same.
   */
  iconUrl?: string;
  /**
   * For kind="recording": the call's `externalId` — the id the `/recordings/:id`
   * route accepts. A note-taker recording has no channel and no thread, so it
   * cannot be cited as a thread; this is the only link target it has.
   */
  recordingId?: string;
  /** For kind="collection-item": spaces CollectionItem.id (the file row). */
  collectionItemId?: string;
  /** For kind="collection-item": spaces Collection.id of the root collection
   *  the item lives under — used to build the deep-link back to the KB UI. */
  collectionId?: string;
  /** For kind="collection-item": original file name (display). */
  fileName?: string;
  /**
   * 1-based chunk index this citation refers to. Set by the tool handler when
   * a multi-row result emits one inline `[clf-…#N]` token per row — the
   * frontend's `findCitationForChunk(invocations, toolCallId, chunkIndex)`
   * resolves the chip by exact match here, so chip #N links to row #N's
   * thread (instead of every chip falling back to citations[0]).
   */
  chunkIndex?: number;
  /**
   * For kind="collection-item": 1-based PDF page the cited chunk starts on
   * (first entry of the chunk's `page_numbers`). When set, the deep-link `url`
   * carries `?page=<pageNumber>` so the file viewer opens scrolled to that page
   * instead of page 1. Omitted when the chunk has no page metadata (e.g.
   * non-paginated formats).
   */
  pageNumber?: number;
}

/**
 * Build a self-contained `data:` URI from inline SVG markup. We percent-encode
 * (not base64) so the SVG stays readable in source and the encoded form stays
 * compact; both `<img src>` and the dashboard CSP (`img-src … data:`) accept it.
 */
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

// Inline brand-icon SVGs, kept minified on one line — edit the markup directly
// to tweak an icon. The Google marks are the standard brand glyphs; the Spaces
// mark is the Xyne emblem (red disc + white glyph, opaque so it renders on any
// chip background). All are tiny (≤ ~3 KB) so inlining them per-citation is cheap.
const GMAIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/><path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/><polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/><path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8C4.924,8,3,9.924,3,12.298z"/><path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8C43.076,8,45,9.924,45,12.298z"/></svg>`;
const GCAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="22" height="22" x="13" y="13" fill="#fff"/><polygon fill="#4285f4" points="25.68,20.92 26.688,22.36 28.272,21.208 28.272,29.56 30,29.56 30,18.616 28.56,18.616"/><path fill="#4285f4" d="M22.943,23.745c0.625-0.574,1.013-1.37,1.013-2.249c0-1.747-1.533-3.168-3.417-3.168c-1.602,0-2.972,1.009-3.33,2.453l1.657,0.421c0.165-0.664,0.868-1.146,1.673-1.146c0.942,0,1.709,0.646,1.709,1.44c0,0.794-0.767,1.44-1.709,1.44h-0.997v1.728h0.997c1.081,0,1.993,0.751,1.993,1.64c0,0.905-0.918,1.677-2.007,1.677c-0.978,0-1.828-0.668-2.02-1.587l-1.67,0.394c0.362,1.572,1.795,2.689,3.689,2.689c2.094,0,3.736-1.529,3.736-3.481C24.589,25.295,23.964,24.319,22.943,23.745z"/><polygon fill="#34a853" points="34,42 14,42 13,38 14,34 34,34 35,38"/><polygon fill="#fbbc04" points="38,35 42,34 42,14 38,13 34,14 34,34"/><path fill="#4285f4" d="M34,14l1-4l-1-4H9C7.343,6,6,7.343,6,9v25l4,1l4-1V14H34z"/><polygon fill="#ea4335" points="34,34 34,42 42,34"/><path fill="#1967d2" d="M34,6v8h8C42,7.343,40.657,6,39,6H34z"/><path fill="#188038" d="M14,42H9c-1.657,0-3-1.343-3-3v-5h8V42z"/></svg>`;
const GDRIVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" height="512" viewBox="0 0 511.999 511.999" width="512"><g><path d="m38.563 418.862 22.51 39.042c4.677 8.219 11.41 14.682 19.319 19.388l80.744-57.248.147-82.19-80.577-36.303-80.706 36.014c-.016 9.09 2.313 18.185 6.991 26.404z" fill="#06d"/><path d="m256.293 173.808 4.212-107.064-84.604-32.663c-7.926 4.678-14.682 11.117-19.389 19.319l-149.427 257.786c-4.706 8.203-7.069 17.289-7.085 26.379l161.283.288z" fill="#00ad3c"/><path d="m256.293 173.808 77.503-41.694 3.387-97.745c-7.909-4.706-16.996-7.068-26.379-7.085l-108.499-.194c-9.384-.017-18.479 2.606-26.405 6.991z" fill="#00831e"/><path d="m350.716 338.192-189.434-.338-80.89 139.438c7.909 4.706 16.996 7.068 26.379 7.085l297.933.532c9.384.017 18.479-2.606 26.405-6.991l.314-93.66z" fill="#0084ff"/><path d="m431.109 477.919c7.926-4.678 14.682-11.117 19.388-19.319l9.413-16.111 45.005-77.629c4.706-8.202 7.069-17.288 7.085-26.379l-93.221-49.051-67.768 48.764z" fill="#ff4131"/><path d="m430.756 182.917-74.253-129.16c-4.677-8.22-11.41-14.683-19.32-19.389l-80.891 139.439 94.423 164.385 160.99.288c.016-9.09-2.314-18.185-6.991-26.405z" fill="#ffba00"/></g></svg>`;
const SPACES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10Z" fill="#FF4F4F"/><path d="M12.2502 13.5114C12.3184 13.8663 12.4072 14.112 12.5164 14.2485C12.6256 14.385 12.7689 14.4533 12.9463 14.4533C13.1238 14.4533 13.3013 14.3509 13.4787 14.1461C13.6698 13.9277 13.8814 13.4704 14.1134 12.7743L14.3796 12.0167H14.7687L14.2568 13.5114C14.0657 14.112 13.7995 14.5625 13.4582 14.8628C13.117 15.1631 12.7484 15.361 12.3526 15.4566C11.9567 15.5521 11.5813 15.5999 11.2264 15.5999C10.5166 15.5999 9.916 15.4566 9.42459 15.1699C8.94684 14.8696 8.66701 14.3168 8.58511 13.5114L7.76609 6.48837C7.71149 6.13346 7.61594 5.91506 7.47944 5.83315C7.35659 5.7376 7.20644 5.68983 7.02898 5.68983C6.91978 5.68983 6.80376 5.72395 6.6809 5.7922C6.5717 5.84681 6.45567 5.98331 6.33282 6.20171C6.20997 6.42011 6.06664 6.76137 5.90284 7.22548L5.63666 7.98306H5.24763L5.75951 6.48837C5.95062 5.88776 6.2168 5.4373 6.55805 5.13699C6.89931 4.83669 7.27469 4.63876 7.68419 4.54321C8.10735 4.44766 8.51003 4.39988 8.89224 4.39988C9.643 4.39988 10.2368 4.55686 10.6736 4.87081C11.124 5.18477 11.397 5.81951 11.4926 6.77502L12.2502 13.5114ZM12.7621 5.97648C12.4754 6.35869 12.2229 6.78184 12.0045 7.24595C11.7861 7.71006 11.595 8.17417 11.4312 8.63827C11.281 9.10238 11.1513 9.52554 11.0421 9.90774C11.0421 9.90774 10.9739 9.90774 10.8374 9.90774C10.7009 9.89409 10.6326 9.88727 10.6326 9.88727C10.6599 9.77807 10.7145 9.57331 10.7964 9.27301C10.892 8.95905 11.0148 8.59732 11.165 8.18782C11.3288 7.76466 11.5199 7.33468 11.7383 6.89787C11.9704 6.44741 12.2229 6.03108 12.4959 5.64888C12.8644 5.14382 13.2535 4.80939 13.663 4.64559C14.0861 4.48178 14.4888 4.39988 14.871 4.39988C15.4307 4.39988 15.888 4.55003 16.2429 4.85034C16.5978 5.15064 16.7752 5.58063 16.7752 6.14029C16.7752 6.67264 16.6046 7.10945 16.2633 7.45071C15.9221 7.79196 15.4785 7.96259 14.9325 7.96259C14.5093 7.96259 14.0861 7.81926 13.663 7.53261C13.2535 7.24595 12.9532 6.72724 12.7621 5.97648ZM7.21326 14.0233C7.65007 13.4363 8.00497 12.7811 8.27798 12.0577C8.56463 11.3205 8.78304 10.6653 8.93319 10.092C8.93319 10.092 9.00144 10.0988 9.13794 10.1125C9.27444 10.1125 9.34269 10.1125 9.34269 10.1125C9.24714 10.4947 9.11064 10.9383 8.93319 11.4434C8.75574 11.9485 8.54416 12.4603 8.29845 12.979C8.0664 13.4841 7.7934 13.9414 7.47944 14.3509C7.09723 14.8423 6.69455 15.1699 6.2714 15.3337C5.86189 15.5112 5.46603 15.5999 5.08383 15.5999C4.49687 15.5999 4.03959 15.4566 3.71198 15.1699C3.37073 14.8696 3.2001 14.4669 3.2001 13.9619C3.2001 13.3612 3.3912 12.8903 3.77341 12.5491C4.14196 12.2078 4.57877 12.0372 5.08383 12.0372C5.62984 12.0372 6.07347 12.2215 6.41472 12.59C6.76963 12.9449 7.03581 13.4227 7.21326 14.0233Z" fill="white"/></svg>`;

// Generic "tool output" mark — a white wrench glyph on a colored tile. Used by
// auto-citations (agentConfig.autoToolCitations), where ANY tool's result is
// chunked + cited but has no brand of its own. The tile color is picked
// deterministically per tool call (see `toolIconKey`) so each source reads as
// distinct while staying stable across reloads. Opaque so it reads on any chip
// background, like the Spaces mark.
const TOOL_ICON_COLORS = [
  "#6366f1", "#0ea5e9", "#14b8a6", "#10b981", "#f59e0b",
  "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4",
] as const;
function toolIconSvg(color: string): string {
  // Round disc + lucide "wrench" path, scaled 0.5 + inset 4px so it sits centered.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="${color}"/><path transform="translate(4 4) scale(0.5)" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
/** Per-tool-call color variants of the generic mark, keyed `tool-0`…`tool-N`.
 *  Kept OUT of CITATION_ICONS so the brand-key union stays narrow; resolved via
 *  the iconUrlForKey fallback below. Includes a back-compat bare `tool` alias for
 *  citations stamped before per-tool colors existed (icon bytes aren't persisted,
 *  only the key — so the alias is enough to revive their icon). */
const TOOL_ICON_VARIANTS: Record<string, string> = {
  tool: svgDataUri(toolIconSvg("#6366f1")),
};
TOOL_ICON_COLORS.forEach((color, i) => {
  TOOL_ICON_VARIANTS[`tool-${i}`] = svgDataUri(toolIconSvg(color));
});

/**
 * Brand-icon `data:` URIs per source, inlined so the icon ships inside the
 * citation payload — no asset stored in the dashboard. Centralized here so
 * adding a new source (e.g. Microsoft) is a ONE-FILE change: add its minified
 * SVG above + an entry here. claw stamps the value onto `iconUrl` and the
 * dashboard renders `<img src={iconUrl}>` unchanged.
 */
export const CITATION_ICONS = {
  gmail: svgDataUri(GMAIL_SVG),
  gcal: svgDataUri(GCAL_SVG),
  gdrive: svgDataUri(GDRIVE_SVG),
  /** Xyne Spaces mark — used for all native Spaces citations (thread/ticket/canvas/KB). */
  spaces: svgDataUri(SPACES_SVG),
};

/** The set of brand-icon keys (the keys of CITATION_ICONS). */
export type CitationIconKey = keyof typeof CITATION_ICONS;

/**
 * Resolve the stable icon KEY for a citation (not the bytes). External citations
 * are keyed by their Google `app`; every Spaces-native kind uses the `spaces`
 * mark. Returns undefined for a generic external link (no brand icon). This is
 * what claw stamps onto `iconKey` and persists; the heavy `data:` URI is
 * re-attached only at the send boundary via `iconUrlForKey`.
 */
export function citationIconKey(c: Citation): CitationIconKey | undefined {
  if (c.kind === "external") {
    if (c.app === "gmail") return "gmail";
    if (c.app === "gcal") return "gcal";
    if (c.app === "gdrive") return "gdrive";
    return undefined;
  }
  // thread / ticket / canvas / collection-item / recording are all Spaces-native.
  return "spaces";
}

/**
 * Pick a stable generic-tool mark variant key (`tool-0`…`tool-N`) from a seed —
 * the tool call id. Same seed → same color across reloads and the streaming vs
 * persisted paths, while different tool calls get different colors.
 */
export function toolIconKey(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  }
  return `tool-${hash % TOOL_ICON_COLORS.length}`;
}

/** Resolve an icon key to its inline `data:` SVG URI — used to hydrate citations
 *  at the send boundary. Returns undefined for a missing/unknown key. Falls back
 *  to the per-tool-call color variants (`tool-N`) for generic auto-citations. */
export function iconUrlForKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return (CITATION_ICONS as Record<string, string>)[key] ?? TOOL_ICON_VARIANTS[key];
}

/**
 * Resolve the brand-icon `data:` URI for a citation in one step (key → bytes).
 * Convenience wrapper over `citationIconKey` + `iconUrlForKey`.
 */
export function citationIconUrl(c: Citation): string | undefined {
  return iconUrlForKey(citationIconKey(c));
}
