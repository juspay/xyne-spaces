/**
 * Messages: reading a thread, and saying something in one.
 */

import { newId, now } from "../client.js";
import {
	asRows,
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
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

interface AttachmentRow {
	id?: string;
	fileName?: string;
	mimeType?: string;
	fileSize?: number;
}

interface MessageRow {
	messageId?: string;
	conversationId?: string;
	childConversationId?: string | null;
	senderId?: string;
	content?: string;
	msgType?: string;
	hasAttachment?: boolean;
	edited?: boolean;
	isDeleted?: boolean;
	showInChannel?: boolean;
	visibleTo?: string | null;
	isSent?: boolean;
	nudgeCount?: number | null;
	createdAt?: number;
	attachments?: AttachmentRow[] | null;
}

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
		const parts = [attachment.fileName, attachment.mimeType, formatBytes(attachment.fileSize)].filter(Boolean);
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
	catalog: [{ name: "conversationMessagesV2", sends: ["conversationId"] }],
	async handler(args, client) {
		await users.prime(client);
		const conversationId = requiredString(args, "conversation_id");
		const limit = boundedLimit(args, 50, 200);
		const offset = offsetOf(args);

		const rows = asRows<MessageRow>(await client.catalogQuery("conversationMessagesV2", { conversationId }));
		const ordered = optionalBoolean(args, "newest_first") === true ? [...rows].reverse() : rows;
		const page = ordered.slice(offset, offset + limit);
		const rendered = page.map((row, i) => renderMessage(row, offset + i + 1));
		return list("message(s)", rendered, { returned: rendered.length, limit, offset, total: rows.length });
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
	catalog: [{ name: "messages.send", sends: ["conversationId", "content", "type", "messageId", "timestamp"] }],
	write: true,
	async handler(args, client) {
		const conversationId = requiredString(args, "conversation_id");
		const content = requiredString(args, "content");
		const messageId = newId();
		const showInChannel = optionalBoolean(args, "show_in_channel");
		const attachmentIds = Array.isArray(args["attachment_ids"])
			? (args["attachment_ids"] as unknown[]).map(String)
			: undefined;

		await client.catalogMutate("messages.send", {
			conversationId,
			content,
			type: optionalString(args, "type") ?? "USER",
			messageId,
			timestamp: now(),
			// Surfacing a reply in the channel creates a child thread row, whose id
			// the caller has to pick for the same reason it picks the message id.
			...(showInChannel !== undefined ? { showInChannel, childConversationId: newId() } : {}),
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
	catalog: [{ name: "messages.update", sends: ["messageId", "content"] }],
	write: true,
	async handler(args, client) {
		const messageId = requiredString(args, "message_id");
		const content = requiredString(args, "content");
		await client.catalogMutate("messages.update", { messageId, content });
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
	catalog: [{ name: "messages.react", sends: ["messageId", "emojiName", "action", "timestamp", "reactionId", "countId"] }],
	write: true,
	async handler(args, client) {
		const messageId = requiredString(args, "message_id");
		const emojiName = requiredString(args, "emoji").replace(/:/g, "");
		const action = optionalString(args, "action") === "remove" ? "remove" : "add";

		await client.catalogMutate("messages.react", {
			messageId,
			emojiName,
			action,
			timestamp: now(),
			// Only meaningful when adding; harmless on remove, where the server
			// finds the existing rows by (message, user, emoji).
			reactionId: newId(),
			countId: newId(),
		});

		return ok(`${action === "add" ? "Added" : "Removed"} :${emojiName}: on message ${messageId}.`);
	},
};

export const messageTools: ToolDef[] = [messagesList, messageSend, messageUpdate, messageReact];
