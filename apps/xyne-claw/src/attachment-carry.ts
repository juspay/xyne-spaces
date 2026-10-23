import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  gcsDownloadObject,
  gcsListConversationAttachments,
  gcsUploadConversationAttachment,
} from "./storage.js";

const MAX_CARRY_FILE_BYTES = 100 * 1024 * 1024;
const MAX_RESTORE_BYTES = 500 * 1024 * 1024;
const MAX_RESTORE_FILES = 200;

export function isCarriedAttachmentPath(relPath: string): boolean {
  const parts = relPath.split("/");
  return parts[0] === ".context" && parts.length >= 2 && !parts.some((p) => !p || p === "." || p === "..");
}

function resolveInside(workspaceDir: string, relPath: string): string | null {
  const root = path.resolve(workspaceDir);
  const dest = path.resolve(root, relPath);
  return dest.startsWith(`${root}${path.sep}`) ? dest : null;
}

export async function saveConversationAttachments(
  conversationKey: string,
  workspaceDir: string,
  relPaths: string[],
  log: (message: string) => void,
): Promise<number> {
  let saved = 0;
  for (const relPath of new Set(relPaths)) {
    if (!isCarriedAttachmentPath(relPath)) continue;
    const abs = resolveInside(workspaceDir, relPath);
    if (!abs || !existsSync(abs)) continue;
    const size = (await stat(abs)).size;
    if (size > MAX_CARRY_FILE_BYTES) {
      log(`Attachment ${relPath} is ${size} bytes; too large to keep for later turns.`);
      continue;
    }
    if (await gcsUploadConversationAttachment(conversationKey, relPath, await readFile(abs))) saved++;
  }
  return saved;
}

export interface RestoredAttachments {
  available: string[];
  restored: string[];
}

export async function restoreConversationAttachments(
  conversationKey: string,
  workspaceDir: string,
  log: (message: string) => void,
): Promise<RestoredAttachments> {
  const listed = await gcsListConversationAttachments(conversationKey);
  if (!listed) {
    log("Earlier attachments could not be listed; continuing without them.");
    return { available: [], restored: [] };
  }
  const available: string[] = [];
  const restored: string[] = [];
  let restoredBytes = 0;
  for (const file of listed) {
    if (!isCarriedAttachmentPath(file.relPath)) continue;
    const abs = resolveInside(workspaceDir, file.relPath);
    if (!abs) continue;
    if (existsSync(abs)) {
      available.push(file.relPath);
      continue;
    }
    if (restored.length >= MAX_RESTORE_FILES || restoredBytes + file.size > MAX_RESTORE_BYTES) continue;
    const data = await gcsDownloadObject(file.objectName);
    if (!data) continue;
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    restoredBytes += data.length;
    restored.push(file.relPath);
    available.push(file.relPath);
  }
  if (restored.length > 0) log(`Restored ${restored.length} attachment file(s) from earlier turns (${restoredBytes} bytes).`);
  return { available, restored };
}
