import { Router, type Request, type Response } from "express";
import { createLogger } from "../logger.js";
import { prisma } from "../db.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import {
  findArtifactsByRef,
  getConversationArtifact,
  isArtifactRefService,
  isArtifactStatus,
  listConversationArtifacts,
  toOpenRef,
  updateConversationArtifact,
  userOwnsConversation,
} from "../lib/conversation-artifacts.js";

const log = createLogger("conversation-artifacts-routes");

export const conversationArtifactsRouter = Router();

type ArtifactRow = Awaited<ReturnType<typeof getConversationArtifact>>;

function serialize(artifact: NonNullable<ArtifactRow>): Record<string, unknown> {
  return { ...artifact, openRef: toOpenRef(artifact) };
}

async function canRead(artifact: NonNullable<ArtifactRow>, requesterId: string): Promise<boolean> {
  if (artifact.createdByUserId === requesterId) return true;
  return userOwnsConversation(artifact.conversationId, requesterId);
}

function canWrite(artifact: NonNullable<ArtifactRow>, requesterId: string): boolean {
  return artifact.createdByUserId === requesterId;
}

conversationArtifactsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Authenticated user is required" });
      return;
    }
    const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"].trim() : "";
    if (!conversationId) {
      res.status(400).json({ success: false, error: "conversationId is required" });
      return;
    }
    const rows = await listConversationArtifacts(conversationId, requesterId);
    res.json({ success: true, artifacts: rows.map(serialize) });
  } catch (err) {
    log.error("list failed", err);
    res.status(500).json({ success: false, error: "Failed to list conversation artifacts" });
  }
});

conversationArtifactsRouter.get("/by-ref", async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Authenticated user is required" });
      return;
    }
    const service = typeof req.query["service"] === "string" ? req.query["service"].trim().toUpperCase() : "";
    const refId = typeof req.query["refId"] === "string" ? req.query["refId"].trim() : "";
    if (!isArtifactRefService(service) || !refId) {
      res.status(400).json({ success: false, error: "service and refId are required" });
      return;
    }
    const rows = await findArtifactsByRef(service, refId);
    const visible: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (await canRead(row, requesterId)) visible.push(serialize(row));
    }
    res.json({ success: true, artifacts: visible });
  } catch (err) {
    log.error("by-ref failed", err);
    res.status(500).json({ success: false, error: "Failed to look up artifacts" });
  }
});

conversationArtifactsRouter.get("/:id", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Authenticated user is required" });
      return;
    }
    const artifact = await getConversationArtifact(req.params.id);
    if (!artifact || !(await canRead(artifact, requesterId))) {
      res.status(404).json({ success: false, error: "Artifact not found" });
      return;
    }
    res.json({ success: true, artifact: serialize(artifact) });
  } catch (err) {
    log.error("get failed", err);
    res.status(500).json({ success: false, error: "Failed to load artifact" });
  }
});

conversationArtifactsRouter.patch("/:id", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Authenticated user is required" });
      return;
    }
    const artifact = await getConversationArtifact(req.params.id);
    if (!artifact || !(await canRead(artifact, requesterId))) {
      res.status(404).json({ success: false, error: "Artifact not found" });
      return;
    }
    if (!canWrite(artifact, requesterId)) {
      res.status(403).json({ success: false, error: "Only the artifact creator can update it" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const title = typeof body["title"] === "string" ? body["title"].trim() : undefined;
    const pinned = typeof body["pinned"] === "boolean" ? body["pinned"] : undefined;
    const status = typeof body["status"] === "string" ? body["status"].trim().toUpperCase() : undefined;

    if (title !== undefined && (!title || title.length > 500)) {
      res.status(400).json({ success: false, error: "title must be 1-500 characters" });
      return;
    }
    if (status !== undefined && !isArtifactStatus(status)) {
      res.status(400).json({ success: false, error: "status must be ACTIVE, STALE or DELETED" });
      return;
    }
    if (title === undefined && pinned === undefined && status === undefined) {
      res.status(400).json({ success: false, error: "Nothing to update" });
      return;
    }

    const updated = await updateConversationArtifact(artifact.id, {
      ...(title !== undefined ? { title } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(status !== undefined && isArtifactStatus(status) ? { status } : {}),
    });
    res.json({ success: true, artifact: serialize(updated) });
  } catch (err) {
    log.error("patch failed", err);
    res.status(500).json({ success: false, error: "Failed to update artifact" });
  }
});

const MAX_COMMENT_CHARS = 8000;

function readAnchor(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const quote = typeof row["quote"] === "string" ? row["quote"].slice(0, 2000) : "";
  if (!quote) return null;
  return {
    quote,
    ...(typeof row["selector"] === "string" ? { selector: row["selector"].slice(0, 600) } : {}),
    ...(typeof row["line"] === "number" && Number.isFinite(row["line"]) ? { line: Math.floor(row["line"]) } : {}),
    ...(typeof row["offset"] === "number" && Number.isFinite(row["offset"]) ? { offset: Math.floor(row["offset"]) } : {}),
  };
}

function serializeComment(row: {
  id: string;
  artifactId: string;
  body: string;
  userId: string;
  createdAt: Date;
  anchor: unknown;
  resolved: boolean;
  byAgent: boolean;
}, names?: Map<string, string>): Record<string, unknown> {
  return {
    id: row.id,
    itemId: row.artifactId,
    body: row.body,
    author: { id: row.userId, name: names?.get(row.userId) ?? "" },
    createdAt: row.createdAt.toISOString(),
    ...(row.anchor ? { anchor: row.anchor } : {}),
    ...(row.resolved ? { resolved: true } : {}),
    ...(row.byAgent ? { byAgent: true } : {}),
  };
}

async function commentAuthorNames(userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.name || user.email || ""]));
}

async function readableArtifact(req: Request, res: Response): Promise<NonNullable<ArtifactRow> | null> {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Authenticated user is required" });
    return null;
  }
  const artifact = await getConversationArtifact(String(req.params["id"] ?? ""));
  if (!artifact) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return null;
  }
  if (!(await canRead(artifact, requesterId))) {
    res.status(403).json({ success: false, error: "Not allowed" });
    return null;
  }
  return artifact;
}

conversationArtifactsRouter.get("/:id/comments", async (req: Request, res: Response): Promise<void> => {
  try {
    const artifact = await readableArtifact(req, res);
    if (!artifact) return;
    const rows = await prisma.artifactComment.findMany({
      where: { artifactId: artifact.id },
      orderBy: { createdAt: "asc" },
    });
    const names = await commentAuthorNames(rows.map((row) => row.userId));
    res.json({ success: true, comments: rows.map((row) => serializeComment(row, names)) });
  } catch (err) {
    log.error("comment list failed", err);
    res.status(500).json({ success: false, error: "Failed to list comments" });
  }
});

conversationArtifactsRouter.post("/:id/comments", async (req: Request, res: Response): Promise<void> => {
  try {
    const artifact = await readableArtifact(req, res);
    if (!artifact) return;
    const requesterId = getRequesterId(req) as string;

    const body = typeof (req.body as { body?: unknown })?.body === "string"
      ? (req.body as { body: string }).body.trim().slice(0, MAX_COMMENT_CHARS)
      : "";
    if (!body) {
      res.status(400).json({ success: false, error: "body is required" });
      return;
    }
    const anchor = readAnchor((req.body as { anchor?: unknown })?.anchor);

    const row = await prisma.artifactComment.create({
      data: {
        conversationId: artifact.conversationId,
        artifactId: artifact.id,
        orgId: artifact.orgId,
        userId: requesterId,
        body,
        ...(anchor ? { anchor } : {}),
      },
    });
    const names = await commentAuthorNames([row.userId]);
    res.status(201).json({ success: true, comment: serializeComment(row, names) });
  } catch (err) {
    log.error("comment create failed", err);
    res.status(500).json({ success: false, error: "Failed to add the comment" });
  }
});

conversationArtifactsRouter.patch("/:id/comments/:commentId", async (req: Request, res: Response): Promise<void> => {
  try {
    const artifact = await readableArtifact(req, res);
    if (!artifact) return;
    const resolved = (req.body as { resolved?: unknown })?.resolved === true;

    const updated = await prisma.artifactComment.updateMany({
      where: { id: String(req.params["commentId"] ?? ""), artifactId: artifact.id },
      data: { resolved },
    });
    if (updated.count === 0) {
      res.status(404).json({ success: false, error: "Comment not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    log.error("comment update failed", err);
    res.status(500).json({ success: false, error: "Failed to update the comment" });
  }
});
