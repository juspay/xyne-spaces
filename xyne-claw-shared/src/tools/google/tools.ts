/**
 * Google tool definitions for the xyne-claw custom tool system.
 * All 18 tools use source "custom:google" and require a Google OAuth access token
 * resolved via ctx.config["GOOGLE_ACCESS_TOKEN"].
 */

import type { ToolDefinition, ToolExecutionContext, ConfigField } from "../types.js";
import { searchEmails, readEmail, createDraft, getAttachment, trashEmail } from "./gmail.js";
import { searchEvents, createEvent, deleteEvent, listCalendars } from "./calendar.js";
import { searchContacts, listContacts } from "./contacts.js";
import { listTaskLists, listTasks, createTask, updateTaskStatus, deleteTask } from "./tasks.js";
import { readDriveFile, searchDriveFiles } from "./drive.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const GOOGLE_CONFIG_SCHEMA: Record<string, ConfigField> = {
  GOOGLE_ACCESS_TOKEN: { label: "Google Access Token", default: "", required: true },
};

function getToken(ctx?: ToolExecutionContext): string {
  const token = ctx?.config["GOOGLE_ACCESS_TOKEN"];
  if (!token) throw new Error("Google tools require GOOGLE_ACCESS_TOKEN in config");
  return token;
}

/** Encode attachment results using the [ATTACHMENT:...] protocol that custom-tools.ts detects. */
function encodeAttachment(fileName: string, mimeType: string, base64Data: string): string {
  return `[ATTACHMENT:${fileName}:${mimeType}]\n${base64Data}`;
}

// ─── Gmail Tools ────────────────────────────────────────────────────────────

export const googleGmailSearch: ToolDefinition = {
  slug: "google-gmail-search",
  name: "Gmail Search",
  description:
    "Search Gmail inbox. Use Gmail search syntax: from:, to:, subject:, after:, before:, is:unread, has:attachment, label:, etc. " +
    "Returns message IDs, subjects, senders, dates, and snippets.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query (e.g. 'from:alice@example.com is:unread')" },
      maxResults: { type: "number", description: "Max emails to return (1-50, default 10)" },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchEmails(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};

export const googleGmailRead: ToolDefinition = {
  slug: "google-gmail-read",
  name: "Gmail Read",
  description:
    "Read a specific Gmail message by ID. Returns full headers (from, to, cc, date, subject) and body text. " +
    "Use google-gmail-search first to find message IDs.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Gmail message ID (from google-gmail-search results)" },
    },
    required: ["messageId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return readEmail(token, args["messageId"] as string);
  },
};

export const googleGmailDraft: ToolDefinition = {
  slug: "google-gmail-draft",
  name: "Gmail Draft",
  description:
    "Create a draft email in Gmail. Can also create a reply draft by providing inReplyTo and threadId.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
      cc: { type: "string", description: "CC recipients (comma-separated)" },
      inReplyTo: { type: "string", description: "Message-ID header of the email being replied to" },
      threadId: { type: "string", description: "Gmail thread ID to reply in" },
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
      args["inReplyTo"] as string | undefined,
      args["threadId"] as string | undefined,
    );
  },
};

export const googleGmailTrash: ToolDefinition = {
  slug: "google-gmail-trash",
  name: "Gmail Trash",
  description:
    "Move an email to trash. Only use this for emails the user explicitly asks to delete.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Gmail message ID to move to trash" },
    },
    required: ["messageId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return trashEmail(token, args["messageId"] as string);
  },
};

export const googleGmailAttachment: ToolDefinition = {
  slug: "google-gmail-attachment",
  name: "Gmail Attachment",
  description:
    "Download and read a Gmail attachment. Returns decoded text for text files (CSV, JSON, etc.) " +
    "and visual content for images. Use google-gmail-read first to get attachment IDs.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "Gmail message ID" },
      attachmentId: { type: "string", description: "Attachment ID (from google-gmail-read results)" },
      filename: { type: "string", description: "Filename of the attachment" },
      mimeType: { type: "string", description: "MIME type of the attachment (e.g. 'image/png', 'application/pdf', 'text/csv')" },
    },
    required: ["messageId", "attachmentId", "filename", "mimeType"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const result = await getAttachment(
      token,
      args["messageId"] as string,
      args["attachmentId"] as string,
      args["filename"] as string,
      args["mimeType"] as string,
    );
    if (result.dataUrl) {
      // Extract base64 data from data URL for the attachment protocol
      const base64 = result.dataUrl.replace(/^data:[^;]+;base64,/, "");
      return encodeAttachment(args["filename"] as string, result.mime, base64);
    }
    return result.text;
  },
};

// ─── Calendar Tools ─────────────────────────────────────────────────────────

export const googleCalendarEvents: ToolDefinition = {
  slug: "google-calendar-events",
  name: "Calendar Events",
  description:
    "Search or list Google Calendar events. Defaults to upcoming events in the next 7 days on the primary calendar. " +
    "Use query to filter by text, timeMin/timeMax for date ranges (ISO 8601).",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text search within event fields" },
      calendarId: { type: "string", description: "Calendar ID (default: 'primary')" },
      timeMin: { type: "string", description: "Start of time range (ISO 8601, e.g. '2026-03-23T00:00:00Z')" },
      timeMax: { type: "string", description: "End of time range (ISO 8601)" },
      maxResults: { type: "number", description: "Max events to return (1-100, default 20)" },
    },
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return searchEvents(
      token,
      args["query"] as string | undefined,
      (args["calendarId"] as string) ?? "primary",
      args["timeMin"] as string | undefined,
      args["timeMax"] as string | undefined,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const googleCalendarCreate: ToolDefinition = {
  slug: "google-calendar-create",
  name: "Calendar Create",
  description:
    "Create a new Google Calendar event. Use ISO 8601 format for times (e.g. '2026-03-25T14:00:00-05:00') " +
    "or date only for all-day events (e.g. '2026-03-25').",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title" },
      startTime: { type: "string", description: "Start time (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
      endTime: { type: "string", description: "End time (ISO 8601 datetime or YYYY-MM-DD for all-day)" },
      calendarId: { type: "string", description: "Calendar ID (default: 'primary')" },
      description: { type: "string", description: "Event description" },
      location: { type: "string", description: "Event location" },
      attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses" },
    },
    required: ["summary", "startTime", "endTime"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createEvent(
      token,
      (args["calendarId"] as string) ?? "primary",
      args["summary"] as string,
      args["startTime"] as string,
      args["endTime"] as string,
      args["description"] as string | undefined,
      args["location"] as string | undefined,
      args["attendees"] as string[] | undefined,
    );
  },
};

export const googleCalendarDelete: ToolDefinition = {
  slug: "google-calendar-delete",
  name: "Calendar Delete",
  description:
    "Delete a Google Calendar event. Use google-calendar-events first to find event IDs.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "Event ID to delete" },
      calendarId: { type: "string", description: "Calendar ID (default: 'primary')" },
    },
    required: ["eventId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return deleteEvent(token, (args["calendarId"] as string) ?? "primary", args["eventId"] as string);
  },
};

export const googleCalendarList: ToolDefinition = {
  slug: "google-calendar-list",
  name: "Calendar List",
  description: "List all Google Calendars the user has access to. Returns calendar IDs and names.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
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

export const googleContactsSearch: ToolDefinition = {
  slug: "google-contacts-search",
  name: "Contacts Search",
  description:
    "Search Google Contacts by name, email, or phone number. " +
    "Returns matching contacts with names, emails, phone numbers, and organizations.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
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

export const googleContactsList: ToolDefinition = {
  slug: "google-contacts-list",
  name: "Contacts List",
  description: "List Google Contacts, sorted by most recently modified. Returns names, emails, phones, and organizations.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
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

// ─── Tasks Tools ────────────────────────────────────────────────────────────

export const googleTasksLists: ToolDefinition = {
  slug: "google-tasks-lists",
  name: "Tasks Lists",
  description: "List all Google Tasks lists. Returns list names and IDs. Use the ID to query tasks within a list.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(_args, ctx) {
    const token = getToken(ctx);
    return listTaskLists(token);
  },
};

export const googleTasksList: ToolDefinition = {
  slug: "google-tasks-list",
  name: "Tasks List",
  description:
    "List tasks in a Google Tasks list. Defaults to the primary task list (@default). " +
    "Shows title, status (completed/pending), due date, and notes.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskListId: { type: "string", description: "Task list ID (default: '@default' for primary list)" },
      showCompleted: { type: "boolean", description: "Include completed tasks (default: false)" },
      maxResults: { type: "number", description: "Max tasks to return (1-100, default 20)" },
    },
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return listTasks(
      token,
      (args["taskListId"] as string) ?? "@default",
      (args["showCompleted"] as boolean) ?? false,
      (args["maxResults"] as number) ?? 20,
    );
  },
};

export const googleTasksCreate: ToolDefinition = {
  slug: "google-tasks-create",
  name: "Tasks Create",
  description: "Create a new task in a Google Tasks list. Optionally set notes and due date.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Task title" },
      taskListId: { type: "string", description: "Task list ID (default: '@default' for primary list)" },
      notes: { type: "string", description: "Task notes/description" },
      due: { type: "string", description: "Due date (YYYY-MM-DD format)" },
    },
    required: ["title"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createTask(
      token,
      (args["taskListId"] as string) ?? "@default",
      args["title"] as string,
      args["notes"] as string | undefined,
      args["due"] as string | undefined,
    );
  },
};

export const googleTasksUpdate: ToolDefinition = {
  slug: "google-tasks-update",
  name: "Tasks Update",
  description: "Mark a Google Task as completed or uncompleted. Use google-tasks-list to find task IDs.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID (from google-tasks-list results)" },
      taskListId: { type: "string", description: "Task list ID (default: '@default')" },
      completed: { type: "boolean", description: "true to mark completed, false to mark uncompleted" },
    },
    required: ["taskId", "completed"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return updateTaskStatus(
      token,
      (args["taskListId"] as string) ?? "@default",
      args["taskId"] as string,
      args["completed"] as boolean,
    );
  },
};

export const googleTasksDelete: ToolDefinition = {
  slug: "google-tasks-delete",
  name: "Tasks Delete",
  description: "Delete a task from a Google Tasks list. Use google-tasks-list to find task IDs.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Task ID to delete" },
      taskListId: { type: "string", description: "Task list ID (default: '@default')" },
    },
    required: ["taskId"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return deleteTask(
      token,
      (args["taskListId"] as string) ?? "@default",
      args["taskId"] as string,
    );
  },
};

// ─── Drive Tools ────────────────────────────────────────────────────────────

export const googleDriveRead: ToolDefinition = {
  slug: "google-drive-read",
  name: "Drive Read",
  description:
    "Read a Google Drive file by URL or ID. Supports Google Sheets (exported as CSV), " +
    "Google Docs (exported as text), images, and text files. " +
    "Use this to read Google Sheets/Docs links found in emails.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      fileUrl: { type: "string", description: "Google Drive/Sheets/Docs URL or file ID" },
    },
    required: ["fileUrl"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const result = await readDriveFile(token, args["fileUrl"] as string);
    if (result.dataUrl) {
      const base64 = result.dataUrl.replace(/^data:[^;]+;base64,/, "");
      const fileName = (args["fileUrl"] as string).split("/").pop() ?? "file";
      return encodeAttachment(fileName, result.mime, base64);
    }
    return result.text;
  },
};

export const googleDriveSearch: ToolDefinition = {
  slug: "google-drive-search",
  name: "Drive Search",
  description:
    "Search files in Google Drive by name or content. Returns file names, types, and IDs. " +
    "Use google-drive-read with the file ID to read the file contents.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
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
    return searchDriveFiles(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};
