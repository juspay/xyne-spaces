/**
 * Shared rendering helpers.
 *
 * There is deliberately no generic row projector here. Each read tool writes its
 * own renderer and emits every column that carries meaning, because what matters
 * about a ticket is not what matters about a channel. What this file holds is
 * the vocabulary those renderers share: how a timestamp reads, how a user is
 * labelled, how a page announces that more results exist.
 *
 * Ported from `apps/xyne-claw-auth/backend/src/mcp/servers/xyne-spaces-tools.ts`,
 * which is the production-tested version of these conventions.
 */

// ── Results ─────────────────────────────────────────────────────────────────

export interface ToolResult {
	[key: string]: unknown;
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

export function ok(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

export function err(message: string): ToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

/** Append to a result's text block, e.g. a pagination footer or a caveat. */
export function appendText(result: ToolResult, extra: string): void {
	const first = result.content[0];
	if (extra && first && first.type === "text") first.text = first.text + extra;
}

/**
 * One rendered record: a title line, then indented detail lines.
 *
 * Numbered so an agent can refer back to "the third ticket" and so a long
 * response stays navigable.
 */
export function record(index: number, title: string, lines: string[]): string {
	return [`${index}. ${title}`, ...lines].join("\n");
}

/** Assemble a list response: a count, the records, then the pagination footer. */
export function list(
	noun: string,
	records: string[],
	page: { returned: number; limit: number; offset: number; total?: number },
): ToolResult {
	if (records.length === 0) return ok(`No ${noun} found.`);
	return ok(`${records.length} ${noun}:\n\n${records.join("\n\n")}${paginationFooter(page)}`);
}

/**
 * Tell the agent whether more results exist and how to reach them.
 *
 * Without this, a tool that returns exactly its `limit` looks like a complete
 * answer even when the underlying data holds far more. Pass `total` when an
 * exact count is known (search surfaces one); otherwise a full page is taken to
 * mean there is probably more behind it.
 */
export function paginationFooter(p: {
	returned: number;
	limit: number;
	offset: number;
	total?: number;
}): string {
	const { returned, limit, offset, total } = p;
	const next = offset + returned;
	if (typeof total === "number") {
		if (next < total) {
			return `\n\n[Showing ${offset + 1}-${next} of ${total}. More available — call again with offset=${next} and the same filters.]`;
		}
		return offset > 0 || total > limit ? `\n\n[Showing ${offset + 1}-${next} of ${total} — end of results.]` : "";
	}
	if (returned >= limit) {
		return `\n\n[Showing ${returned} result(s) from offset ${offset}. There may be more — call again with offset=${next} and the same filters.]`;
	}
	return offset > 0 ? `\n\n[Showing ${returned} result(s) from offset ${offset} — end of results.]` : "";
}

// ── Time ────────────────────────────────────────────────────────────────────

const SANE_MIN_MS = 946684800000; // 2000-01-01
const SANE_MAX_MS = 4102444800000; // 2100-01-01

/**
 * Render a timestamp in IST, the timezone the product reports in.
 *
 * Zero returns epoch milliseconds as numbers, but a value that has been through
 * a JSON round trip can arrive as a numeric string — `new Date("1700000000000")`
 * parses that as a date string and yields Invalid Date, so all-digit strings are
 * coerced back to numbers first. A value outside a sane range degrades to
 * "(date n/a)" rather than rendering an absurd year.
 */
export function toIST(value: Date | string | number | null | undefined): string {
	if (value === null || value === undefined || value === "") return "(date n/a)";
	const trimmed = typeof value === "string" ? value.trim() : value;
	const coerced =
		typeof trimmed === "string" && /^\d{10,}$/.test(trimmed)
			? Number(trimmed) * (trimmed.length === 10 ? 1000 : 1)
			: trimmed;
	const ms = new Date(coerced).getTime();
	if (Number.isNaN(ms) || ms < SANE_MIN_MS || ms > SANE_MAX_MS) return "(date n/a)";
	return new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** `Created: … IST · Updated: … IST`, skipping whichever is absent. */
export function timeLine(entries: Array<[string, unknown]>): string | undefined {
	const parts = entries
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([label, v]) => `${label}: ${toIST(v as string | number)} IST`);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ── Text ────────────────────────────────────────────────────────────────────

/** Decode the entities that survive tag-stripping. `&amp;` last, so `&amp;lt;`
 *  becomes `&lt;` rather than double-decoding into a real tag character. */
function decodeHtmlEntities(s: string): string {
	return s
		.replace(/&nbsp;/gi, " ")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#0*39;|&apos;/gi, "'")
		.replace(/&#(\d+);/g, (m, n: string) => {
			try {
				return String.fromCodePoint(Number(n));
			} catch {
				return m;
			}
		})
		.replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => {
			try {
				return String.fromCodePoint(parseInt(h, 16));
			} catch {
				return m;
			}
		})
		.replace(/&amp;/gi, "&");
}

/**
 * Rich-text HTML to readable markdown-ish plain text — **without truncating**.
 *
 * Message bodies and ticket descriptions are stored as TipTap/ProseMirror HTML
 * (`<h2>`, `<p class=…>`, `<ul><li>`, `<strong>`); handing that to a model raw
 * spends most of the tokens on tag noise. Block and inline structure is mapped
 * to markdown so meaning survives, and the rest is stripped.
 *
 * Length is not this function's problem. A long description is information the
 * caller asked for.
 */
export function cleanText(text: unknown): string {
	if (typeof text !== "string" || text.length === 0) return "";
	if (!/<[a-z!/][^>]*>/i.test(text)) return decodeHtmlEntities(text).trim();
	const stripped = text
		.replace(/<\/?hi>/gi, "**")
		.replace(/<h1[^>]*>/gi, "\n\n# ")
		.replace(/<h2[^>]*>/gi, "\n\n## ")
		.replace(/<h3[^>]*>/gi, "\n\n### ")
		.replace(/<h[4-6][^>]*>/gi, "\n\n#### ")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
		.replace(/<\/?(em|i)\b[^>]*>/gi, "*")
		.replace(/<br\s*\/?>/gi, "\n")
		// `li` is deliberately absent: `<li>` already opens its own line, so
		// closing it too would put a blank line between every bullet.
		.replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|tr)>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	return decodeHtmlEntities(stripped)
		.replace(/[ \t]+\n/g, "\n")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Indent every line of a possibly multi-line value.
 *
 * Message bodies and ticket descriptions run to many lines, and only the first
 * would otherwise sit inside its record — the rest would start at column zero
 * and read as though they belonged to the response rather than to the item.
 */
export function indented(text: string, pad = "  "): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? pad + line : line))
		.join("\n");
}

/** "2.4 MB". Empty for a missing or zero size, so the caller can skip the line. */
export function formatBytes(bytes: unknown): string {
	const n = typeof bytes === "number" ? bytes : Number(bytes);
	if (!Number.isFinite(n) || n <= 0) return "";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = n;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

// ── Reading arguments ───────────────────────────────────────────────────────

export function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function requiredString(args: Record<string, unknown>, key: string): string {
	const value = optionalString(args, key);
	if (value === undefined) throw new Error(`Missing required parameter: ${key}`);
	return value;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
	const value = args[key];
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

export function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
	const value = args[key];
	if (Array.isArray(value)) {
		const items = value.map((v) => String(v).trim()).filter((v) => v.length > 0);
		return items.length > 0 ? items : undefined;
	}
	const single = optionalString(args, key);
	return single ? [single] : undefined;
}

/** Clamp a caller's `limit` into range. Tools document their own default and cap. */
export function boundedLimit(args: Record<string, unknown>, fallback: number, max: number): number {
	const value = optionalNumber(args, "limit");
	if (value === undefined) return fallback;
	return Math.max(1, Math.min(Math.floor(value), max));
}

export function offsetOf(args: Record<string, unknown>): number {
	const value = optionalNumber(args, "offset");
	return value === undefined ? 0 : Math.max(0, Math.floor(value));
}

/** Rows come back as arrays; a `.one()` query returns the object directly. */
export function asRows<T = Record<string, unknown>>(raw: unknown): T[] {
	if (Array.isArray(raw)) return raw as T[];
	if (raw && typeof raw === "object") return [raw as T];
	return [];
}

/**
 * A Zero `.related()` join, as it actually arrives.
 *
 * A singular relation comes back either as the object or as a one-element
 * array depending on the query, and an absent one as null or undefined. The
 * SDK's row types declare none of these — they are columns only — so tool
 * files intersect this onto them for the relations their renderers read.
 */
export type Related<T> = T | T[] | null | undefined;

/** First element of a `Related<T>`, whichever shape it arrived in. */
export function first<T>(value: Related<T>): T | undefined {
	return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/**
 * Assign only when defined.
 *
 * `exactOptionalPropertyTypes` is on in this package, so `{ priority: maybe }`
 * does not typecheck against `priority?: string` when `maybe` is
 * `string | undefined`. Conditional spreads work but are unreadable twenty
 * times over, which is roughly how many optional fields `SearchOptions` has.
 */
export function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
	if (value !== undefined) target[key] = value;
}
