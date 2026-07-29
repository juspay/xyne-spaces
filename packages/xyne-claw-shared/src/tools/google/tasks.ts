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

/** A task's external reference (e.g. the Gmail message it was created from). */
interface TaskLink {
  type?: string;
  description?: string;
  link?: string;
}

interface Task {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated: string;
  // "parent" is present on child tasks: the id of the task they nest under.
  // Without honoring it, subtasks masquerade as top-level tasks.
  parent?: string;
  // "position" is Google's canonical ordering key — a fixed-width string that
  // sorts lexicographically. Item order is otherwise not guaranteed.
  position?: string;
  // "links" surfaces the task's source (e.g. the originating email) so
  // "where did this task come from?" is answerable.
  links?: TaskLink[];
}

interface TasksResponse {
  items?: Task[];
  // "nextPageToken" signals that more tasks exist beyond the returned page;
  // the count line must not present the page size as the full total.
  nextPageToken?: string;
}

function formatTask(t: Task, depth = 0): string {
  const status = t.status === "completed" ? "[x]" : "[ ]";
  const parts = [`${status} ${t.title}`];
  if (t.notes) parts.push(`  Notes: ${t.notes}`);
  if (t.due) parts.push(`  Due: ${t.due.split("T")[0]}`);
  if (t.completed) parts.push(`  Completed: ${t.completed.split("T")[0]}`);
  // "updated" is parsed by the API but was previously never printed — surface
  // the last-modified date so staleness/recency is answerable.
  if (t.updated) parts.push(`  Updated: ${t.updated.split("T")[0]}`);
  // "links" preserves the task's source (e.g. the source email) — previously dropped.
  if (t.links && t.links.length > 0) {
    for (const l of t.links) {
      const label = l.description || l.type || "link";
      parts.push(`  Link: ${label}${l.link ? ` (${l.link})` : ""}`);
    }
  }
  parts.push(`  ID: ${t.id}`);
  // Indent every line by depth so subtasks render nested under their parent.
  const pad = "  ".repeat(depth);
  return parts.map((line) => pad + line).join("\n");
}

/** Sort by Google's canonical "position" key; tasks lacking it keep insertion order. */
function byPosition(a: Task, b: Task): number {
  if (a.position != null && b.position != null) {
    return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  }
  if (a.position != null) return -1;
  if (b.position != null) return 1;
  return 0;
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

  // The API returns a FLAT list; child tasks carry a "parent" id. Rebuild the
  // parent->child tree so subtasks render indented under their parent instead
  // of appearing as top-level tasks.
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const childrenOf = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    // Only nest under a parent that is actually in this page; an orphaned child
    // (parent filtered out / on another page) falls back to top-level.
    if (t.parent && byId.has(t.parent)) {
      const siblings = childrenOf.get(t.parent) ?? [];
      siblings.push(t);
      childrenOf.set(t.parent, siblings);
    } else {
      roots.push(t);
    }
  }

  // Order top-level tasks and each sibling group by "position".
  roots.sort(byPosition);
  for (const siblings of childrenOf.values()) siblings.sort(byPosition);

  const rendered: string[] = [];
  const walk = (t: Task, depth: number): void => {
    rendered.push(formatTask(t, depth));
    for (const child of childrenOf.get(t.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  // Be honest: a nextPageToken means more tasks exist beyond this page, so the
  // returned count is NOT the total.
  const header = data.nextPageToken
    ? `${tasks.length} task(s) (more available beyond this page — increase maxResults or paginate):`
    : `${tasks.length} task(s):`;
  return `${header}\n\n${rendered.join("\n\n")}`;
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
