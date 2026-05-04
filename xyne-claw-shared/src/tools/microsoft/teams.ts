/**
 * Microsoft Teams API helpers (via Microsoft Graph).
 */

import { microsoftFetch } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0";

interface Team {
  id: string;
  displayName: string;
  description?: string;
}

interface Channel {
  id: string;
  displayName: string;
  description?: string;
  membershipType?: string;
}

interface ChatMessage {
  id: string;
  createdDateTime: string;
  body: { contentType: string; content: string };
  from?: { user?: { displayName?: string; id?: string } };
  importance?: string;
  webUrl?: string;
}

interface Chat {
  id: string;
  topic?: string;
  chatType: "oneOnOne" | "group" | "meeting";
  lastUpdatedDateTime?: string;
  members?: Array<{ displayName?: string; userId?: string; email?: string }>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function validateId(id: string, name: string) {
  if (!id || id.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function formatMessage(msg: ChatMessage): string | null {
  // If it's a system event (like a call started), the body content is just "<systemEventMessage/>"
  let body = msg.body.contentType === "html" ? stripHtml(msg.body.content) : msg.body.content;
  if (!body) return null; // Skip empty/system messages entirely
  
  if (body.length > 500) body = body.slice(0, 500) + "...";
  const from = msg.from?.user?.displayName ?? "(unknown)";

  return `[${msg.createdDateTime}] ${from}: ${body}`;
}

/** List teams the user is a member of. */
export async function listTeams(token: string): Promise<string> {
  const result = (await microsoftFetch(
    `${BASE}/me/joinedTeams?$select=id,displayName,description`,
    token,
  )) as { value: Team[] };

  if (!result.value || result.value.length === 0) {
    return "No teams found.";
  }

  const lines = result.value.map((t) => {
    const desc = t.description ? ` — ${t.description.slice(0, 100)}` : "";
    return `[${t.id}] ${t.displayName}${desc}`;
  });

  return `Teams:\n\n${lines.join("\n")}`;
}

/** List channels in a team. */
export async function listChannels(
  token: string,
  teamId: string,
): Promise<string> {
  validateId(teamId, "teamId");
  const result = (await microsoftFetch(
    `${BASE}/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,description,membershipType`,
    token,
  )) as { value: Channel[] };

  if (!result.value || result.value.length === 0) {
    return "No channels found.";
  }

  const lines = result.value.map((ch) => {
    const type = ch.membershipType ? ` (${ch.membershipType})` : "";
    const desc = ch.description ? ` — ${ch.description.slice(0, 80)}` : "";
    return `[${ch.id}] ${ch.displayName}${type}${desc}`;
  });

  return `Channels:\n\n${lines.join("\n")}`;
}

/** Read recent messages from a Teams channel. */
export async function readChannelMessages(
  token: string,
  teamId: string,
  channelId: string,
  maxResults: number,
): Promise<string> {
  validateId(teamId, "teamId");
  validateId(channelId, "channelId");
  const result = (await microsoftFetch(
    `${BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${maxResults}`,
    token,
  )) as { value: ChatMessage[] };

  if (!result.value || result.value.length === 0) {
    return "No messages found in this channel.";
  }

  const lines = result.value.map(formatMessage).filter(Boolean);
  if (lines.length === 0) {
    return "No readable text messages found in this channel (only system events).";
  }
  return `${lines.length} message(s):\n\n${lines.join("\n\n")}`;
}

/** Send a message to a Teams channel. */
export async function sendChannelMessage(
  token: string,
  teamId: string,
  channelId: string,
  content: string,
): Promise<string> {
  validateId(teamId, "teamId");
  validateId(channelId, "channelId");
  const result = (await microsoftFetch(
    `${BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        body: { content, contentType: "text" },
      }),
    },
  )) as ChatMessage;

  return `Message sent to channel.\nTimestamp: ${result.createdDateTime}\nID: ${result.id}`;
}

/** List the user's recent chats. */
export async function listChats(
  token: string,
  maxResults: number,
): Promise<string> {
  const result = (await microsoftFetch(
    `${BASE}/me/chats?$top=${maxResults}&$select=id,topic,chatType,lastUpdatedDateTime&$expand=members`,
    token,
  )) as { value: Chat[] };

  if (!result.value || result.value.length === 0) {
    return "No chats found.";
  }

  const lines = result.value.map((chat) => {
    const topic = chat.topic ?? "(no topic)";
    const type = chat.chatType;
    const members = chat.members
      ?.map((m) => m.displayName ?? "Unknown")
      .join(", ") ?? "";
    return `[${chat.id}] ${topic} (${type})\n  Members: ${members}\n  Last activity: ${chat.lastUpdatedDateTime ?? "?"}`;
  });

  return `${result.value.length} chat(s):\n\n${lines.join("\n\n")}`;
}

/** Read messages from a chat. */
export async function readChatMessages(
  token: string,
  chatId: string,
  maxResults: number,
): Promise<string> {
  validateId(chatId, "chatId");
  const result = (await microsoftFetch(
    `${BASE}/me/chats/${encodeURIComponent(chatId)}/messages?$top=${maxResults}`,
    token,
  )) as { value: ChatMessage[] };

  if (!result.value || result.value.length === 0) {
    return "No messages in this chat.";
  }

  const lines = result.value.map(formatMessage).filter(Boolean);
  if (lines.length === 0) {
    return "No readable text messages in this chat (only system events).";
  }
  return `${lines.length} message(s):\n\n${lines.join("\n\n")}`;
}

/** Send a message in a chat. */
export async function sendChatMessage(
  token: string,
  chatId: string,
  content: string,
): Promise<string> {
  validateId(chatId, "chatId");
  const result = (await microsoftFetch(
    `${BASE}/me/chats/${encodeURIComponent(chatId)}/messages`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        body: { content, contentType: "text" },
      }),
    },
  )) as ChatMessage;

  return `Message sent.\nTimestamp: ${result.createdDateTime}\nID: ${result.id}`;
}
