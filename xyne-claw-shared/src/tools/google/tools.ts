/**
 * Google tool definitions for the xyne-claw custom tool system.
 * All tools use source "custom:google" and require a Google OAuth access token
 * resolved via ctx.config["GOOGLE_ACCESS_TOKEN"].
 */

import type { ToolDefinition, ToolExecutionContext, ConfigField } from "../types.js";
import {
  searchEmails,
  readEmail,
  createDraft,
  getAttachment,
  trashEmails,
  batchMarkEmailsRead,
  archiveEmails,
  starEmails,
  markEmailsSpam,
  untrashEmails,
  modifyEmailLabels,
  listLabels,
} from "./gmail.js";
import { searchEvents, createEvent, deleteEvent, listCalendars } from "./calendar.js";
import { searchContacts, listContacts } from "./contacts.js";
import { listTaskLists, listTasks, createTask, updateTaskStatus, deleteTask } from "./tasks.js";
import {
  readDriveFile,
  searchDriveFiles,
  createDriveFolder,
  uploadDriveFile,
  shareDriveFile,
} from "./drive.js";
import { createSpreadsheetWithValues, updateValues, appendValues } from "./sheets.js";
import { createDocument, appendToDocument, readDocument, replaceAllText, insertTextAt, deleteRange, replaceRange, updateTextStyle, updateParagraphStyle } from "./docs.js";
import { type TextStyleUpdate, type ParagraphStyleUpdate } from "./docs.js";
import { createPresentation, addSlide } from "./slides.js";
import {
  createForm,
  addQuestionsToForm,
  getForm,
  type FormQuestion,
  type FormQuestionType,
} from "./forms.js";

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
    return (await this.executeCited!(args, ctx)).text;
  },
  async executeCited(args, ctx) {
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
    return (await this.executeCited!(args, ctx)).text;
  },
  async executeCited(args, ctx) {
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
    "Move one or more emails to trash. Only use this for emails the user explicitly asks to delete.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to move to trash (one or more)",
      },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return trashEmails(token, args["messageIds"] as string[]);
  },
};

export const googleGmailMarkRead: ToolDefinition = {
  slug: "google-gmail-mark-read",
  name: "Gmail Mark Read",
  description:
    "Mark one or more Gmail messages as read or unread in a single call. " +
    "Defaults to marking as read. Use google-gmail-search first to find message IDs.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to update (one or more, max 1000)",
      },
      read: { type: "boolean", description: "true to mark as read (default), false to mark as unread" },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return batchMarkEmailsRead(
      token,
      args["messageIds"] as string[],
      (args["read"] as boolean | undefined) ?? true,
    );
  },
};

export const googleGmailArchive: ToolDefinition = {
  slug: "google-gmail-archive",
  name: "Gmail Archive",
  description:
    "Archive one or more emails by removing them from the inbox (removes the INBOX label). Emails stay searchable.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to archive (one or more)",
      },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return archiveEmails(token, args["messageIds"] as string[]);
  },
};

export const googleGmailStar: ToolDefinition = {
  slug: "google-gmail-star",
  name: "Gmail Star",
  description: "Star or unstar one or more emails in a single call. Defaults to starring. Pass multiple IDs to bulk star/unstar.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to star/unstar (one or more)",
      },
      starred: { type: "boolean", description: "true to star (default), false to unstar" },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return starEmails(token, args["messageIds"] as string[], (args["starred"] as boolean | undefined) ?? true);
  },
};

export const googleGmailSpam: ToolDefinition = {
  slug: "google-gmail-spam",
  name: "Gmail Mark Spam",
  description:
    "Mark one or more emails as spam (moves to Spam) or not spam (moves back to inbox). Defaults to marking as spam.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to update (one or more)",
      },
      spam: { type: "boolean", description: "true to mark as spam (default), false to mark as not spam" },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return markEmailsSpam(token, args["messageIds"] as string[], (args["spam"] as boolean | undefined) ?? true);
  },
};

export const googleGmailUntrash: ToolDefinition = {
  slug: "google-gmail-untrash",
  name: "Gmail Untrash",
  description: "Restore one or more emails from trash back to the inbox. Pairs with google-gmail-trash.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to restore from trash (one or more)",
      },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return untrashEmails(token, args["messageIds"] as string[]);
  },
};

export const googleGmailLabelsList: ToolDefinition = {
  slug: "google-gmail-labels-list",
  name: "Gmail Labels List",
  description:
    "List all Gmail labels (system and user) with their IDs. Call this first to resolve label names to IDs before using google-gmail-modify-labels.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const token = getToken(ctx);
    return listLabels(token);
  },
};

export const googleGmailModifyLabels: ToolDefinition = {
  slug: "google-gmail-modify-labels",
  name: "Gmail Modify Labels",
  description:
    "Add and/or remove labels on one or more emails in a single call. Labels are referenced by label ID — use google-gmail-labels-list first to resolve names to IDs.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      messageIds: {
        type: "array",
        items: { type: "string" },
        description: "Gmail message IDs to update (one or more)",
      },
      addLabelIds: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs to add",
      },
      removeLabelIds: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs to remove",
      },
    },
    required: ["messageIds"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return modifyEmailLabels(
      token,
      args["messageIds"] as string[],
      (args["addLabelIds"] as string[] | undefined) ?? [],
      (args["removeLabelIds"] as string[] | undefined) ?? [],
    );
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
    return (await this.executeCited!(args, ctx)).text;
  },
  async executeCited(args, ctx) {
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
      fileUrl: { type: "string", description: "Google Drive/Sheets/Docs URL or file ID. For Sheets, the #gid= in the URL selects the tab automatically." },
      tab: { type: "string", description: "Optional. Target a specific spreadsheet tab by its title (case-insensitive). Overrides the URL gid if both are given." },
      gid: { type: "string", description: "Optional. Target a specific spreadsheet tab by its gid (numeric). Usually inferred from the URL." },
      range: { type: "string", description: "Optional A1 range within the targeted tab, e.g. \"A1:Z\" or \"A500:Z1000\" to read recent/bottom rows." },
      maxRows: { type: "number", description: "Optional. Max rows to return per tab before windowing (default 5000)." },
    },
    required: ["fileUrl"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const result = await readDriveFile(token, args["fileUrl"] as string, {
      tab: args["tab"] as string | undefined,
      gid: args["gid"] as string | undefined,
      range: args["range"] as string | undefined,
      maxRows: args["maxRows"] as number | undefined,
    });
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
    return (await this.executeCited!(args, ctx)).text;
  },
  async executeCited(args, ctx) {
    const token = getToken(ctx);
    return searchDriveFiles(token, args["query"] as string, (args["maxResults"] as number) ?? 10);
  },
};

export const googleDriveCreateFolder: ToolDefinition = {
  slug: "google-drive-create-folder",
  name: "Drive Create Folder",
  description:
    "Create a folder in Google Drive. Optionally provide parentFolderId to nest inside an existing folder. " +
    "Returns folder ID and shareable URL.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Folder name" },
      parentFolderId: { type: "string", description: "Optional Drive folder ID to create inside" },
    },
    required: ["name"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return createDriveFolder(token, args["name"] as string, args["parentFolderId"] as string | undefined);
  },
};

export const googleDriveUpload: ToolDefinition = {
  slug: "google-drive-upload",
  name: "Drive Upload File",
  description:
    "Upload a text/CSV/JSON/Markdown file to Google Drive. Provide content as a string. " +
    "For binary files, use base64 with mimeType prefixed accordingly is NOT supported here — use a text mimeType.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "File name including extension" },
      content: { type: "string", description: "File content as UTF-8 text" },
      mimeType: {
        type: "string",
        description: "MIME type, e.g. text/plain, text/csv, application/json, text/markdown",
      },
      parentFolderId: { type: "string", description: "Optional Drive folder ID to upload into" },
    },
    required: ["name", "content", "mimeType"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return uploadDriveFile(
      token,
      args["name"] as string,
      args["content"] as string,
      args["mimeType"] as string,
      args["parentFolderId"] as string | undefined,
    );
  },
};

export const googleDriveShare: ToolDefinition = {
  slug: "google-drive-share",
  name: "Drive Share File",
  description:
    "Share a Drive file/folder. role=reader|commenter|writer; type=user|group|domain|anyone. " +
    "Provide emailAddress when type is user/group.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      fileId: { type: "string", description: "Drive file or folder ID" },
      role: { type: "string", description: "reader | commenter | writer" },
      type: { type: "string", description: "user | group | domain | anyone" },
      emailAddress: { type: "string", description: "Required when type=user|group" },
    },
    required: ["fileId", "role", "type"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    return shareDriveFile(
      token,
      args["fileId"] as string,
      args["role"] as "reader" | "commenter" | "writer",
      args["type"] as "user" | "group" | "domain" | "anyone",
      args["emailAddress"] as string | undefined,
    );
  },
};

// ─── Sheets Write Tools ─────────────────────────────────────────────────────

export const googleSheetsCreate: ToolDefinition = {
  slug: "google-sheets-create",
  name: "Sheets Create",
  description:
    "Create a new Google Spreadsheet with the given title. Optionally include initial rows in values " +
    "to populate the sheet in the same approved action. Returns spreadsheet ID and URL.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Spreadsheet title" },
      range: { type: "string", description: "Optional A1 range for initial values, default Sheet1!A1" },
      values: {
        type: "array",
        description: "Optional initial rows to write after creating the spreadsheet",
        items: { type: "array", items: { type: "string" } },
      },
    },
    required: ["title"],
  },
  async execute(args, ctx) {
    return createSpreadsheetWithValues(
      getToken(ctx),
      args["title"] as string,
      args["values"] as string[][] | undefined,
      (args["range"] as string | undefined) ?? "Sheet1!A1",
    );
  },
};

export const googleSheetsUpdate: ToolDefinition = {
  slug: "google-sheets-update",
  name: "Sheets Update",
  description:
    "Write rows of values to a sheet range (overwrites). Range is A1 notation, e.g. 'Sheet1!A1'. " +
    "values is a 2D array of strings/numbers as strings.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      spreadsheetId: { type: "string", description: "Spreadsheet ID" },
      range: { type: "string", description: "A1 range, e.g. 'Sheet1!A1'" },
      values: {
        type: "array",
        description: "2D array of cell values (rows of strings)",
        items: { type: "array", items: { type: "string" } },
      },
    },
    required: ["spreadsheetId", "range", "values"],
  },
  async execute(args, ctx) {
    return updateValues(
      getToken(ctx),
      args["spreadsheetId"] as string,
      args["range"] as string,
      args["values"] as string[][],
    );
  },
};

export const googleSheetsAppend: ToolDefinition = {
  slug: "google-sheets-append",
  name: "Sheets Append",
  description:
    "Append rows after the last row in a sheet range. Range is A1 notation. " +
    "values is a 2D array of strings.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      spreadsheetId: { type: "string", description: "Spreadsheet ID" },
      range: { type: "string", description: "A1 range, e.g. 'Sheet1!A1'" },
      values: {
        type: "array",
        description: "2D array of rows to append",
        items: { type: "array", items: { type: "string" } },
      },
    },
    required: ["spreadsheetId", "range", "values"],
  },
  async execute(args, ctx) {
    return appendValues(
      getToken(ctx),
      args["spreadsheetId"] as string,
      args["range"] as string,
      args["values"] as string[][],
    );
  },
};

// ─── Docs Tools ─────────────────────────────────────────────────────────────

export const googleDocsCreate: ToolDefinition = {
  slug: "google-docs-create",
  name: "Docs Create",
  description: "Create a new Google Doc with title and optional body text. Returns document ID and URL.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Document title" },
      body: { type: "string", description: "Optional initial body text" },
    },
    required: ["title"],
  },
  async execute(args, ctx) {
    return createDocument(getToken(ctx), args["title"] as string, args["body"] as string | undefined);
  },
};

export const googleDocsAppend: ToolDefinition = {
  slug: "google-docs-append",
  name: "Docs Append",
  description: "Append text to the end of an existing Google Doc. Preserves existing content.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "Google Doc document ID" },
      text: { type: "string", description: "Text to append" },
    },
    required: ["documentId", "text"],
  },
  async execute(args, ctx) {
    return appendToDocument(getToken(ctx), args["documentId"] as string, args["text"] as string);
  },
};

export const googleDocsRead: ToolDefinition = {
  slug: "google-docs-read",
  name: "Docs Read",
  description:
    "Read a Google Doc's content with index positions and formatting info. " +
    "Returns text runs with [startIndex-endIndex] ranges. " +
    "Use this BEFORE google-docs-edit or google-docs-format to discover the correct index positions for your edits.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "Google Doc document ID" },
    },
    required: ["documentId"],
  },
  async execute(args, ctx) {
    return readDocument(getToken(ctx), args["documentId"] as string);
  },
};

export const googleDocsEdit: ToolDefinition = {
  slug: "google-docs-edit",
  name: "Docs Edit",
  description:
    "Edit text in an existing Google Doc. Supports three modes: " +
    "'find_replace' — replace all occurrences of a text string (no indices needed); " +
    "'insert' — insert text at a specific index position; " +
    "'delete' — delete text between two index positions; " +
    "'replace_range' — replace text at a specific index range (delete + insert atomically). " +
    "Use google-docs-read first to discover index positions for insert/delete/replace_range modes.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "Google Doc document ID" },
      mode: {
        type: "string",
        enum: ["find_replace", "insert", "delete", "replace_range"],
        description:
          "Edit mode: 'find_replace' (replace all matching text), 'insert' (insert at index), " +
          "'delete' (delete a range), 'replace_range' (replace text at a range atomically)",
      },
      // find_replace params
      findText: { type: "string", description: "Text to find (for find_replace mode)" },
      replaceText: { type: "string", description: "Replacement text (for find_replace and replace_range modes)" },
      matchCase: { type: "boolean", description: "Case-sensitive match (for find_replace mode, default: true)" },
      // insert/delete/replace_range params
      startIndex: { type: "number", description: "Start index position (for insert, delete, replace_range modes)" },
      endIndex: { type: "number", description: "End index position (for delete and replace_range modes)" },
      // insert/replace_range params
      text: { type: "string", description: "Text to insert (for insert and replace_range modes)" },
    },
    required: ["documentId", "mode"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const documentId = args["documentId"] as string;
    const mode = args["mode"] as string;

    switch (mode) {
      case "find_replace":
        if (!args["findText"]) throw new Error("findText is required for find_replace mode");
        return replaceAllText(
          token,
          documentId,
          args["findText"] as string,
          (args["replaceText"] as string) ?? "",
          (args["matchCase"] as boolean) ?? true,
        );

      case "insert":
        if (args["startIndex"] == null) throw new Error("startIndex is required for insert mode");
        if (!args["text"]) throw new Error("text is required for insert mode");
        return insertTextAt(
          token,
          documentId,
          args["startIndex"] as number,
          args["text"] as string,
        );

      case "delete":
        if (args["startIndex"] == null) throw new Error("startIndex is required for delete mode");
        if (args["endIndex"] == null) throw new Error("endIndex is required for delete mode");
        return deleteRange(
          token,
          documentId,
          args["startIndex"] as number,
          args["endIndex"] as number,
        );

      case "replace_range":
        if (args["startIndex"] == null) throw new Error("startIndex is required for replace_range mode");
        if (args["endIndex"] == null) throw new Error("endIndex is required for replace_range mode");
        if (!args["text"]) throw new Error("text is required for replace_range mode");
        return replaceRange(
          token,
          documentId,
          args["startIndex"] as number,
          args["endIndex"] as number,
          args["text"] as string,
        );

      default:
        throw new Error(`Unknown mode: ${mode}. Use find_replace, insert, delete, or replace_range.`);
    }
  },
};


// tool for format the text and paragraph
export const googleDocsFormat: ToolDefinition = {
  slug: "google-docs-format",
  name: "Docs Format",
  description:
    "Apply text or paragraph formatting to a range in a Google Doc. " +
    "Supports bold, italic, underline, strikethrough, font family, font size, text color, " +
    "heading styles (HEADING_1-6, NORMAL_TEXT), alignment (START, CENTER, END, JUSTIFIED), and spacing. " +
    "Use google-docs-read first to discover the correct index positions. " +
    "Formatting does NOT shift indices, so multiple formatting operations on different ranges are safe.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "Google Doc document ID" },
      startIndex: { type: "number", description: "Start index of the range to format" },
      endIndex: { type: "number", description: "End index of the range to format" },
      // Text style properties
      bold: { type: "boolean", description: "Set bold formatting" },
      italic: { type: "boolean", description: "Set italic formatting" },
      underline: { type: "boolean", description: "Set underline formatting" },
      strikethrough: { type: "boolean", description: "Set strikethrough formatting" },
      fontFamily: { type: "string", description: "Font family (e.g. 'Arial', 'Courier New')" },
      fontSize: { type: "number", description: "Font size in points (e.g. 12, 14, 18)" },
      // Paragraph style properties
      namedStyle: {
        type: "string",
        description: "Heading style: NORMAL_TEXT, HEADING_1, HEADING_2, HEADING_3, HEADING_4, HEADING_5, HEADING_6, TITLE, SUBTITLE",
      },
      alignment: {
        type: "string",
        description: "Paragraph alignment: START, CENTER, END, JUSTIFIED",
      },
      foregroundColor: {
        type: "object",
        description: "Text color as RGB floats (0.0-1.0). e.g. {\"red\": 1.0, \"green\": 0.0, \"blue\": 0.0} for red",
        properties: {
          red: { type: "number" },
          green: { type: "number" },
          blue: { type: "number" },
        },
      },
    },
    required: ["documentId", "startIndex", "endIndex"],
  },
  async execute(args, ctx) {
    const token = getToken(ctx);
    const documentId = args["documentId"] as string;
    const startIndex = args["startIndex"] as number;
    const endIndex = args["endIndex"] as number;

    // Collect text style properties
    const hasTextStyle =
      args["bold"] !== undefined ||
      args["italic"] !== undefined ||
      args["underline"] !== undefined ||
      args["strikethrough"] !== undefined ||
      args["fontFamily"] !== undefined ||
      args["fontSize"] !== undefined ||
      args["foregroundColor"] !== undefined;

    // Collect paragraph style properties
    const hasParagraphStyle =
      args["namedStyle"] !== undefined ||
      args["alignment"] !== undefined;

    if (!hasTextStyle && !hasParagraphStyle) {
      throw new Error("At least one formatting property must be specified");
    }

    const results: string[] = [];

    if (hasTextStyle) {
      const style: TextStyleUpdate = {};
      if (args["bold"] !== undefined) style.bold = args["bold"] as boolean;
      if (args["italic"] !== undefined) style.italic = args["italic"] as boolean;
      if (args["underline"] !== undefined) style.underline = args["underline"] as boolean;
      if (args["strikethrough"] !== undefined) style.strikethrough = args["strikethrough"] as boolean;
      if (args["fontFamily"] !== undefined) style.fontFamily = args["fontFamily"] as string;
      if (args["fontSize"] !== undefined) style.fontSize = args["fontSize"] as number;
      if (args["foregroundColor"] !== undefined) style.foregroundColor = args["foregroundColor"] as { red?: number; green?: number; blue?: number };

      results.push(await updateTextStyle(token, documentId, startIndex, endIndex, style));
    }

    if (hasParagraphStyle) {
      const style: ParagraphStyleUpdate = {};
      if (args["namedStyle"] !== undefined) style.namedStyleType = args["namedStyle"] as string;
      if (args["alignment"] !== undefined) style.alignment = args["alignment"] as string;

      results.push(await updateParagraphStyle(token, documentId, startIndex, endIndex, style));
    }

    return results.join("\n");
  },
};

// ─── Slides Tools ───────────────────────────────────────────────────────────

export const googleSlidesCreate: ToolDefinition = {
  slug: "google-slides-create",
  name: "Slides Create",
  description: "Create a new Google Slides presentation with the given title. Returns presentation ID and URL.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: { title: { type: "string", description: "Presentation title" } },
    required: ["title"],
  },
  async execute(args, ctx) {
    return createPresentation(getToken(ctx), args["title"] as string);
  },
};

export const googleSlidesAddSlide: ToolDefinition = {
  slug: "google-slides-add-slide",
  name: "Slides Add Slide",
  description:
    "Add a new slide to an existing presentation. layout is BLANK | TITLE | TITLE_AND_BODY (default). " +
    "Provide title and body text where applicable.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      presentationId: { type: "string", description: "Slides presentation ID" },
      layout: { type: "string", description: "BLANK | TITLE | TITLE_AND_BODY (default TITLE_AND_BODY)" },
      title: { type: "string", description: "Slide title text" },
      body: { type: "string", description: "Slide body text" },
    },
    required: ["presentationId"],
  },
  async execute(args, ctx) {
    return addSlide(
      getToken(ctx),
      args["presentationId"] as string,
      (args["layout"] as "BLANK" | "TITLE" | "TITLE_AND_BODY" | undefined) ?? "TITLE_AND_BODY",
      args["title"] as string | undefined,
      args["body"] as string | undefined,
    );
  },
};

// ─── Forms Tools ────────────────────────────────────────────────────────────

const FORM_QUESTION_SCHEMA = {
  type: "array",
  description:
    "Form questions. Each item: { title: string, type: 'SHORT_ANSWER'|'PARAGRAPH'|'EMAIL'|'DROPDOWN'|'MULTIPLE_CHOICE'|'CHECKBOX', required?: boolean, options?: string[] }",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      type: { type: "string" },
      required: { type: "boolean" },
      options: { type: "array", items: { type: "string" } },
    },
    required: ["title", "type"],
  },
} as const;

function normalizeQuestions(raw: unknown): FormQuestion[] {
  if (!Array.isArray(raw)) return [];
  const allowed: FormQuestionType[] = ["SHORT_ANSWER", "PARAGRAPH", "EMAIL", "DROPDOWN", "MULTIPLE_CHOICE", "CHECKBOX"];
  return raw.map((q) => {
    const r = q as Record<string, unknown>;
    const type = (r["type"] as FormQuestionType) ?? "SHORT_ANSWER";
    const out: FormQuestion = {
      title: String(r["title"] ?? "Untitled"),
      type: allowed.includes(type) ? type : "SHORT_ANSWER",
      required: Boolean(r["required"] ?? false),
    };
    if (Array.isArray(r["options"])) out.options = r["options"] as string[];
    return out;
  });
}

export const googleFormsCreate: ToolDefinition = {
  slug: "google-forms-create",
  name: "Forms Create",
  description:
    "Create a Google Form with title and optional questions. Returns form ID, edit URL, and responder URL. " +
    "Question types: SHORT_ANSWER, PARAGRAPH, EMAIL, DROPDOWN, MULTIPLE_CHOICE, CHECKBOX.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Form title" },
      questions: FORM_QUESTION_SCHEMA,
    },
    required: ["title"],
  },
  async execute(args, ctx) {
    const questions = normalizeQuestions(args["questions"]);
    return createForm(getToken(ctx), args["title"] as string, questions);
  },
};

export const googleFormsAddQuestions: ToolDefinition = {
  slug: "google-forms-add-questions",
  name: "Forms Add Questions",
  description: "Append questions to an existing Google Form.",
  source: "custom:google",
  isWriteTool: true,
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: {
      formId: { type: "string", description: "Google Form ID" },
      questions: FORM_QUESTION_SCHEMA,
    },
    required: ["formId", "questions"],
  },
  async execute(args, ctx) {
    return addQuestionsToForm(
      getToken(ctx),
      args["formId"] as string,
      normalizeQuestions(args["questions"]),
    );
  },
};

export const googleFormsGet: ToolDefinition = {
  slug: "google-forms-get",
  name: "Forms Get",
  description: "Read a Google Form's title, questions, and responder URL by form ID.",
  source: "custom:google",
  configSchema: GOOGLE_CONFIG_SCHEMA,
  inputSchema: {
    type: "object",
    properties: { formId: { type: "string", description: "Google Form ID" } },
    required: ["formId"],
  },
  async execute(args, ctx) {
    return getForm(getToken(ctx), args["formId"] as string);
  },
};
