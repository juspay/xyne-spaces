import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { agentRepository, chatMessageRepository, userRepository, agentRunRepository, chatAttachmentRepository, userAgentConfigRepository, userProviderCredentialsRepository, userSubagentConfigRepository } from "../repositories/index.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { prisma } from "../db.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { uploadChatAttachments } from "../services/chatAttachmentService.js";
import { gcsService } from "../services/gcsService.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import {
  buildAttachedContextPayload,
  normalizeAttachedContext,
  searchContextItems,
  type ContextSearchType,
} from "../services/agentChatContextService.js";
import { appendCitations } from "../lib/citations.js";

// Match the SLIDE_JSON_START/END markers emitted by create-ppt / edit-ppt so
// we can persist the slide JSON on the attachment's metadata for the viewer.
const SLIDE_JSON_RE = /SLIDE_JSON_START\s*([\s\S]+?)\s*SLIDE_JSON_END/;

/**
 * Coerce a pi-coding-agent tool result into plain text. The persisted shape is
 * often a JSON-encoded string wrapping the MCP envelope
 * `{ content: [{ type: "text", text }] }`; handle that by trying JSON.parse
 * when the string starts with `{`/`[`.
 */
function toolResultText(result: unknown): string {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") {
          const nested = toolResultText(parsed);
          if (nested) return nested;
        }
      } catch {
        /* fall through to raw string */
      }
    }
    return result;
  }
  if (!result || typeof result !== "object") return "";
  const obj = result as Record<string, unknown>;

  if (Array.isArray(obj["content"])) {
    const parts: string[] = [];
    for (const entry of obj["content"] as Array<Record<string, unknown>>) {
      if (entry?.["type"] === "text" && typeof entry["text"] === "string") {
        parts.push(entry["text"]);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  if (typeof obj["text"] === "string") return obj["text"];
  return "";
}

/**
 * Scan a list of tool invocations (from xyne-claw's callback) for the ppt
 * slide JSON and index it by filename. Looks at results from create-ppt /
 * edit-ppt, expects a `<safeTitle>.pptx` filename on the same tool call.
 */
function extractSlideJsonByFilename(toolInvocations: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(toolInvocations)) return map;

  for (const inv of toolInvocations as Array<Record<string, unknown>>) {
    const toolName = String(inv["toolName"] ?? "");
    if (toolName !== "create-ppt" && toolName !== "edit-ppt") continue;

    const text = toolResultText(inv["result"]);
    if (!text) continue;

    const m = text.match(SLIDE_JSON_RE);
    if (!m?.[1]) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }

    // Filename appears on the preceding "Rendered and attached X" line. If we
    // can't find one, skip — we can't associate the JSON to an attachment.
    const nameMatch = text.match(/Rendered and attached\s+(\S+\.pptx)/i);
    if (!nameMatch?.[1]) continue;
    map.set(nameMatch[1], parsed);
  }

  return map;
}

const router = Router();
const internalRouter = Router();

// In-flight SSE streams keyed by callbackId
interface CallbackAttachment {
  fileName: string;
  mimeType: string;
  data: string;
  metadata?: Record<string, unknown>;
}
interface PendingStream {
  sendEvent: (event: string, data: unknown) => void;
  resolve: (result: {
    content: string;
    status: "completed" | "failed" | "cancelled";
    pendingActions?: Array<Record<string, unknown>>;
    attachments?: CallbackAttachment[];
    toolInvocations?: unknown;
  }) => void;
  setClosed: () => void;
}
const pendingStreams = new Map<string, PendingStream>();

function normalizeRunStatus(status: unknown): "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function getCookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function extractSpacesUserToken(req: Request): string | undefined {
  const bodyToken = (req.body as { userToken?: string } | undefined)?.userToken;
  if (bodyToken) return bodyToken;

  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const lastWorkspace = getCookieValue(req, "xyne_last_workspace");
  if (lastWorkspace) {
    const workspaceToken = getCookieValue(req, `xyne_ws_${lastWorkspace}_token`);
    if (workspaceToken) return workspaceToken;
  }

  const legacy = getCookieValue(req, "google_access_token");
  if (legacy && legacy.split(".").length === 3) return legacy;

  return undefined;
}

function extractSpacesSessionId(req: Request): string | undefined {
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return getCookieValue(req, "user_session_id");
}

async function resolveSpacesAuth(req: Request, userId: string): Promise<SpacesAuthContext | undefined> {
  try {
    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: "xyne-spaces" } },
    });

    if (connection) {
      const decrypted = decrypt(
        connection.encryptedCreds,
        connection.iv,
        connection.authTag,
        CONFIG.encryptionKey,
      );
      const credentials = JSON.parse(decrypted) as Record<string, unknown>;
      const tokenRaw = credentials["token"];
      const urlRaw = credentials["url"];
      const sessionIdRaw = credentials["sessionId"];

      const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
      if (token) {
        const baseUrl = typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : CONFIG.spacesBackendUrl;
        const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : undefined;
        return {
          token,
          baseUrl,
          ...(sessionId ? { sessionId } : {}),
        };
      }
    }
  } catch (err) {
    console.error("[agent-chat] failed to load xyne-spaces MCP credentials:", err);
  }

  const token = extractSpacesUserToken(req);
  if (!token) return undefined;
  const sessionId = extractSpacesSessionId(req);
  return {
    token,
    baseUrl: CONFIG.spacesBackendUrl,
    ...(sessionId ? { sessionId } : {}),
  };
}

// Multer for attachment uploads (memory buffers → GCS)
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // 25MB/file, 10 files + 10 thumbnails
});

// POST /agents/:slug/chat/attachments/upload — upload files to GCS, return IDs
router.post(
  "/:slug/chat/attachments/upload",
  uploadMiddleware.fields([
    { name: "files", maxCount: 10 },
    { name: "thumbnails", maxCount: 10 },
  ]),
  async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
    try {
      const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
      if (!userId) {
        res.status(400).json({ success: false, error: "userId or x-user-id header required" });
        return;
      }

      const filesMap = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
      const files = filesMap?.["files"] ?? [];
      const thumbnails = filesMap?.["thumbnails"];
      if (files.length === 0) {
        res.status(400).json({ success: false, error: "No files uploaded" });
        return;
      }

      let fileMetadata: Array<{ hasThumbnail?: boolean; width?: number; height?: number }> = [];
      const rawMeta = (req.body as { fileMetadata?: string }).fileMetadata;
      if (rawMeta) {
        try {
          const parsed = JSON.parse(rawMeta) as unknown;
          if (Array.isArray(parsed)) fileMetadata = parsed as typeof fileMetadata;
        } catch {
          /* ignore malformed metadata */
        }
      }

      const results = await uploadChatAttachments(files, thumbnails, fileMetadata, userId);
      // Hide internal GCS path from client
      const safe = results.map(({ url: _url, thumbnailUrl: _tu, ...rest }) => rest);
      res.json({ success: true, data: safe });
    } catch (err) {
      console.error("[agent-chat] upload error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Upload failed" });
    }
  },
);

// GET /agents/attachments/:id/download — stream the full file
router.get("/attachments/:id/download", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = att.uploaderUserId === requesterId || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.originalFilename)}"`);
    if (att.size) res.setHeader("Content-Length", String(att.size));
    res.setHeader("Cache-Control", "private, max-age=3600");

    const stream = gcsService.createReadStream(att.url);
    stream.on("error", (err) => {
      console.error("[agent-chat] download stream error:", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    console.error("[agent-chat] download error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/slide-json — slide JSON for the PPT viewer
router.get("/attachments/:id/slide-json", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = att.uploaderUserId === requesterId || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    const metadata = (att as unknown as { metadata?: Record<string, unknown> | null }).metadata;
    const slideJson = metadata && typeof metadata === "object" ? metadata["slideJson"] : undefined;
    if (!slideJson) {
      res.status(404).json({ success: false, error: "No slide JSON available for this attachment" });
      return;
    }
    res.json({ success: true, data: slideJson });
  } catch (err) {
    console.error("[agent-chat] slide-json error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/thumbnail — serve thumbnail if present
router.get("/attachments/:id/thumbnail", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = att.uploaderUserId === requesterId || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    if (!att.thumbnailUrl) { res.status(404).json({ success: false, error: "No thumbnail" }); return; }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    const stream = gcsService.createReadStream(att.thumbnailUrl);
    stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    stream.pipe(res);
  } catch (err) {
    console.error("[agent-chat] thumbnail error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/stream — range-aware streaming for video/audio
router.get("/attachments/:id/stream", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = att.uploaderUserId === requesterId || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    const total = att.size;
    const range = req.headers["range"];

    if (!range) {
      res.writeHead(200, {
        "Content-Length": String(total),
        "Content-Type": att.mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      });
      gcsService.createReadStream(att.url).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) { res.status(416).end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const maxChunk = 1024 * 1024; // 1MB
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    const end = Math.min(requestedEnd, start + maxChunk - 1, total - 1);

    if (start > end || start >= total) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Type": att.mimeType,
    });
    gcsService.createReadStream(att.url, { start, end }).pipe(res);
  } catch (err) {
    console.error("[agent-chat] stream error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/context/search — typeahead for attach-context picker
router.get("/:slug/context/search", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }

    const agent = await agentRepository.findBySlug(req.params.slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const rawType = String(req.query["type"] ?? "all").trim() as ContextSearchType;
    if (rawType !== "all" && rawType !== "channel" && rawType !== "ticket" && rawType !== "canvas" && rawType !== "call") {
      res.status(400).json({ success: false, error: "type must be one of all|channel|ticket|canvas|call" });
      return;
    }

    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const rawLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 20;

    const spacesAuth = await resolveSpacesAuth(req, userId);
    if (!spacesAuth) {
      res.status(401).json({ success: false, error: "Spaces credentials not found. Connect xyne-spaces MCP or provide user token." });
      return;
    }

    const items = await searchContextItems(rawType, q, limit, spacesAuth);
    res.json({ items });
  } catch (err) {
    console.error("[agent-chat] context search error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/chat — send a message, stream progress via SSE, return result
router.post("/:slug/chat", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const { message, conversationId: existingConvId, attachmentIds, attachedContext } = req.body as {
      message?: string;
      conversationId?: string;
      attachmentIds?: string[];
      attachedContext?: unknown;
    };
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const agent = await agentRepository.findBySlug(slug);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const conversationId = existingConvId ?? `chat-${randomUUID()}`;
    const normalized = normalizeAttachedContext(attachedContext);
    if (normalized.error) {
      res.status(400).json({ success: false, error: normalized.error });
      return;
    }
    const attachedContextItems = normalized.items;
    const spacesAuth = attachedContextItems.length > 0 ? await resolveSpacesAuth(req, userId) : undefined;
    if (attachedContextItems.length > 0 && !spacesAuth) {
      res.status(401).json({ success: false, error: "Spaces credentials not found for attached context" });
      return;
    }

    // Store user message, then link any uploaded attachments to it
    const userMsg = await chatMessageRepository.create({ conversationId, agentSlug: slug, userId, role: "user", content: message.trim() });
    let hydratedAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
    if (attachmentIds?.length) {
      await chatAttachmentRepository.linkToMessage(attachmentIds, userMsg.id, userId);
      const rows = await chatAttachmentRepository.findManyByIdsForUser(attachmentIds, userId);
      // Fetch bytes from GCS and encode base64 for /run
      hydratedAttachments = await Promise.all(rows.map(async (r) => {
        const buf = await gcsService.getFileBuffer(r.url);
        return { fileName: r.originalFilename, mimeType: r.mimeType, data: buf.toString("base64") };
      }));
    }

    const user = await userRepository.findById(userId);
    let resolvedContext: { promptPrefix?: string; contextFiles: Array<{ path: string; content: string }> } = { contextFiles: [] };
    if (attachedContextItems.length > 0) {
      try {
        resolvedContext = await buildAttachedContextPayload(attachedContextItems, spacesAuth);
      } catch (err) {
        console.error("[agent-chat] attached context resolve error:", err);
      }
    }

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send conversationId immediately
    res.write(`event: meta\ndata: ${JSON.stringify({ conversationId })}\n\n`);

    const callbackId = randomUUID();

    // Create promise for final result
    const resultPromise = new Promise<{
      content: string;
      status: "completed" | "failed" | "cancelled";
      pendingActions?: Array<Record<string, unknown>>;
      attachments?: CallbackAttachment[];
      toolInvocations?: unknown;
    }>((resolve) => {
      let closed = false;
      pendingStreams.set(callbackId, {
        sendEvent: (event, data) => {
          if (closed) return;
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        },
        resolve,
        setClosed: () => { closed = true; },
      });

      // Safety-net timeout for the SSE wait. Real runs usually finish in < 2 min,
      // but heavy agents (deep subagent chains, slow tools) can take longer —
      // this is only a cap for when xyne-claw never posts back at all.
      setTimeout(() => {
        if (pendingStreams.has(callbackId)) {
          pendingStreams.delete(callbackId);
          resolve({ content: "Agent timed out", status: "failed" });
        }
      }, 30 * 60 * 1000); // 30 minutes
    });

    // Call /run
    const callbackUrl = `${CONFIG.selfUrl}/claw/api/v1/internal/agent-chat/${slug}/chat/${conversationId}/callback?callbackId=${callbackId}`;
    const progressUrl = `${CONFIG.selfUrl}/claw/api/v1/internal/agent-chat/${slug}/chat/${conversationId}/progress?callbackId=${callbackId}`;

    // Resolve the user's provider + credentials the same way the webhook path
    // does. Without this, xyne-claw falls back to shared LITELLM with the
    // default PPT model (kimi-latest) — which the team keys don't have access
    // to — and create-ppt/edit-ppt fail with 401.
    const userAgentConfig = await userAgentConfigRepository.findByUserAndAgent(userId, slug).catch(() => null);
    const userProvider = userAgentConfig?.provider;
    const allCreds = await userProviderCredentialsRepository.listByUser(userId).catch(() => []);
    const subagentConfigs = await userSubagentConfigRepository.listByUser(userId).catch(() => []);
    const subagentProviders: Record<string, string> = {};
    for (const s of subagentConfigs) subagentProviders[s.subagentName] = s.provider;
    const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }> = {};
    for (const row of allCreds) {
      if (!row.encryptedKey || !row.iv || !row.authTag) continue;
      try {
        const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
        const apiKey = row.provider === "codex" ? extractCodexBearer(decrypted) : decrypted;
        const defaultModel =
          row.provider === "copilot" ? "gpt-4o" :
          row.provider === "codex" ? "gpt-4.1" :
          "claude-sonnet-4-5";
        providerConfigs[row.provider] = {
          apiKey,
          model: row.model ?? defaultModel,
          ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
          ...(row.authType ? { authType: row.authType } : {}),
        };
      } catch (err) {
        console.warn(`[agent-chat] failed to decrypt ${row.provider} key:`, err instanceof Error ? err.message : err);
      }
    }

    const runRes = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        userName: user?.name,
        userEmail: user?.email,
        task: message.trim(),
        conversationId,
        agentSlug: slug,
        ...(userProvider ? { provider: userProvider } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        callbackUrl,
        progressUrl,
        ...(resolvedContext.promptPrefix ? { context: resolvedContext.promptPrefix } : {}),
        ...(resolvedContext.contextFiles.length > 0 ? { contextFiles: resolvedContext.contextFiles } : {}),
        ...(attachedContextItems.length > 0 ? { attachedContext: attachedContextItems } : {}),
        ...(hydratedAttachments.length ? { attachments: hydratedAttachments } : {}),
      }),
    });

    const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

    // Track run for Agent Control Center
    if (runBody.success && runBody.sessionId) {
      res.write(`event: run\ndata: ${JSON.stringify({ sessionId: runBody.sessionId })}\n\n`);
      agentRunRepository.start({
        sessionId: runBody.sessionId,
        userId,
        agentSlug: slug,
        triggerSource: "chat",
        task: message.trim(),
        conversationId,
      }).catch((e) => console.warn("[agent-chat] AgentRun.start failed:", e instanceof Error ? e.message : e));
    }

    if (!runBody.success) {
      pendingStreams.delete(callbackId);
      const errContent = runBody.error ?? "Failed to start agent";
      await chatMessageRepository.create({ conversationId, agentSlug: slug, userId, role: "assistant", content: errContent, status: "failed" });
      res.write(`event: done\ndata: ${JSON.stringify({ role: "assistant", content: errContent, status: "failed" })}\n\n`);
      res.end();
      return;
    }

    // Keep backend processing alive even if the client disconnects (e.g. user
    // clicked Stop and aborted the fetch). We still persist the final message/run.
    req.on("close", () => {
      pendingStreams.get(callbackId)?.setClosed();
    });

    // Wait for result
    const result = await resultPromise;

    // Store assistant message
    const assistantMsg = await chatMessageRepository.create({ conversationId, agentSlug: slug, userId, role: "assistant", content: result.content, status: result.status });

    // Persist any tool-generated attachments (e.g. create-ppt .pptx) into GCS
    // and the ChatAttachment table so the UI can render a download card /
    // preview. Slide JSON (when present in the tool result) is stashed on the
    // row's metadata for the PPT viewer.
    const persistedAttachments: Array<{ id: string; mimeType: string; originalFilename: string; size: number }> = [];
    if (result.attachments?.length) {
      // Prefer metadata carried on the attachment itself (immune to the 10KB
      // truncation pi-coding-agent applies to toolInvocations[].result).
      // Fall back to scanning the (potentially truncated) invocations.
      const fallbackSlides = extractSlideJsonByFilename(result.toolInvocations);
      const year = new Date().getUTCFullYear();
      const month = String(new Date().getUTCMonth() + 1).padStart(2, "0");

      for (const att of result.attachments) {
        try {
          const buffer = Buffer.from(att.data, "base64");
          const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
          const destPath = `chat-attachments/${userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;
          await gcsService.uploadFile(buffer, destPath, att.mimeType);

          const inlineMeta = att.metadata && typeof att.metadata === "object" ? att.metadata : undefined;
          const fallbackSlide = fallbackSlides.get(att.fileName);
          const attachmentMetadata: Record<string, unknown> | undefined =
            inlineMeta && Object.keys(inlineMeta).length > 0
              ? inlineMeta
              : fallbackSlide
                ? { slideJson: fallbackSlide }
                : undefined;

          const row = await prisma.chatAttachment.create({
            data: {
              chatMessageId: assistantMsg.id,
              uploaderUserId: userId,
              url: destPath,
              originalFilename: att.fileName,
              mimeType: att.mimeType,
              size: buffer.length,
              ...(attachmentMetadata ? { metadata: attachmentMetadata as import("@prisma/client").Prisma.InputJsonValue } : {}),
            },
          });
          persistedAttachments.push({
            id: row.id,
            mimeType: row.mimeType,
            originalFilename: row.originalFilename,
            size: row.size,
          });
        } catch (e) {
          console.error("[agent-chat] failed to persist assistant attachment:", e);
        }
      }
    }

    // Send final result and close. pendingActions flow through so the chat UI
    // can render Approve/Decline buttons per write-tool that needs sign-off.
    const pendingActionsForClient = (result as { pendingActions?: Array<Record<string, unknown>> }).pendingActions ?? [];
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        role: "assistant",
        content: result.content,
        status: result.status,
        ...(pendingActionsForClient.length ? { pendingActions: pendingActionsForClient } : {}),
        ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
      })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error("[agent-chat] send error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

// POST /agents/:slug/chat/cancel — cancel an in-flight chat run
router.post("/:slug/chat/cancel", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const { slug } = req.params;
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ success: false, error: "sessionId is required" });
      return;
    }

    const run = await agentRunRepository.findBySessionId(sessionId);
    if (!run || run.userId !== userId || run.agentSlug !== slug) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    if (run.status !== "running") {
      res.json({
        success: true,
        data: { sessionId, conversationId: run.conversationId, status: run.status },
      });
      return;
    }

    const cancelRes = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!cancelRes.ok) {
      const body = (await cancelRes.json().catch(() => ({}))) as { error?: string };
      res.status(502).json({ success: false, error: body.error ?? `Cancel failed: HTTP ${cancelRes.status}` });
      return;
    }

    res.json({
      success: true,
      data: { sessionId, conversationId: run.conversationId, status: "cancelled" },
    });
  } catch (err) {
    console.error("[agent-chat] cancel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/chat/:convId/progress — tool progress from xyne-claw (internal, no auth)
internalRouter.post("/:slug/chat/:convId/progress", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  res.json({ success: true });

  const callbackId = req.query["callbackId"] as string | undefined;
  const { toolLabel, sessionId, toolInvocation, reasoningDelta, textDelta, attachment } = req.body as {
    toolLabel?: string;
    sessionId?: string;
    toolInvocation?: unknown;
    reasoningDelta?: string;
    textDelta?: string;
    attachment?: { fileName: string; mimeType: string; data: string; metadata?: Record<string, unknown> };
  };

  const stream = callbackId ? pendingStreams.get(callbackId) : undefined;

  // Tier 1: forward the live tool label on tool_execution_start.
  if (stream && toolLabel) {
    stream.sendEvent("progress", { toolLabel });
  }

  // Tier 1 + 2: forward the full tool invocation on tool_execution_end.
  // toolInvocation may carry parentToolCallId + subagentName for nested child rows.
  if (stream && toolInvocation) {
    stream.sendEvent("tool", { toolInvocation });
  }

  // Tier 3: forward reasoning / text deltas char-by-char as they arrive from the model.
  if (stream && typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
    stream.sendEvent("reasoning", { delta: reasoningDelta });
  }
  if (stream && typeof textDelta === "string" && textDelta.length > 0) {
    stream.sendEvent("text", { delta: textDelta });
  }

  // Stream a just-captured attachment (e.g. create-ppt PPTX) so the UI
  // renders it mid-session instead of waiting for finalize.
  if (stream && attachment) {
    stream.sendEvent("attachment", { attachment });
  }

  if (sessionId && toolInvocation) {
    agentRunRepository.appendToolInvocation(sessionId, toolInvocation).catch(() => {});
  }

  // Streamed attachments are UI-only: the final callback persists them to GCS
  // and the `done` event ships canonical IDs that replace the blob-backed
  // placeholders on the client.

  if (sessionId && toolLabel) {
    agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});
  }
});

// POST /agents/:slug/chat/:convId/callback — final result from xyne-claw (internal, no auth)
internalRouter.post("/:slug/chat/:convId/callback", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  res.json({ success: true });

  const callbackId = req.query["callbackId"] as string | undefined;
  const { result, status, error, pendingActions, sessionId, toolsUsed, toolInvocations, tokenUsage, attachments } = req.body as {
    result?: string;
    status?: string;
    error?: string;
    pendingActions?: Array<Record<string, unknown>>;
    sessionId?: string;
    toolsUsed?: string[];
    toolInvocations?: unknown;
    tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    attachments?: CallbackAttachment[];
  };

  const enrichedResult = status === "completed" && result
    ? appendCitations(result, toolInvocations, { baseUrl: CONFIG.spacesAppUrl })
    : result;

  // Await finalize BEFORE resolving the pending stream. The stream resolution
  // drives the SSE `done` event on the client, which triggers refreshRuns().
  // Without this await, refreshRuns would race finalize and fetch stale state
  // — stale "running" tool rows that should have been swept to completed.
  if (sessionId) {
    const finalStatus = normalizeRunStatus(status);
    try {
      await agentRunRepository.finalize(sessionId, {
        status: finalStatus,
        result: enrichedResult ?? null,
        error: error ?? null,
        toolsUsed: toolsUsed ?? [],
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
      });
    } catch (err) {
      console.warn("[agent-chat] finalize failed:", err instanceof Error ? err.message : err);
    }
  }

  if (callbackId && pendingStreams.has(callbackId)) {
    const stream = pendingStreams.get(callbackId)!;
    pendingStreams.delete(callbackId);
    stream.resolve({
      content: enrichedResult ?? error ?? "No response",
      status: normalizeRunStatus(status),
      ...(pendingActions?.length ? { pendingActions } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(toolInvocations !== undefined ? { toolInvocations } : {}),
    });
  }
});

// GET /agents/:slug/chat/:convId/messages — get conversation history
router.get("/:slug/chat/:convId/messages", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    const messages = await chatMessageRepository.findByConversation(req.params.convId);
    // Strip internal GCS paths from attachment metadata before sending to client
    const serialized = messages.map((m) => {
      const attachmentsRaw = (m as unknown as { attachments?: Array<{ id: string; mimeType: string; originalFilename: string; width: number | null; height: number | null }> }).attachments ?? [];
      const attachments = attachmentsRaw.map((a) => ({
        id: a.id,
        mimeType: a.mimeType,
        originalFilename: a.originalFilename,
        width: a.width,
        height: a.height,
      }));
      return { ...m, attachments };
    });
    res.json({ success: true, data: serialized });
  } catch (err) {
    console.error("[agent-chat] messages error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/conversations — list user's conversations with summaries
router.get("/:slug/conversations", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userId = (req.query["userId"] as string) ?? getRequesterId(req);
    if (!userId) {
      res.status(400).json({ success: false, error: "userId required" });
      return;
    }

    // Get all messages for this user+agent, grouped by conversation
    const allMessages = await chatMessageRepository.findByUserAndAgent(userId, req.params.slug);

    // Group by conversationId
    const convMap = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      const list = convMap.get(msg.conversationId) ?? [];
      list.push(msg);
      convMap.set(msg.conversationId, list);
    }

    // Build summaries
    const conversations = [...convMap.entries()].map(([conversationId, msgs]) => {
      const firstUserMsg = msgs.find((m) => m.role === "user");
      const lastMsg = msgs[msgs.length - 1]!;
      return {
        conversationId,
        title: (firstUserMsg?.content ?? "").slice(0, 80),
        messageCount: msgs.length,
        lastMessageAt: lastMsg.createdAt,
      };
    }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    res.json({ success: true, data: conversations });
  } catch (err) {
    console.error("[agent-chat] conversations error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /agents/:slug/chat/approve-action
 * User clicked "Approve" on a write-tool card inside the chat UI.
 * Body: { pendingAction: { serverType, tool, params, userId, signature } }
 * Returns the tool's execution result so the UI can render it inline.
 */
router.post("/:slug/chat/approve-action", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const callerUserId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    if (!callerUserId) {
      res.status(401).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const { pendingAction } = req.body as { pendingAction?: unknown };
    if (!pendingAction || typeof pendingAction !== "object") {
      res.status(400).json({ success: false, error: "pendingAction is required" });
      return;
    }

    const action = pendingAction as {
      serverType?: string; tool?: string; params?: Record<string, unknown>; userId?: string; signature?: string;
    };
    if (!action.serverType || !action.tool || !action.userId || !action.signature) {
      res.status(400).json({ success: false, error: "pendingAction must include serverType, tool, userId, signature" });
      return;
    }

    // Only the intended user can approve an action (XYNE-12145 — same rule as
    // the Spaces-button flow in app-callback.ts).
    if (callerUserId !== action.userId) {
      res.status(403).json({ success: false, error: "Only the intended user can approve this action" });
      return;
    }

    const { executeWriteAction } = await import("../lib/write-actions.js");
    const result = await executeWriteAction({
      serverType: action.serverType,
      tool: action.tool,
      params: action.params ?? {},
      userId: action.userId,
      signature: action.signature,
    });

    if (!result.ok) {
      console.error(`[agent-chat] approve-action failed: ${action.tool} — ${result.error}`);
      res.status(400).json({ success: false, error: result.error ?? "Execution failed" });
      return;
    }

    console.log(`[agent-chat] approve-action ok: ${action.tool} → ${result.content.slice(0, 100)}`);
    res.json({ success: true, data: { content: result.content } });
  } catch (err) {
    console.error("[agent-chat] approve-action error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as agentChatRouter, internalRouter as agentChatInternalRouter };
