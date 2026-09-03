/**
 * Messages: reading a thread, and saying something in one.
 */

import {
	boundedLimit,
	cleanText,
	formatBytes,
	indented,
	list,
	ok,
	offsetOf,
	optionalBoolean,
	optionalString,
	record,
	requiredString,
	toIST,
} from "../render.js";
import { MAX_LIMIT, type Message, type MessageType } from "@xyne/spaces-sdk";
import type { MessageAttachment } from "@xyne/spaces-sdk";
import type { Related } from "../render.js";
import { first } from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

/**
 * The message list joins its attachments; the SDK types columns only, so the
 * relation is declared here.
 *
 * `conversation` is not joined by the sender query — see `spaces_user_messages`.
 */
type MessageRow = Message & {
	attachments?: Array<Partial<MessageAttachment>> | null;
	conversation?: Related<{ channelId?: string }>;
};

/**
 * Render one message with everything set on it.
 *
 * Content is emitted in full. A long message is the thing the caller asked for,
 * and a truncated one silently loses the part that mattered.
 */
function renderMessage(row: MessageRow, index: number): string {
	const when = row.createdAt ? `${toIST(row.createdAt)} IST` : "";
	const title = `${users.name(row.senderId) ?? users.label(row.senderId)}${when ? ` · ${when}` : ""}`;

	const lines: string[] = [];
	if (row.isDeleted) {
		lines.push("  (deleted)");
	} else if (row.content) {
		lines.push(indented(cleanText(row.content)));
	}

	const flags: string[] = [];
	if (row.msgType && row.msgType !== "USER") flags.push(row.msgType.toLowerCase());
	if (row.edited) flags.push("edited");
	if (row.showInChannel) flags.push("shown in channel");
	if (row.visibleTo) flags.push(`only visible to ${users.name(row.visibleTo) ?? row.visibleTo}`);
	if (row.isSent === false) flags.push("not sent");
	if (typeof row.nudgeCount === "number" && row.nudgeCount > 0) flags.push(`${row.nudgeCount} nudge(s)`);
	if (flags.length > 0) lines.push(`  ${flags.join(" · ")}`);

	for (const attachment of row.attachments ?? []) {
		const parts = [attachment.originalFilename, attachment.mimetype, formatBytes(attachment.size)].filter(Boolean);
		lines.push(`  Attachment: ${parts.join(" · ")}${attachment.id ? ` (id: ${attachment.id})` : ""}`);
	}

	if (row.senderId) lines.push(`  Sender ID: ${row.senderId}`);
	if (row.childConversationId) lines.push(`  Child thread ID: ${row.childConversationId}`);
	lines.push(`  Message ID: ${row.messageId ?? "(none)"}`);

	return record(index, title, lines);
}

// ── spaces_messages_list ────────────────────────────────────────────────────

const messagesList: ToolDef = {
	name: "spaces_messages_list",
	description:
		"Read the messages in one Xyne Spaces thread, oldest first, with each message's full text, author, timestamp, " +
		"attachments and message id. Take the conversation id from spaces_threads_list or from a spaces_search hit. " +
		"Message bodies are returned in full and are not truncated, so a long thread is a large response — narrow it " +
		"with limit and offset rather than asking for everything. To reply, pass the same conversation id to " +
		"spaces_message_send.",
	inputSchema: {
		type: "object",
		properties: {
			conversation_id: { type: "string", description: "Conversation (thread) id." },
			limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max messages (default 50, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset from the start of the thread." },
			newest_first: {
				type: "boolean",
				default: false,
				description: "Return the most recent messages instead of the start of the thread. Use this to catch up.",
			},
		},
		required: ["conversation_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const conversationId = requiredString(args, "conversation_id");
		const limit = boundedLimit(args, 50, MAX_LIMIT);
		const offset = offsetOf(args);
		const newestFirst = optionalBoolean(args, "newest_first") === true;

		// The SDK windows from the front and caps at 100, so "newest first" can
		// no longer be `reverse()` on the whole thread. The first call is what
		// reports `total` — the true length of the underlying result — and that
		// is what the window from the end is computed against.
		const head = (await sdk.messages.listByConversation(conversationId, { limit, offset })) as unknown as {
			items: MessageRow[];
			total: number;
		};

		let page = head.items;
		if (newestFirst && head.total > 0) {
			const from = Math.max(0, head.total - offset - limit);
			const tail = (await sdk.messages.listByConversation(conversationId, {
				limit,
				offset: from,
			})) as unknown as { items: MessageRow[] };
			page = [...tail.items].reverse();
		}

		const rendered = page.map((row, i) => renderMessage(row, offset + i + 1));
		return list("message(s)", rendered, { returned: rendered.length, limit, offset, total: head.total });
	},
};

// ── spaces_message_send ─────────────────────────────────────────────────────

const messageSend: ToolDef = {
	name: "spaces_message_send",
	description:
		"Post a message into an EXISTING Xyne Spaces thread. Needs the thread's conversation id — from " +
		"spaces_threads_list, spaces_thread_get, or a search hit. To start a new thread in a channel instead, use " +
		"spaces_thread_create. Returns the new Message ID. " +
		"Re-resolve the conversation id immediately before calling and copy it verbatim; a message posted to the " +
		"wrong thread is visible to everyone in that channel and cannot be recalled from here.",
	inputSchema: {
		type: "object",
		properties: {
			conversation_id: { type: "string", description: "Thread to reply in." },
			content: {
				type: "string",
				description:
					"Message body. Plain text or simple HTML — Spaces stores rich text as HTML, so <p>, <strong> and " +
					"<ul><li> render as written.",
			},
			type: {
				type: "string",
				enum: ["USER", "BOT", "SYSTEM", "FORWARDED"],
				default: "USER",
				description: "Message kind. Leave as USER unless you are posting as a bot.",
			},
			show_in_channel: {
				type: "boolean",
				description: "Also surface this reply in the parent channel, not only inside the thread.",
			},
			attachment_ids: {
				type: "array",
				items: { type: "string" },
				description: "Ids of already-uploaded draft attachments to attach.",
			},
		},
		required: ["conversation_id", "content"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const conversationId = requiredString(args, "conversation_id");
		const content = requiredString(args, "content");
		const showInChannel = optionalBoolean(args, "show_in_channel");
		const attachmentIds = Array.isArray(args["attachment_ids"])
			? (args["attachment_ids"] as unknown[]).map(String)
			: undefined;

		// The SDK generates the message id, the timestamp, and the child thread
		// id that surfacing a reply in the channel requires.
		const { messageId } = await sdk.messages.send({
			conversationId,
			content,
			type: (optionalString(args, "type") ?? "USER") as MessageType,
			...(showInChannel !== undefined ? { showInChannel } : {}),
			...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
		});

		return ok(`Sent to thread ${conversationId}.\n  Message ID: ${messageId}`);
	},
};

// ── spaces_message_update ───────────────────────────────────────────────────

const messageUpdate: ToolDef = {
	name: "spaces_message_update",
	description:
		"Edit the text of a Xyne Spaces message you sent. The message is marked as edited for everyone who can see it. " +
		"Needs the message id, which spaces_messages_list returns on every message. You can only edit your own " +
		"messages — an attempt on someone else's is refused by the server.",
	inputSchema: {
		type: "object",
		properties: {
			message_id: { type: "string", description: "Message to edit, from spaces_messages_list." },
			content: { type: "string", description: "Replacement body. Replaces the message text entirely." },
		},
		required: ["message_id", "content"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const messageId = requiredString(args, "message_id");
		const content = requiredString(args, "content");
		await sdk.messages.update(messageId, content);
		return ok(`Edited message ${messageId}.`);
	},
};

// ── spaces_message_react ────────────────────────────────────────────────────

const messageReact: ToolDef = {
	name: "spaces_message_react",
	description:
		"Add or remove an emoji reaction on a Xyne Spaces message, as yourself. Give the emoji by NAME without colons " +
		"— 'thumbsup', 'eyes', 'tada' — not as the character. Removing resolves the existing reaction by message, " +
		"user and emoji, so no reaction id is needed.",
	inputSchema: {
		type: "object",
		properties: {
			message_id: { type: "string", description: "Message to react to, from spaces_messages_list." },
			emoji: { type: "string", description: "Emoji name without colons, e.g. 'thumbsup'." },
			action: {
				type: "string",
				enum: ["add", "remove"],
				default: "add",
				description: "Whether to add the reaction or take it back off.",
			},
		},
		required: ["message_id", "emoji"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const messageId = requiredString(args, "message_id");
		const emojiName = requiredString(args, "emoji").replace(/:/g, "");
		const action = optionalString(args, "action") === "remove" ? "remove" : "add";

		// Two methods rather than one `action` argument; the SDK generates the
		// reaction and count ids that adding requires.
		if (action === "add") await sdk.messages.addReaction(messageId, emojiName);
		else await sdk.messages.removeReaction(messageId, emojiName);

		return ok(`${action === "add" ? "Added" : "Removed"} :${emojiName}: on message ${messageId}.`);
	},
};

// ── spaces_user_messages ────────────────────────────────────────────────────

/**
 * "Everything person X wrote", newest first.
 *
 * This used to be a Zero query (`messagesBySenderPaginated`) with real cursors.
 * That query was removed and the operation now routes through Vespa, ordered by
 * `newest` rather than ranked by relevance, so the ordering guarantee survives
 * and it is still not a relevance search. Two things did change with it, both
 * visible to a caller:
 *
 *   - date bounds are truncated to whole days, because the search API takes a
 *     date rather than a timestamp;
 *   - the channel a message belongs to is no longer joined, so a result names
 *     its thread but not its channel. `spaces_thread_get` resolves the rest.
 *
 * The read ACL still applies either way: this surfaces nothing the caller could
 * not already see.
 */
const userMessages: ToolDef = {
	name: "spaces_user_messages",
	description:
		"List the messages one person wrote across all of Xyne Spaces, newest first, optionally bounded by date. " +
		"This is the right tool for 'what has Priya been working on', 'what did I post yesterday', or building a " +
		"digest of someone's week. Unlike spaces_search it is an exact ordered scan rather than a relevance ranking, " +
		"so nothing is silently dropped and an empty result genuinely means they wrote nothing in that window. " +
		"Omit user to get your own messages. Each message shows its text, timestamp, thread, and channel, so you can " +
		"follow any of them with spaces_messages_list.",
	inputSchema: {
		type: "object",
		properties: {
			user: {
				type: "string",
				description: "Whose messages to list — a user id or an email address. Omit for your own.",
			},
			after: {
				type: "string",
				description: "Only messages at or after this time. ISO 8601, e.g. '2026-08-01T00:00:00Z'.",
			},
			before: { type: "string", description: "Only messages at or before this time. ISO 8601." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 50, description: "Max messages (default 50, max 100)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const limit = boundedLimit(args, 50, MAX_LIMIT);
		const offset = offsetOf(args);
		const requested = optionalString(args, "user");
		const userId = await users.toUserId(sdk, requested);
		if (requested && !userId) throw new Error(`No Spaces user matches "${requested}".`);

		const after = optionalString(args, "after");
		const before = optionalString(args, "before");

		// With no user named the caller means themselves, and `listMine` is bound
		// to the caller — which saves resolving an id, and is still the Zero
		// query, so it takes no date bounds.
		const rows = userId
			? ((await sdk.messages.listByUser({
					userId,
					limit,
					offset,
					...(after ? { after: Date.parse(after) } : {}),
					...(before ? { before: Date.parse(before) } : {}),
				})) as MessageRow[])
			: ((await sdk.messages.listMine({ limit })) as MessageRow[]);

		let page = rows;
		if (!userId && (after || before)) {
			// Filter here rather than silently ignoring what the caller asked for.
			const lower = after ? Date.parse(after) : Number.NEGATIVE_INFINITY;
			const upper = before ? Date.parse(before) : Number.POSITIVE_INFINITY;
			page = rows.filter((r) => (r.createdAt ?? 0) >= lower && (r.createdAt ?? 0) <= upper);
		}

		const rendered = page.map((row, i) => {
			const text = renderMessage(row, offset + i + 1);
			// Only the Zero-backed `listMine` still joins the conversation; the
			// Vespa path does not, so this is absent there rather than wrong.
			const channelId = first(row.conversation)?.channelId;
			return channelId ? `${text}\n  Channel ID: ${channelId}` : text;
		});

		const whose = userId ? (users.name(userId) ?? userId) : "you";
		return list(`message(s) from ${whose}`, rendered, { returned: rendered.length, limit, offset });
	},
};

export const messageTools: ToolDef[] = [messagesList, userMessages, messageSend, messageUpdate, messageReact];
