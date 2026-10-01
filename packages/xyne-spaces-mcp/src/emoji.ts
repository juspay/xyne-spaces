import { createRequire } from "node:module";

/**
 * Reactions are stored as the token the dashboard's picker produces: the native
 * character for a standard emoji ("👍"), or `custom:<emojiId>:<name>` for a
 * workspace custom emoji. The UI renders that token verbatim, so storing a
 * shortcode like "thumbsup" shows the word instead of the emoji. Names are
 * resolved against emoji-datasource, the same dataset the dashboard uses.
 */

interface DatasourceEntry {
	unified: string;
	short_names: string[];
}

let byName: Map<string, string> | null = null;

const unifiedToEmoji = (unified: string): string =>
	unified
		.split("-")
		.map((code) => String.fromCodePoint(parseInt(code, 16)))
		.join("");

function names(): Map<string, string> {
	if (byName) return byName;
	const data = createRequire(import.meta.url)("emoji-datasource/emoji.json") as DatasourceEntry[];
	byName = new Map();
	for (const entry of data) {
		const char = unifiedToEmoji(entry.unified);
		for (const name of entry.short_names) byName.set(name.toLowerCase(), char);
	}
	return byName;
}

/**
 * Turn what a caller passed — a shortcode with or without colons, a native
 * emoji, or a custom-emoji token — into the stored reaction token. Returns
 * undefined for a shortcode that names no known emoji.
 */
export function toReactionToken(input: string): string | undefined {
	const value = input.trim();
	if (value.startsWith("custom:")) return value;
	// Anything outside ASCII is already a native emoji.
	if (/[^\x00-\x7F]/.test(value)) return value;
	return names().get(value.replace(/^:|:$/g, "").toLowerCase());
}
