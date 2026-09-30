import { DANGEROUS_EXTENSIONS } from '@xyne/shared';
import type { DraftChatAttachment } from '@/services/claw/draftChat';

/** Same caps as the Ask AI composer. claw-auth checks count and total again. */
export const DRAFT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DRAFT_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const DRAFT_ATTACHMENT_MAX_COUNT = 20;

const BLOCKED_EXTENSIONS = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

interface SizedFile {
  name: string;
  size: number;
}

/**
 * Which picked files can join the ones already attached. Stops at the first
 * rule a pick breaks, so the user sees one reason at a time.
 */
export function admitDraftFiles<T extends SizedFile>(
  files: readonly T[],
  attached: ReadonlyArray<{ size: number }>,
): { admitted: T[]; problem: string | null } {
  const allowed = files.filter(file => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    return !ext || !BLOCKED_EXTENSIONS.has(`.${ext}`);
  });
  if (files.length > 0 && allowed.length === 0) {
    return { admitted: [], problem: 'That file type is not allowed.' };
  }
  const oversized = allowed.filter(file => file.size > DRAFT_ATTACHMENT_MAX_FILE_BYTES);
  if (oversized.length > 0) {
    return {
      admitted: [],
      problem: `${oversized.map(file => file.name).join(', ')} is over 10MB.`,
    };
  }
  const room = DRAFT_ATTACHMENT_MAX_COUNT - attached.length;
  if (room <= 0) {
    return { admitted: [], problem: `Up to ${DRAFT_ATTACHMENT_MAX_COUNT} files per message.` };
  }
  const admitted = allowed.slice(0, room);
  const total = [...attached, ...admitted].reduce((sum, file) => sum + file.size, 0);
  if (total > DRAFT_ATTACHMENT_MAX_TOTAL_BYTES) {
    return { admitted: [], problem: 'Files for one message must add up to 25MB or less.' };
  }
  return {
    admitted,
    problem:
      allowed.length > room ? `Up to ${DRAFT_ATTACHMENT_MAX_COUNT} files per message.` : null,
  };
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const match = /^data:[^;]*;base64,(.*)$/.exec(result);
      if (match?.[1]) resolve(match[1]);
      else reject(new Error(`Could not read ${file.name}.`));
    };
    reader.onerror = (): void => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

export async function readDraftAttachments(files: File[]): Promise<DraftChatAttachment[]> {
  return Promise.all(
    files.map(async file => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      data: await readBase64(file),
    })),
  );
}
