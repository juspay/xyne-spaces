/**
 * Google Tasks API helpers.
 */

import { googleFetch } from "./oauth.js";

interface TaskList {
  id: string;
  title: string;
}

interface TaskListsResponse {
  items?: TaskList[];
}

interface Task {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated: string;
  parent?: string;
}

interface TasksResponse {
  items?: Task[];
}

function formatTask(t: Task): string {
  const status = t.status === "completed" ? "[x]" : "[ ]";
  const parts = [`${status} ${t.title}`];
  if (t.notes) parts.push(`  Notes: ${t.notes}`);
  if (t.due) parts.push(`  Due: ${t.due.split("T")[0]}`);
  if (t.completed) parts.push(`  Completed: ${t.completed.split("T")[0]}`);
  parts.push(`  ID: ${t.id}`);
  return parts.join("\n");
}

/** List all task lists. */
export async function listTaskLists(token: string): Promise<string> {
  const data = (await googleFetch(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
    token,
  )) as TaskListsResponse;

  const lists = data.items ?? [];
  if (lists.length === 0) return "No task lists found.";

  const lines = lists.map((l) => `- ${l.title} (ID: ${l.id})`);
  return `Task lists:\n${lines.join("\n")}`;
}

/** List tasks in a task list. */
export async function listTasks(
  token: string,
  taskListId: string,
  showCompleted: boolean,
  maxResults: number,
): Promise<string> {
  const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("showCompleted", String(showCompleted));
  url.searchParams.set("showHidden", String(showCompleted));

  const data = (await googleFetch(url.toString(), token)) as TasksResponse;
  const tasks = data.items ?? [];

  if (tasks.length === 0) return "No tasks found.";

  const lines = tasks.map((t) => formatTask(t));
  return `${tasks.length} task(s):\n\n${lines.join("\n\n")}`;
}

/** Create a new task. */
export async function createTask(
  token: string,
  taskListId: string,
  title: string,
  notes?: string,
  due?: string,
): Promise<string> {
  const body: Record<string, string> = { title };
  if (notes) body["notes"] = notes;
  if (due) body["due"] = new Date(due).toISOString();

  const task = (await googleFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  )) as Task;

  return `Task created:\n${formatTask(task)}`;
}

/** Mark a task as completed or uncompleted. */
export async function updateTaskStatus(
  token: string,
  taskListId: string,
  taskId: string,
  completed: boolean,
): Promise<string> {
  const body = completed
    ? { status: "completed" }
    : { status: "needsAction", completed: null };

  const task = (await googleFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    { method: "PATCH", body: JSON.stringify(body) },
  )) as Task;

  return `Task updated:\n${formatTask(task)}`;
}

/** Delete a task. */
export async function deleteTask(
  token: string,
  taskListId: string,
  taskId: string,
): Promise<string> {
  await googleFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    token,
    { method: "DELETE" },
  );
  return `Task ${taskId} deleted.`;
}
