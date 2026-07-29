/**
 * Microsoft tool definitions for the xyne-claw custom tool system.
 * All tools use source "custom:microsoft" and require a Microsoft OAuth access token
 * resolved via ctx.config["MICROSOFT_ACCESS_TOKEN"].
 */

import type { ToolDefinition, ToolExecutionContext, ConfigField } from "../types.js";
import { searchMessages, readMessage, createDraft, trashMessage } from "./outlook.js";
import { searchEvents, createEvent, deleteEvent, listCalendars } from "./calendar.js";
import { searchContacts, listContacts } from "./contacts.js";
import { listTaskLists, listTasks, createTask, updateTaskStatus, deleteTask } from "./tasks.js";
import { searchFiles, readFile } from "./onedrive.js";
import { listTeams, listChannels, readChannelMessages, sendChannelMessage, listChats, readChatMessages, sendChatMessage } from "./teams.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const MICROSOFT_CONFIG_SCHEMA: Record<string, ConfigField> = {
  MICROSOFT_ACCESS_TOKEN: { label: "Microsoft Access Token", default: "", required: true },
};

function getToken(ctx?: ToolExecutionContext): string {
  const token = ctx?.config["MICROSOFT_ACCESS_TOKEN"];
  if (!token) throw new Error("Microsoft tools require MICROSOFT_ACCESS_TOKEN in config");
  return token;
}

/** Encode attachment results using the [ATTACHMENT:...] protocol that custom-tools.ts detects. */
function encodeAttachment(fileName: string, mimeType: string, base64Data: string): string {
  return `[ATTACHMENT:${fileName}:${mimeType}]\n${base64Data}`;
}

// ─── Outlook Mail Tools ─────────────────────────────────────────────────────

export const microsoftOutlookSearch: ToolDefinition = {
  slug: "microsoft-outlook-search",
  name: "Outlook Search",
  description:
    "Search Outlook inbox. Uses Microsoft Search KQL syntax. " +
    "Returns message IDs, subjects, senders, dates, and snippets.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (e.g. 'from:alice@example.com', 'subject:meeting', 'hasAttachments:true')" },
      maxResults: { type: "number", description: "Max emails to return (1-50, default 10)" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchMessages(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};

export const microsoftOutlookRead: ToolDefinition = {
  slug: "microsoft-outlook-read",
  name: "Outlook Read",
  description:
    "Read a specific Outlook email by ID. Returns full headers (from, to, cc, date, subject) and body text. " +
    "Use microsoft-outlook-search first to find message IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Outlook message ID (from microsoft-outlook-search results)" },
    },
    required: ["messageId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return readMessage(token, args["messageId"] as string);
  },
};

export const microsoftOutlookDraft: ToolDefinition = {
  slug: "microsoft-outlook-draft",
  name: "Outlook Draft",
  description:
    "Create a draft email in Outlook. Can also create a reply draft by providing replyToMessageId.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address(es), comma-separated" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
      cc: { type: "string", description: "CC recipients (comma-separated)" },
      replyToMessageId: { type: "string", description: "Message ID to reply to (creates reply draft)" },
    },
    required: ["to", "subject", "body"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createDraft(
      token,
      args["to"] as string,
      args["subject"] as string,
      args["body"] as string,
      args["cc"] as string | undefined,
      args["replyToMessageId"] as string | undefined,
    );
  },
};

export const microsoftOutlookTrash: ToolDefinition = {
  slug: "microsoft-outlook-trash",
  name: "Outlook Trash",
  description:
    "Move an email to Deleted Items. Only use when the user explicitly asks to delete an email.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Outlook message ID to move to Deleted Items" },
    },
    required: ["messageId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return trashMessage(token, args["messageId"] as string);
  },
};



// ─── Calendar Tools ─────────────────────────────────────────────────────────

export const microsoftCalendarEvents: ToolDefinition = {
  slug: "microsoft-calendar-events",
  name: "Calendar Events",
  description:
    "Search or list Outlook Calendar events. Defaults to upcoming events in the next 7 days. " +
    "Use query to filter by subject text, timeMin/timeMax for date ranges (ISO 8601).",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text search within event subjects" },
      calendarId: { type: "string", description: "Calendar ID (omit for default calendar)" },
      timeMin: { type: "string", description: "Start of time range (ISO 8601, e.g. '2026-04-15T00:00:00Z')" },
      timeMax: { type: "string", description: "End of time range (ISO 8601)" },
      maxResults: { type: "number", description: "Max events to return (1-100, default 20)" },
    },
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchEvents(
      token,
      args["query"] as string | undefined,
      args["calendarId"] as string | undefined,
      args["timeMin"] as string | undefined,
      args["timeMax"] as string | undefined,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const microsoftCalendarCreate: ToolDefinition = {
  slug: "microsoft-calendar-create",
  name: "Calendar Create",
  description:
    "Create a new Outlook Calendar event. Use ISO 8601 format for times. " +
    "Can optionally create a Teams meeting link.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Event title/subject" },
      startTime: { type: "string", description: "Start time (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
      endTime: { type: "string", description: "End time (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
      calendarId: { type: "string", description: "Calendar ID (omit for default calendar)" },
      description: { type: "string", description: "Event description/body" },
      location: { type: "string", description: "Event location" },
      attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
      isOnlineMeeting: { type: "boolean", description: "Create a Teams meeting link (default: false)" },
    },
    required: ["subject", "startTime", "endTime"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createEvent(
      token,
      args["calendarId"] as string | undefined,
      args["subject"] as string,
      args["startTime"] as string,
      args["endTime"] as string,
      args["description"] as string | undefined,
      args["location"] as string | undefined,
      args["attendees"] as string[] | undefined,
      args["isOnlineMeeting"] as boolean | undefined,
    );
  },
};

export const microsoftCalendarDelete: ToolDefinition = {
  slug: "microsoft-calendar-delete",
  name: "Calendar Delete",
  description:
    "Delete an Outlook Calendar event. Use microsoft-calendar-events first to find event IDs.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "Event ID to delete" },
      calendarId: { type: "string", description: "Calendar ID (omit for default calendar)" },
    },
    required: ["eventId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return deleteEvent(token, args["calendarId"] as string | undefined, args["eventId"] as string);
  },
};

export const microsoftCalendarList: ToolDefinition = {
  slug: "microsoft-calendar-list",
  name: "Calendar List",
  description: "List all Outlook Calendars the user has access to. Returns calendar IDs and names.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(_args, ctx) {
    const token = getToken(ctx);
    return listCalendars(token);
  },
};

// ─── Contacts Tools ─────────────────────────────────────────────────────────

export const microsoftContactsSearch: ToolDefinition = {
  slug: "microsoft-contacts-search",
  name: "Contacts Search",
  description:
    "Search Microsoft contacts and people by name, email, or phone number. " +
    "Uses the People API which searches contacts, directory, and recent communications.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (name, email, or phone number)" },
      maxResults: { type: "number", description: "Max contacts to return (1-30, default 10)" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchContacts(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};

export const microsoftContactsList: ToolDefinition = {
  slug: "microsoft-contacts-list",
  name: "Contacts List",
  description: "List Outlook contacts. Returns names, emails, phones, and organizations.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      maxResults: { type: "number", description: "Max contacts to return (1-50, default 20)" },
    },
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return listContacts(token, (args["maxResults"] as number) ?? 20);
  },
};

// ─── Tasks (To Do) Tools ────────────────────────────────────────────────────

export const microsoftTasksLists: ToolDefinition = {
  slug: "microsoft-tasks-lists",
  name: "To Do Lists",
  description: "List all Microsoft To Do task lists. Returns list names and IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(_args, ctx) {
    const token = getToken(ctx);
    return listTaskLists(token);
  },
};

export const microsoftTasksList: ToolDefinition = {
  slug: "microsoft-tasks-list",
  name: "To Do Tasks",
  description:
    "List tasks in a Microsoft To Do list. Shows title, status, due date, and notes.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskListId: { type: "string", description: "Task list ID (from microsoft-tasks-lists)" },
      showCompleted: { type: "boolean", description: "Include completed tasks (default: false)" },
      maxResults: { type: "number", description: "Max tasks to return (1-100, default 20)" },
    },
    required: ["taskListId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return listTasks(
      token,
      args["taskListId"] as string,
      (args["showCompleted"] as boolean) ?? false,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const microsoftTasksCreate: ToolDefinition = {
  slug: "microsoft-tasks-create",
  name: "To Do Create",
  description: "Create a new task in a Microsoft To Do list. Optionally set notes, due date, and importance.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Task title" },
      taskListId: { type: "string", description: "Task list ID (from microsoft-tasks-lists)" },
      notes: { type: "string", description: "Task notes/description" },
      due: { type: "string", description: "Due date (YYYY-MM-DD format)" },
      importance: { type: "string", description: "Importance: low, normal, or high" },
    },
    required: ["title", "taskListId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createTask(
      token,
      args["taskListId"] as string,
      args["title"] as string,
      args["notes"] as string | undefined,
      args["due"] as string | undefined,
      args["importance"] as string | undefined,
    );
  },
};

export const microsoftTasksUpdate: ToolDefinition = {
  slug: "microsoft-tasks-update",
  name: "To Do Update",
  description: "Mark a Microsoft To Do task as completed or not started.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID (from microsoft-tasks-list results)" },
      taskListId: { type: "string", description: "Task list ID" },
      completed: { type: "boolean", description: "true to mark completed, false to mark not started" },
    },
    required: ["taskId", "taskListId", "completed"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return updateTaskStatus(
      token,
      args["taskListId"] as string,
      args["taskId"] as string,
      args["completed"] as boolean,
    );
  },
};

export const microsoftTasksDelete: ToolDefinition = {
  slug: "microsoft-tasks-delete",
  name: "To Do Delete",
  description: "Delete a task from a Microsoft To Do list.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID to delete" },
      taskListId: { type: "string", description: "Task list ID" },
    },
    required: ["taskId", "taskListId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return deleteTask(
      token,
      args["taskListId"] as string,
      args["taskId"] as string,
    );
  },
};

// ─── OneDrive Tools ─────────────────────────────────────────────────────────

export const microsoftOneDriveSearch: ToolDefinition = {
  slug: "microsoft-onedrive-search",
  name: "OneDrive Search",
  description:
    "Search files in OneDrive by name or content. Returns file names, types, sizes, and IDs. " +
    "Use microsoft-onedrive-read with the file ID to read file contents.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (file name or content keywords)" },
      maxResults: { type: "number", description: "Max files to return (1-50, default 10)" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchFiles(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};

export const microsoftOneDriveRead: ToolDefinition = {
  slug: "microsoft-onedrive-read",
  name: "OneDrive Read",
  description:
    "Read a OneDrive file by ID, path, or share URL. Supports PDF (text extraction), " +
    "Word (.docx), Excel (.xlsx as CSV), text files, and images. Use microsoft-onedrive-search to find files first.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      fileUrl: { type: "string", description: "OneDrive file ID, path (e.g. /Documents/file.docx), or share URL" },
    },
    required: ["fileUrl"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const result = await readFile(token, args["fileUrl"] as string);
    if (result.dataUrl) {
      const base64 = result.dataUrl.replace(/^data:[^;]+;base64,/, "");
      const fileName = (args["fileUrl"] as string).split("/").pop() ?? "file";
      return encodeAttachment(fileName, result.mime, base64);
    }
    return result.text;
  },
};

// ─── Teams Tools ────────────────────────────────────────────────────────────

export const microsoftTeamsList: ToolDefinition = {
  slug: "microsoft-teams-list",
  name: "Teams List",
  description: "List Microsoft Teams the user is a member of. Returns team names and IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(_args, ctx) {
    const token = getToken(ctx);
    return listTeams(token);
  },
};

export const microsoftTeamsChannels: ToolDefinition = {
  slug: "microsoft-teams-channels",
  name: "Teams Channels",
  description: "List channels in a Microsoft Teams team. Use microsoft-teams-list first to get team IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      teamId: { type: "string", description: "Team ID (from microsoft-teams-list)" },
    },
    required: ["teamId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return listChannels(token, args["teamId"] as string);
  },
};

export const microsoftTeamsMessages: ToolDefinition = {
  slug: "microsoft-teams-messages",
  name: "Teams Messages",
  description:
    "Read recent messages from a Teams channel. Use microsoft-teams-channels to find channel IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      teamId: { type: "string", description: "Team ID" },
      channelId: { type: "string", description: "Channel ID" },
      maxResults: { type: "number", description: "Max messages to return (1-50, default 20)" },
    },
    required: ["teamId", "channelId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return readChannelMessages(
      token,
      args["teamId"] as string,
      args["channelId"] as string,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const microsoftTeamsSend: ToolDefinition = {
  slug: "microsoft-teams-send",
  name: "Teams Send",
  description: "Send a message to a Teams channel.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      teamId: { type: "string", description: "Team ID" },
      channelId: { type: "string", description: "Channel ID" },
      content: { type: "string", description: "Message text" },
    },
    required: ["teamId", "channelId", "content"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return sendChannelMessage(
      token,
      args["teamId"] as string,
      args["channelId"] as string,
      args["content"] as string,
    );
  },
};

export const microsoftTeamsChats: ToolDefinition = {
  slug: "microsoft-teams-chats",
  name: "Teams Chats",
  description: "List the user's recent Teams chats (1:1, group, and meeting chats).",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      maxResults: { type: "number", description: "Max chats to return (1-50, default 20)" },
    },
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return listChats(token, (args["maxResults"] as number) ?? 20);
  },
};

export const microsoftTeamsChatMessages: ToolDefinition = {
  slug: "microsoft-teams-chat-messages",
  name: "Teams Chat Messages",
  description: "Read messages from a Teams chat. Use microsoft-teams-chats to find chat IDs.",
  source: "custom:microsoft",
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "Chat ID (from microsoft-teams-chats)" },
      maxResults: { type: "number", description: "Max messages to return (1-50, default 20)" },
    },
    required: ["chatId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return readChatMessages(
      token,
      args["chatId"] as string,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const microsoftTeamsChatSend: ToolDefinition = {
  slug: "microsoft-teams-chat-send",
  name: "Teams Chat Send",
  description: "Send a message in a Teams chat.",
  source: "custom:microsoft",
  isWriteTool: true,
  configSchema: MICROSOFT_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "Chat ID" },
      content: { type: "string", description: "Message text" },
    },
    required: ["chatId", "content"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return sendChatMessage(
      token,
      args["chatId"] as string,
      args["content"] as string,
    );
  },
};
