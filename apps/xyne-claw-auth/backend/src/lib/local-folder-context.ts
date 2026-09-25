export const LOCAL_FOLDER_CONTEXT_TYPE = "local-folder";

export interface LocalFolderContextItem {
  type: typeof LOCAL_FOLDER_CONTEXT_TYPE;
  id: string;
  title: string;
  metadata?: { path: string; branch?: string; remote?: string };
}

export interface LocalFolderWorkspace {
  path: string;
  name: string;
  branch?: string;
}

export function isLocalFolderContextItem(value: unknown): value is LocalFolderContextItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item["type"] !== LOCAL_FOLDER_CONTEXT_TYPE) return false;
  const id = item["id"];
  return typeof id === "string" && id.trim().length > 0;
}

export function splitLocalFolderContext(input: unknown): {
  localFolders: LocalFolderContextItem[];
  rest: unknown[];
} {
  if (!Array.isArray(input)) return { localFolders: [], rest: [] };
  const localFolders: LocalFolderContextItem[] = [];
  const rest: unknown[] = [];
  for (const entry of input) {
    if (isLocalFolderContextItem(entry)) localFolders.push(entry);
    else rest.push(entry);
  }
  return { localFolders, rest };
}

export function toLocalFolderWorkspace(item: LocalFolderContextItem): LocalFolderWorkspace | null {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : undefined;
  const path = (typeof metadata?.path === "string" && metadata.path.trim() ? metadata.path : item.id).trim();
  if (!path) return null;
  const name = typeof item.title === "string" && item.title.trim()
    ? item.title.trim()
    : path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const branch = typeof metadata?.branch === "string" && metadata.branch.trim() ? metadata.branch.trim() : undefined;
  return { path, name, ...(branch ? { branch } : {}) };
}

export function localFolderUnavailableMessage(name: string): string {
  return `This conversation is attached to a local folder (${name}), which needs the Xyne desktop app with a paired Codex or Claude CLI online.`;
}
