/**
 * Microsoft To Do Tasks API helpers (via Microsoft Graph).
 */

import { microsoftFetch } from "./oauth.js";

const BASE = "https://graph.microsoft.com/v1.0/me/todo";

interface TaskList {
  id: string;
  displayName: string;
  isOwner?: boolean;
  isShared?: boolean;
  wellknownListName?: string;
}

interface TodoTask {
  id: string;
  title: string;
  body?: { content: string; contentType: string };
  status: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  importance: "low" | "normal" | "high";
  dueDateTime?: { dateTime: string; timeZone: string };
  completedDateTime?: { dateTime: string; timeZone: string };
  createdDateTime: string;
  lastModifiedDateTime: string;
}

function validateId(id: string, name: string) {
  if (!id || id.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function formatTask(t: TodoTask): string {
  const statusIcon = t.status === "completed" ? "[x]" : t.status === "inProgress" ? "[~]" : "[ ]";
  const parts = [`${statusIcon} ${t.title}`];
  if (t.body?.content) {
    const body = t.body.content.replace(/<[^>]+>/g, "").trim();
    if (body) parts.push(`  Notes: ${body}`);
  }
  if (t.dueDateTime) parts.push(`  Due: ${t.dueDateTime.dateTime.split("T")[0]}`);
  if (t.completedDateTime) parts.push(`  Completed: ${t.completedDateTime.dateTime.split("T")[0]}`);
  if (t.importance !== "normal") parts.push(`  Importance: ${t.importance}`);
  parts.push(`  ID: ${t.id}`);
  return parts.join("\n");
}

/** List all To Do task lists. */
export async function listTaskLists(token: string): Promise<string> {
  const result = (await microsoftFetch(
    `${BASE}/lists`,
    token,
  )) as { value: TaskList[] };

  const lists = result.value ?? [];
  if (lists.length === 0) return "No task lists found.";

  const lines = lists.map((l) => {
    const extra = l.wellknownListName === "defaultList" ? " (default)" : "";
    return `- ${l.displayName}${extra} (ID: ${l.id})`;
  });
  return `Task lists:\n${lines.join("\n")}`;
}

/** List tasks in a To Do task list. */
export async function listTasks(
  token: string,
  taskListId: string,
  showCompleted: boolean,
  maxResults: number,
): Promise<string> {
  validateId(taskListId, "taskListId");
  let query = `$top=${maxResults}&$orderby=${encodeURIComponent("createdDateTime desc")}`;
  if (!showCompleted) {
    query += `&$filter=${encodeURIComponent("status ne 'completed'")}`;
  }

  const result = (await microsoftFetch(
    `${BASE}/lists/${encodeURIComponent(taskListId)}/tasks?${query}`,
    token,
  )) as { value: TodoTask[] };

  const tasks = result.value ?? [];
  if (tasks.length === 0) return "No tasks found.";

  const lines = tasks.map((t) => formatTask(t));
  return `${tasks.length} task(s):\n\n${lines.join("\n\n")}`;
}

/** Create a new task in a To Do list. */
export async function createTask(
  token: string,
  taskListId: string,
  title: string,
  notes?: string,
  dueDate?: string,
  importance?: string,
): Promise<string> {
  validateId(taskListId, "taskListId");
  const body: Record<string, unknown> = { title };
  if (notes) body["body"] = { content: notes, contentType: "text" };
  if (dueDate) {
    body["dueDateTime"] = { dateTime: `${dueDate}T00:00:00`, timeZone: "Asia/Kolkata" };
  }
  if (importance && ["low", "normal", "high"].includes(importance)) {
    body["importance"] = importance;
  }

  const task = (await microsoftFetch(
    `${BASE}/lists/${encodeURIComponent(taskListId)}/tasks`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  )) as TodoTask;

  return `Task created:\n${formatTask(task)}`;
}

/** Update a task status (complete/uncomplete). */
export async function updateTaskStatus(
  token: string,
  taskListId: string,
  taskId: string,
  completed: boolean,
): Promise<string> {
  validateId(taskListId, "taskListId");
  validateId(taskId, "taskId");
  const body = completed
    ? { status: "completed" }
    : { status: "notStarted" };

  const task = (await microsoftFetch(
    `${BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    { method: "PATCH", body: JSON.stringify(body) },
  )) as TodoTask;

  return `Task updated:\n${formatTask(task)}`;
}

/** Delete a task from a To Do list. */
export async function deleteTask(
  token: string,
  taskListId: string,
  taskId: string,
): Promise<string> {
  validateId(taskListId, "taskListId");
  validateId(taskId, "taskId");
  await microsoftFetch(
    `${BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    { method: "DELETE" },
  );
  return `Task ${taskId} deleted.`;
}
