import { createLogger } from "./../logger.js";
import {
  detectLinkProvider,
  isSandboxMarkedEnded,
  markSandboxArtifactsStale,
  normalizeExternalUrl,
  recordConversationArtifact,
  type ArtifactRefService,
  type ConversationArtifactKind,
} from "./conversation-artifacts.js";

const log = createLogger("conversation-artifact-signals");

const CANVAS_TOOLS = new Set(["spaces-create-canvas", "spaces-edit-canvas", "spaces-sdlc-write-artifact"]);

export const LINK_TOOL_ALLOWLIST = new Set([
  "google-docs-create",
  "google-docs-edit",
  "google-docs-append",
  "google-docs-format",
  "google-sheets-create",
  "google-sheets-update",
  "google-sheets-append",
  "google-slides-create",
  "google-slides-add-slide",
  "google-forms-create",
  "google-forms-add-questions",
  "google-drive-upload",
  "google-drive-create-folder",
  "create_page",
  "update_page",
  "create_database",
  "update_database",
  "create_pull_request",
  "update_pull_request",
  "create_repository",
  "create_or_update_file",
  "create_issue",
  "update_issue",
  "create_comment",
  "create_file",
  "create_frame",
  "create_deck",
  "create_presentation",
]);

export interface ArtifactSignalContext {
  conversationId: string;
  messageId?: string | null | undefined;
  runId?: string | null | undefined;
  userId: string;
  orgId?: string | null | undefined;
}

export interface IngestArtifactSignalsInput extends ArtifactSignalContext {
  toolName: string;
  toolResult: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function textRecord(result: unknown): Record<string, unknown> | null {
  let text: string | null = null;
  if (typeof result === "string") text = result;
  else if (Array.isArray(result)) {
    text = result
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  } else if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) return textRecord(content);
  }
  if (!text || text.trim().startsWith("{")) return null;

  const record: Record<string, unknown> = {};
  const title = /^[ \t]*Title:(.*)$/im.exec(text)?.[1]?.trim();
  if (title && title !== "(unknown)") record["title"] = title;
  const urlLine = /^[ \t]*URL:[ \t]*(https?:\/\/\S+)[ \t]*$/im.exec(text)?.[1] ?? /https?:\/\/[^\s)>\]]+/i.exec(text)?.[0];
  if (urlLine) {
    record["url"] = urlLine;
    const canvasId = /\/canvas\/([A-Za-z0-9_-]+)/.exec(urlLine)?.[1];
    if (canvasId) record["canvasId"] = canvasId;
  }
  return Object.keys(record).length > 0 ? record : null;
}

function candidateRecords(result: unknown): Record<string, unknown>[] {
  const root = asRecord(result);
  if (!root) {
    const fromText = textRecord(result);
    return fromText ? [fromText] : [];
  }
  const out = [root];
  const fromText = textRecord(root);
  if (fromText) out.push(fromText);
  for (const key of ["data", "canvas", "artifact", "result", "output", "document", "file", "page"]) {
    const nested = asRecord(root[key]);
    if (nested) out.push(nested);
  }
  return out;
}

function pickString(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function firstUrl(records: Record<string, unknown>[]): string | null {
  const direct = pickString(records, ["url", "webUrl", "webViewLink", "link", "permalink", "htmlUrl", "html_url", "documentUrl", "shareUrl"]);
  return direct && /^https?:\/\//i.test(direct) ? direct : null;
}

/** Claw's own sandbox teardown tool (xyne-claw-shared tools/sandbox). */
const SANDBOX_DESTROY_TOOL = "sandbox-destroy";

/**
 * The id of the sandbox a successful `sandbox-destroy` call ended, or null.
 * The tool returns `{ sessionId, sandboxId, destroyed: true }` as JSON text,
 * either bare or wrapped in MCP content parts. A failed destroy
 * (`destroyed: false`) or an error string returns null, and nothing is marked.
 * `sandboxId` is the session actually destroyed; older builds only send
 * `sessionId`.
 */
function destroyedSandboxId(result: unknown): string | null {
  let record = asRecord(result);
  if (!record || (record["destroyed"] === undefined && record["content"] !== undefined)) {
    const parts = Array.isArray(result) ? result : Array.isArray(record?.["content"]) ? (record["content"] as unknown[]) : [];
    record = null;
    for (const part of parts) {
      const text = part && typeof part === "object" ? (part as { text?: unknown }).text : undefined;
      record = asRecord(text);
      if (record) break;
    }
  }
  if (!record || record["destroyed"] !== true) return null;
  const id = [record["sandboxId"], record["sessionId"]].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return id ? id.trim() : null;
}

/**
 * Best-effort artifact write. Never throws, but reports whether a row was
 * actually written: `recordConversationArtifact` can also return `null`
 * without throwing (no org for the user, bad kind, oversized refId), and
 * callers that gate user-visible output on the row existing must see that.
 */
async function safeRecord(
  label: string,
  input: Parameters<typeof recordConversationArtifact>[0],
): Promise<boolean> {
  try {
    const recorded = await recordConversationArtifact(input);
    if (!recorded) {
      log.warn(`${label} ingestion skipped: no row written (conversationId=${input.conversationId} refId=${input.refId})`);
      return false;
    }
    return true;
  } catch (err) {
    log.warn(`${label} ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function ingestArtifactSignals(input: IngestArtifactSignalsInput): Promise<void> {
  try {
    const { toolName, toolResult, conversationId, userId } = input;
    if (!conversationId || !userId || !toolName) return;

    // XYNE-66339: the run tore its sandbox down, so its preview has ended.
    if (toolName === SANDBOX_DESTROY_TOOL) {
      const sandboxId = destroyedSandboxId(toolResult);
      if (!sandboxId) return;
      try {
        await markSandboxArtifactsStale([sandboxId], { conversationId });
      } catch (err) {
        log.warn(`sandbox-destroy stale marking failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    const records = candidateRecords(toolResult);
    if (records.length === 0) return;

    const base = {
      conversationId,
      messageId: input.messageId ?? null,
      runId: input.runId ?? null,
      createdByUserId: userId,
      orgId: input.orgId ?? null,
    };

    if (CANVAS_TOOLS.has(toolName)) {
      const canvasId = pickString(records, ["canvasId", "artifactId", "canvas_id", "id"]);
      if (!canvasId) return;
      const title = pickString(records, ["title", "name", "canvasTitle"]) ?? "Canvas";
      await safeRecord("canvas", {
        ...base,
        kind: "CANVAS",
        refService: "SPACES",
        refId: canvasId,
        title,
        latestVersionRef: pickString(records, ["versionId", "canvasVersionId", "version_id"]),
      });
      return;
    }

    if (LINK_TOOL_ALLOWLIST.has(toolName)) {
      const url = firstUrl(records);
      if (!url) return;
      const normalized = normalizeExternalUrl(url);
      if (!normalized) return;
      const provider = detectLinkProvider(normalized);
      if (provider === "other") return;
      const title = pickString(records, ["title", "name", "documentTitle", "subject"]) ?? normalized;
      await safeRecord("link", {
        ...base,
        kind: "LINK",
        refService: "EXTERNAL",
        refId: normalized,
        url,
        provider,
        title,
      });
    }
  } catch (err) {
    log.warn(`ingestArtifactSignals threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface SandboxPreviewIngestResult {
  /**
   * True when at least one CLAW ownership row for the sandbox was written.
   * The sandbox access check (routes/sandbox-access.ts) authorizes on any
   * CLAW row for the sandboxId, so without one the preview URL returns 403.
   */
  recorded: boolean;
  reason?: "missing-input" | "record-failed" | "threw";
}

export async function ingestSandboxPreviewSignals(
  ctx: ArtifactSignalContext,
  payload: { sandboxId?: string; sandboxPreviewUrl?: string; sandboxCodePreviewUrl?: string },
): Promise<SandboxPreviewIngestResult> {
  try {
    const sandboxId = typeof payload?.sandboxId === "string" ? payload.sandboxId.trim() : "";
    if (!sandboxId || !ctx.conversationId || !ctx.userId) return { recorded: false, reason: "missing-input" };
    // XYNE-66339: frames are ingested concurrently, so an announce can land
    // after the destroy. Recording it would upsert the rows back to ACTIVE.
    // An ended sandbox never comes back, so skip it.
    if (await isSandboxMarkedEnded(sandboxId)) {
      log.info(`skipped preview for ended sandbox ${sandboxId}`);
      return { recorded: false };
    }
    const base = {
      conversationId: ctx.conversationId,
      messageId: ctx.messageId ?? null,
      runId: ctx.runId ?? null,
      createdByUserId: ctx.userId,
      orgId: ctx.orgId ?? null,
      refService: "CLAW" as ArtifactRefService,
      refId: sandboxId,
    };
    let recorded = false;
    if (payload.sandboxCodePreviewUrl) {
      recorded =
        (await safeRecord("diff", {
          ...base,
          kind: "DIFF",
          url: payload.sandboxCodePreviewUrl,
          title: "Code changes",
          latestVersionRef: ctx.runId ?? null,
        })) || recorded;
    }
    if (payload.sandboxPreviewUrl) {
      recorded =
        (await safeRecord("preview", {
          ...base,
          kind: "PREVIEW",
          url: payload.sandboxPreviewUrl,
          title: "Live preview",
        })) || recorded;
    }
    if (!payload.sandboxCodePreviewUrl && !payload.sandboxPreviewUrl) return { recorded: false, reason: "missing-input" };
    return recorded ? { recorded: true } : { recorded: false, reason: "record-failed" };
  } catch (err) {
    log.warn(`ingestSandboxPreviewSignals threw: ${err instanceof Error ? err.message : String(err)}`);
    return { recorded: false, reason: "threw" };
  }
}

export async function ingestDeliveredArtifact(
  ctx: ArtifactSignalContext,
  artifact: {
    kind: ConversationArtifactKind;
    refId: string;
    title: string;
    latestVersionRef?: string | null;
    url?: string | null;
  },
): Promise<void> {
  if (!ctx.conversationId || !ctx.userId || !artifact.refId) return;
  await safeRecord(artifact.kind.toLowerCase(), {
    conversationId: ctx.conversationId,
    messageId: ctx.messageId ?? null,
    runId: ctx.runId ?? null,
    createdByUserId: ctx.userId,
    orgId: ctx.orgId ?? null,
    kind: artifact.kind,
    refService: "CLAW",
    refId: artifact.refId,
    title: artifact.title,
    latestVersionRef: artifact.latestVersionRef ?? null,
    url: artifact.url ?? null,
  });
}

export async function recordUploadedArtifacts(args: {
  conversationId: string;
  messageId: string | null;
  userId: string;
  orgId: string | null;
  uploads: Array<{ id: string; originalFilename: string }>;
}): Promise<void> {
  for (const upload of args.uploads) {
    try {
      await ingestDeliveredArtifact(
        {
          conversationId: args.conversationId,
          userId: args.userId,
          orgId: args.orgId,
          messageId: args.messageId,
        },
        {
          kind: "UPLOAD",
          refId: upload.id,
          title: upload.originalFilename || "Attachment",
          latestVersionRef: upload.id,
        },
      );
    } catch {
      /* a source row is a convenience; the run still has the file */
    }
  }
}
