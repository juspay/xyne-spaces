import { isSupportedInboundAttachment, isVideoAttachment } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { runAttachmentRefsEnabled, uploadRunAttachment } from "./run-attachment-store.js";

const log = createLogger("workflow-handoff");

const MAX_ROOT_ATTACHMENTS = 10;
const ROOT_TASK_CHARS = 4000;
const PREVIOUS_OUTPUT_CHARS = 8000;

export interface RootAttachmentRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
}

export interface HandoffAttachment {
  fileName: string;
  mimeType: string;
  data?: string;
  gcsRef?: string;
  sizeBytes?: number;
}

export function toRootAttachmentRefs(
  attachments: ReadonlyArray<{ attachmentId?: string; fileName?: string; mimeType?: string }> | undefined,
): RootAttachmentRef[] {
  const refs: RootAttachmentRef[] = [];
  for (const att of attachments ?? []) {
    if (!att.attachmentId || !att.fileName) continue;
    const mimeType = att.mimeType ?? "application/octet-stream";
    if (!isSupportedInboundAttachment(att.fileName, mimeType)) continue;
    if (isVideoAttachment(att.fileName, mimeType)) continue;
    refs.push({ attachmentId: att.attachmentId, fileName: att.fileName, mimeType });
    if (refs.length >= MAX_ROOT_ATTACHMENTS) break;
  }
  return refs;
}

export async function downloadRootAttachments(
  refs: ReadonlyArray<RootAttachmentRef>,
  opts: { appToken: string; scopeId: string },
): Promise<{ attachments: HandoffAttachment[]; failed: string[] }> {
  const attachments: HandoffAttachment[] = [];
  const failed: string[] = [];
  const useRefs = runAttachmentRefsEnabled();
  for (const ref of refs) {
    const id = encodeURIComponent(ref.attachmentId);
    let buffer: Buffer | null = null;
    for (const path of [`/api/apps/attachments/${id}/download`, `/api/attachments/${id}/download`]) {
      try {
        const res = await fetch(`${CONFIG.spacesInternalUrl}${path}`, {
          headers: { Authorization: `Bearer ${opts.appToken}` },
          signal: AbortSignal.timeout(CONFIG.attachmentDownloadTimeoutMs),
        });
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer());
          break;
        }
      } catch (err) {
        log.warn(`[handoff] download ${ref.attachmentId} via ${path} failed: ${errMsg(err)}`);
      }
    }
    if (!buffer) {
      failed.push(ref.fileName);
      continue;
    }
    const uploaded = useRefs ? await uploadRunAttachment(opts.scopeId, ref.attachmentId, buffer, ref.mimeType) : null;
    attachments.push(
      uploaded
        ? { fileName: ref.fileName, mimeType: ref.mimeType, gcsRef: uploaded.gcsRef, sizeBytes: uploaded.sizeBytes }
        : { fileName: ref.fileName, mimeType: ref.mimeType, data: buffer.toString("base64") },
    );
  }
  return { attachments, failed };
}

export function mergeHandoffAttachments(
  root: ReadonlyArray<HandoffAttachment>,
  previous: ReadonlyArray<HandoffAttachment>,
): HandoffAttachment[] {
  const byName = new Map<string, HandoffAttachment>();
  for (const att of root) byName.set(att.fileName, att);
  for (const att of previous) byName.set(att.fileName, att);
  return [...byName.values()];
}

export function buildHandoffContext(input: {
  rootTask: string | undefined;
  senderName: string | undefined;
  rootFileNames: ReadonlyArray<string>;
  failedFileNames: ReadonlyArray<string>;
  previousAgentSlug: string;
  previousOutput: string;
}): string {
  const sections: string[] = [];
  if (input.rootTask?.trim()) {
    sections.push(
      `--- Original request from ${input.senderName || "the user"} (start of this workflow) ---\n` +
        input.rootTask.trim().slice(0, ROOT_TASK_CHARS),
    );
  }
  if (input.rootFileNames.length > 0) {
    sections.push(`Files attached to the original request (included with this run): ${input.rootFileNames.join(", ")}`);
  }
  if (input.failedFileNames.length > 0) {
    sections.push(
      `These files from the original request could not be downloaded for this run: ${input.failedFileNames.join(", ")}. ` +
        "Fetch them from the thread with spaces-messages / spaces-fetch-attachment, or tell the user they are missing.",
    );
  }
  sections.push(`--- Final output from the previous agent ("${input.previousAgentSlug}") ---\n${input.previousOutput.slice(0, PREVIOUS_OUTPUT_CHARS)}`);
  return sections.join("\n\n");
}
