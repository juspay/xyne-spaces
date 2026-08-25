/**
 * Threads (conversations): a channel holds threads, a thread holds messages.
 */

import {
	boundedLimit,
	cleanText,
	indented,
	list,
	ok,
	offsetOf,
	optionalString,
	record,
	requiredString,
	timeLine,
} from "../render.js";
import type { Conversation, MessageType } from "@xyne/spaces-sdk";
import type { Related } from "../render.js";
import { first } from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

interface MessageRef {
	messageId?: string;
	senderId?: string;
	content?: string;
	msgType?: string;
	createdAt?: number;
	isDeleted?: boolean;
}

/**
 * `channelLatestMultipleConversationsV3` joins the opening and parent message,
 * participants, the linked ticket, and attachments. The SDK's `Conversation`
 * types columns only, so the joins are declared here — and only the joins.
 */
type ConversationRow = Conversation & {
	initialMessage?: Related<MessageRef>;
	parentMessage?: Related<MessageRef>;
	participants?: Array<{ userId?: string }> | null;
	ticket?: Related<Record<string, unknown>>;
	initialMessageAttachments?: Array<Record<string, unknown>> | null;
};

function renderThread(row: ConversationRow, index: number): string {
	const opener = first(row.initialMessage);
	const preview = opener?.content ? cleanText(opener.content) : "";
	const title = `Thread ${row.conversationId ?? "(no id)"}${row.pinned ? " [pinned]" : ""}`;

	const lines: string[] = [];
	if (preview) lines.push(indented(preview));

	const detail: string[] = [];
	if (typeof row.replyCount === "number") detail.push(`${row.replyCount} repl${row.replyCount === 1 ? "y" : "ies"}`);
	if (row.threadType) detail.push(`type: ${row.threadType}`);
	if (opener?.msgType && opener.msgType !== "USER") detail.push(opener.msgType.toLowerCase());
	if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);

	const author = opener?.senderId ?? row.createdBy;
	if (author) lines.push(`  Started by: ${users.label(author)}`);

	const participants = (row.participants ?? []).map((p) => p.userId).filter((v): v is string => !!v);
	if (participants.length > 0) {
		const named = participants.map((id) => users.name(id) ?? id);
		lines.push(`  Participants (${named.length}): ${named.join(", ")}`);
	}

	const attachments = row.initialMessageAttachments ?? [];
	if (attachments.length > 0) lines.push(`  Attachments: ${attachments.length}`);

	const times = timeLine([
		["Created", row.createdAt],
		["Last active", row.lastActivityAt],
	]);
	if (times) lines.push(`  ${times}`);

	if (row.ticketId) lines.push(`  Ticket ID: ${row.ticketId}`);
	if (row.callId) lines.push(`  Call ID: ${row.callId}`);
	if (row.parentMessageId) lines.push(`  Parent message ID: ${row.parentMessageId}`);
	if (row.initialMessageId) lines.push(`  First message ID: ${row.initialMessageId}`);
	if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
	lines.push(`  Conversation ID: ${row.conversationId ?? "(none)"}`);

	return record(index, title, lines);
}

// ── spaces_threads_list ─────────────────────────────────────────────────────

const threadsList: ToolDef = {
	name: "spaces_threads_list",
	description:
		"List the most recent threads in one Xyne Spaces channel, newest activity first. A channel holds threads and a " +
		"thread holds messages, so this is the step between spaces_channels_list and spaces_messages_list: take a " +
		"channel id, get conversation ids. Returns per thread: the opening message, reply count, who started it, " +
		"participants, attachment count, created and last-active times, and any linked ticket or call. To read a " +
		"thread's replies, pass its Conversation ID to spaces_messages_list.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "Channel id, from spaces_channels_list or spaces_search." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max threads (default 20, max 100)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset applied to the fetched page." },
		},
		required: ["channel_id"],
		additionalProperties: false,
	},
	// The SDK's registry supplies `isMember` (a hint to Zero's ACL layer) and
	// the required `limit`, so neither is passed here.
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const channelId = requiredString(args, "channel_id");
		const limit = boundedLimit(args, 20, 100);
		const offset = offsetOf(args);

		const rows = (await sdk.conversations.listLatestByChannel(channelId, {
			limit: limit + offset,
		})) as ConversationRow[];
		rows.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
		const page = rows.slice(offset, offset + limit);
		const rendered = page.map((row, i) => renderThread(row, offset + i + 1));
		return list("thread(s)", rendered, { returned: rendered.length, limit, offset });
	},
};

// ── spaces_thread_get ───────────────────────────────────────────────────────

const threadGet: ToolDef = {
	name: "spaces_thread_get",
	description:
		"Read one Xyne Spaces thread by its conversation id: the opening message in full, who started it, the " +
		"participants, reply count, timestamps, and any linked ticket or call. Use this when you have a conversation " +
		"id from search and want the thread's context before reading or posting into it. For the replies themselves, " +
		"use spaces_messages_list.",
	inputSchema: {
		type: "object",
		properties: {
			conversation_id: { type: "string", description: "Conversation id, from spaces_threads_list or spaces_search." },
		},
		required: ["conversation_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const conversationId = requiredString(args, "conversation_id");
		// Nullable single in the SDK, where the old client normalised it into a
		// one-element array.
		const row = (await sdk.conversations.get(conversationId)) as ConversationRow | null;
		if (!row) return ok(`No thread found with conversation id ${conversationId}.`);
		return ok(renderThread(row, 1));
	},
};

// ── spaces_thread_create ────────────────────────────────────────────────────

const threadCreate: ToolDef = {
	name: "spaces_thread_create",
	description:
		"Start a NEW thread in a Xyne Spaces channel by posting its first message. This is how you say something in a " +
		"channel that is not a reply. To reply inside a thread that already exists, use spaces_message_send with that " +
		"thread's conversation id instead. Returns the new Conversation ID and Message ID. " +
		"Resolve the channel id with spaces_channels_list immediately before calling this and copy it verbatim — " +
		"posting into the wrong channel cannot be undone from here.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "Channel to post in, from spaces_channels_list." },
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
			attachment_ids: {
				type: "array",
				items: { type: "string" },
				description: "Ids of already-uploaded draft attachments to attach.",
			},
		},
		required: ["channel_id", "content"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const channelId = requiredString(args, "channel_id");
		const content = requiredString(args, "content");
		const attachmentIds = Array.isArray(args["attachment_ids"])
			? (args["attachment_ids"] as unknown[]).map(String)
			: undefined;

		// The SDK generates both ids and the timestamp, and returns the ids —
		// which is what this tool hands back to the model to chain on.
		const { conversationId, messageId } = await sdk.conversations.create({
			channelId,
			content,
			type: (optionalString(args, "type") ?? "USER") as MessageType,
			...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
		});

		return ok(
			[
				`Started a thread in channel ${channelId}.`,
				`  Conversation ID: ${conversationId}`,
				`  Message ID: ${messageId}`,
				"",
				"  Reply in this thread with spaces_message_send using the Conversation ID above.",
			].join("\n"),
		);
	},
};

export const threadTools: ToolDef[] = [threadsList, threadGet, threadCreate];
