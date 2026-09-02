/**
 * Saved & published artifact apps.
 *
 * A generated React project starts life as a throwaway `ChatAttachment`, readable
 * only by the person who ran the chat. Saving promotes it into an `ArtifactApp`
 * with its own id, title and version history; publishing makes the pinned version
 * readable by everyone in the owner's Spaces workspace.
 *
 * Two deliberate choices are load-bearing:
 *
 *  - **The bytes are copied at save**, not referenced from the attachment. A
 *    published app must not break because someone deleted the conversation that
 *    produced it.
 *  - **The existing attachment ACL is untouched.** `agent-chat.ts` enforces
 *    "uploader or claw admin" on its four attachment routes; widening that to
 *    understand publication would put shared-read logic inside the path that also
 *    serves private chat files. Saved apps get their own object, route and check.
 */

import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { gcsService } from "../services/storageService.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser, requestWorkspaceHint } from "../lib/spaces-db.js";
import { chatAttachmentRepository } from "../repositories/index.js";
import { buildReactArtifact } from "xyne-claw-shared/tools/react-artifact";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-apps");
export const artifactAppsRouter: Router = Router();

const VISIBILITY_PRIVATE = "PRIVATE";
const VISIBILITY_WORKSPACE = "WORKSPACE";

const ARTIFACT_MIME = "application/json";
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 500;

/**
 * Where a saved project's bytes live, independent of the originating chat.
 * Named with a fresh uuid rather than the version id so the object can be
 * written BEFORE the row exists — a row is only ever created once its bytes are
 * durably stored, so `storagePath` can never point at nothing.
 */
function storagePathFor(appId: string): string {
  return `artifact-apps/${appId}/${randomUUID()}.json`;
}

const saveBody = z.object({
  attachmentId: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().max(MAX_DESCRIPTION).optional(),
});

const addVersionBody = z.object({ attachmentId: z.string().min(1) });
const publishBody = z.object({ versionId: z.string().min(1) });
const restoreBody = z.object({ versionId: z.string().min(1) });

function badRequest(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  res.status(400).json({
    success: false,
    error: "ValidationError",
    details: parsed.error.flatten(),
  });
}

/**
 * Read the project JSON out of an attachment the caller owns, and re-validate it
 * through the tool's own validator. Stored bytes are not trusted: a save must not
 * be able to introduce a payload `create-react-artifact` would have rejected.
 */
async function readAttachmentPayload(
  attachmentId: string,
  requesterId: string,
): Promise<{ ok: true; buffer: Buffer; manifest: unknown } | { ok: false; status: number; error: string }> {
  const att = await chatAttachmentRepository.findById(attachmentId);
  if (!att) return { ok: false, status: 404, error: "Attachment not found" };
  if (att.uploaderUserId !== requesterId) {
    return { ok: false, status: 403, error: "You can only save your own artifacts" };
  }

  let raw: Buffer;
  try {
    raw = await gcsService.getFileBuffer(att.url);
  } catch (err) {
    log.error(`failed reading attachment bytes attachmentId=${attachmentId}: ${String(err)}`);
    return { ok: false, status: 502, error: "Could not read the artifact payload" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 422, error: "Attachment is not a valid artifact payload" };
  }

  try {
    const built = buildReactArtifact(parsed);
    // Re-serialize from the validated payload so what we persist is exactly what
    // the validator approved, not the original bytes.
    return {
      ok: true,
      buffer: Buffer.from(JSON.stringify(built.payload), "utf8"),
      manifest: built.manifest,
    };
  } catch (err) {
    return {
      ok: false,
      status: 422,
      error: err instanceof Error ? err.message : "Artifact payload failed validation",
    };
  }
}

/** POST / — save an artifact as a new app (version 1). */
artifactAppsRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = saveBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-apps", requestWorkspaceHint(req));
  if (!workspaceId) {
    res.status(409).json({ success: false, error: "No Spaces workspace for this user" });
    return;
  }

  const payload = await readAttachmentPayload(parsed.data.attachmentId, requesterId);
  if (!payload.ok) {
    res.status(payload.status).json({ success: false, error: payload.error });
    return;
  }

  const contentHash = createHash("sha256").update(payload.buffer).digest("hex");

  const app = await prisma.artifactApp.create({
    data: {
      workspaceId,
      ownerUserId: requesterId,
      title: parsed.data.title,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      visibility: VISIBILITY_PRIVATE,
    },
  });

  const path = storagePathFor(app.id);
  try {
    await gcsService.uploadFile(payload.buffer, path, ARTIFACT_MIME);
  } catch (err) {
    // Don't leave a titled app with nothing behind it.
    await prisma.artifactApp.delete({ where: { id: app.id } }).catch(() => undefined);
    log.error(`failed storing artifact app bytes appId=${app.id}: ${String(err)}`);
    res.status(502).json({ success: false, error: "Could not store the app" });
    return;
  }

  const version = await prisma.artifactAppVersion.create({
    data: {
      // Denormalized from the parent so a versions query cannot cross tenants.
      workspaceId: app.workspaceId,
      appId: app.id,
      versionNumber: 1,
      manifest: payload.manifest as object,
      storagePath: path,
      contentHash,
      sizeBytes: payload.buffer.byteLength,
      createdBy: requesterId,
    },
  });

  res.status(201).json({ success: true, app: { ...app, versions: [version] } });
});

/** POST /:id/versions — append a new build to an app the caller owns. */
artifactAppsRouter.post("/:id/versions", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = addVersionBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }
  if (app.ownerUserId !== requesterId) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }

  const payload = await readAttachmentPayload(parsed.data.attachmentId, requesterId);
  if (!payload.ok) {
    res.status(payload.status).json({ success: false, error: payload.error });
    return;
  }

  const contentHash = createHash("sha256").update(payload.buffer).digest("hex");

  // The agent regenerates near-identical apps readily; a byte-identical build is
  // the same version, not a new one.
  const existing = await prisma.artifactAppVersion.findUnique({
    where: { appId_contentHash: { appId: app.id, contentHash } },
  });
  if (existing) {
    res.json({ success: true, version: existing, deduped: true });
    return;
  }

  const last = await prisma.artifactAppVersion.findFirst({
    where: { appId: app.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });

  const path = storagePathFor(app.id);
  try {
    await gcsService.uploadFile(payload.buffer, path, ARTIFACT_MIME);
  } catch (err) {
    log.error(`failed storing artifact app version appId=${app.id}: ${String(err)}`);
    res.status(502).json({ success: false, error: "Could not store the app" });
    return;
  }

  const version = await prisma.artifactAppVersion.create({
    data: {
      workspaceId: app.workspaceId,
      appId: app.id,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      manifest: payload.manifest as object,
      storagePath: path,
      contentHash,
      sizeBytes: payload.buffer.byteLength,
      createdBy: requesterId,
    },
  });

  res.status(201).json({ success: true, version });
});

/** POST /:id/publish — pin a version and open it to the workspace. */
artifactAppsRouter.post("/:id/publish", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = publishBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }
  if (app.ownerUserId !== requesterId) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }

  const version = await prisma.artifactAppVersion.findUnique({ where: { id: parsed.data.versionId } });
  if (!version || version.appId !== app.id) {
    res.status(404).json({ success: false, error: "Version not found for this app" });
    return;
  }

  const updated = await prisma.artifactApp.update({
    where: { id: app.id },
    data: {
      visibility: VISIBILITY_WORKSPACE,
      publishedVersionId: version.id,
      publishedAt: new Date(),
    },
  });

  res.json({ success: true, app: updated });
});

/** POST /:id/unpublish — back to private; the pin is cleared. */
/**
 * POST /:id/restore — move HEAD back to an earlier version.
 *
 * A pointer move, never a copy. `@@unique([appId, contentHash])` makes
 * re-inserting an old build as a new row impossible by design, so restore
 * declares which immutable version is current rather than duplicating content.
 * That also means restoring is free and endlessly reversible: every version
 * stays in the list, including the one you restored away from.
 *
 * Deliberately does NOT touch `publishedVersionId`. Head is what the owner and
 * the agent work on; the pin is what everyone else sees. Rolling back your own
 * draft must not silently republish something different to the workspace —
 * un-publishing is its own explicit act.
 *
 * Because the move leaves no trace in the data it touches, the act itself is
 * recorded as an `ArtifactAppRestore` in the same transaction. That row is the
 * only thing that can later explain why a thread whose newest generation is v5
 * is showing v2.
 */
artifactAppsRouter.post("/:id/restore", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = restoreBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }
  // Owner-only for now. Step 4 widens this to group-DM participants, at which
  // point the check becomes channel membership rather than ownership.
  if (app.ownerUserId !== requesterId) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }

  // The version must belong to THIS app — otherwise head could be pointed at
  // another app's build, which the payload route would then happily serve.
  const version = await prisma.artifactAppVersion.findUnique({ where: { id: parsed.data.versionId } });
  if (!version || version.appId !== app.id) {
    res.status(404).json({ success: false, error: "Version not found for this app" });
    return;
  }

  // Restoring to what is already current is a no-op, and logging it would put a
  // "Restored to v3" line in the transcript that explains nothing. Return the
  // app unchanged rather than 400 — the caller asked for a state that holds.
  if (app.headVersionId === version.id) {
    res.json({ success: true, app, versionId: version.id, versionNumber: version.versionNumber });
    return;
  }

  const from = app.headVersionId
    ? await prisma.artifactAppVersion.findUnique({
        where: { id: app.headVersionId },
        select: { id: true, versionNumber: true },
      })
    : null;

  // One transaction: a head that moved without its event would be exactly the
  // silent rollback this table exists to prevent.
  const [updated] = await prisma.$transaction([
    prisma.artifactApp.update({
      where: { id: app.id },
      data: { headVersionId: version.id, updatedAt: new Date() },
    }),
    prisma.artifactAppRestore.create({
      data: {
        workspaceId: app.workspaceId,
        appId: app.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        fromVersionId: from?.id ?? null,
        fromVersionNumber: from?.versionNumber ?? null,
        userId: requesterId,
      },
    }),
  ]);

  log.info(`app ${app.id} head restored to v${version.versionNumber} by ${requesterId}`);
  res.json({ success: true, app: updated, versionId: version.id, versionNumber: version.versionNumber });
});

artifactAppsRouter.post("/:id/unpublish", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }
  if (app.ownerUserId !== requesterId) {
    res.status(403).json({ success: false, error: "Forbidden" });
    return;
  }

  const updated = await prisma.artifactApp.update({
    where: { id: app.id },
    data: { visibility: VISIBILITY_PRIVATE, publishedVersionId: null, publishedAt: null },
  });

  res.json({ success: true, app: updated });
});

/** GET /?scope=mine|workspace — gallery listings. Manifests only, never bytes. */
artifactAppsRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-apps", requestWorkspaceHint(req));
  if (!workspaceId) {
    res.json({ success: true, apps: [] });
    return;
  }

  const scope = req.query["scope"] === "workspace" ? "workspace" : "mine";
  const where =
    scope === "workspace"
      ? { workspaceId, visibility: VISIBILITY_WORKSPACE, isArchived: false }
      : { workspaceId, ownerUserId: requesterId, isArchived: false };

  const apps = await prisma.artifactApp.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  // A listed card renders from the manifest alone — for the workspace scope that
  // must be the PINNED version's manifest, never the owner's latest draft.
  const versionIds = apps
    .map((a) => (scope === "workspace" ? a.publishedVersionId : null))
    .filter((id): id is string => Boolean(id));

  const pinned = versionIds.length
    ? await prisma.artifactAppVersion.findMany({ where: { id: { in: versionIds } } })
    : [];
  const pinnedById = new Map(pinned.map((v) => [v.id, v]));

  const latestByApp = new Map<string, { manifest: unknown; versionNumber: number }>();
  if (scope === "mine" && apps.length) {
    const all = await prisma.artifactAppVersion.findMany({
      where: { appId: { in: apps.map((a) => a.id) } },
      orderBy: { versionNumber: "desc" },
    });
    for (const v of all) if (!latestByApp.has(v.appId)) latestByApp.set(v.appId, v);
  }

  res.json({
    success: true,
    apps: apps.map((a) => {
      const v =
        scope === "workspace"
          ? a.publishedVersionId
            ? pinnedById.get(a.publishedVersionId)
            : undefined
          : latestByApp.get(a.id);
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        visibility: a.visibility,
        ownerUserId: a.ownerUserId,
        publishedAt: a.publishedAt,
        updatedAt: a.updatedAt,
        manifest: v?.manifest ?? null,
      };
    }),
  });
});

/** GET /:id — metadata. Owners see every version; everyone else sees the pin. */
artifactAppsRouter.get("/:id", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }

  const isOwner = app.ownerUserId === requesterId;
  if (!isOwner) {
    const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-apps", requestWorkspaceHint(req));
    if (workspaceId !== app.workspaceId || app.visibility !== VISIBILITY_WORKSPACE) {
      res.status(404).json({ success: false, error: "App not found" });
      return;
    }
  }

  const versions = await prisma.artifactAppVersion.findMany({
    where: isOwner
      ? { appId: app.id }
      : { id: app.publishedVersionId ?? "__none__" },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, manifest: true, sizeBytes: true, createdAt: true },
  });

  // Restore history is DRAFT history: it names versions a non-owner is not
  // served and describes edits behind the published pin. Owners only — everyone
  // else gets an empty list rather than a shorter one, so the thread renders the
  // same way whether the feature has events or the caller has no right to them.
  const restores = isOwner
    ? await prisma.artifactAppRestore.findMany({
        where: { appId: app.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          versionId: true,
          versionNumber: true,
          fromVersionId: true,
          fromVersionNumber: true,
          userId: true,
          createdAt: true,
        },
      })
    : [];

  res.json({ success: true, app: { ...app, isOwner }, versions, restores });
});

/**
 * GET /:id/payload — the project files, and the route that makes a published app
 * usable by someone else.
 *
 * A non-owner is served the pinned version and only the pinned version: honouring
 * a caller-supplied `versionId` would let anyone who can see a published app walk
 * the owner's unpublished drafts.
 */
artifactAppsRouter.get("/:id/payload", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const app = await prisma.artifactApp.findUnique({ where: { id: req.params.id } });
  if (!app || app.isArchived) {
    res.status(404).json({ success: false, error: "App not found" });
    return;
  }

  const isOwner = app.ownerUserId === requesterId;
  if (!isOwner) {
    const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-apps", requestWorkspaceHint(req));
    const sameWorkspace = workspaceId !== null && workspaceId === app.workspaceId;
    if (!sameWorkspace || app.visibility !== VISIBILITY_WORKSPACE) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
  }

  const requestedVersionId = typeof req.query["versionId"] === "string" ? req.query["versionId"] : null;
  // Owner default is HEAD — the version they and the agent are working on —
  // falling back to the pin for apps that predate head tracking. A non-owner is
  // still served the pinned version and only that: honouring a caller-supplied
  // versionId, or serving head, would expose drafts the owner has not published.
  const versionId = isOwner
    ? (requestedVersionId ?? app.headVersionId ?? app.publishedVersionId)
    : app.publishedVersionId;

  const version = versionId
    ? await prisma.artifactAppVersion.findUnique({ where: { id: versionId } })
    : await prisma.artifactAppVersion.findFirst({
        where: { appId: app.id },
        orderBy: { versionNumber: "desc" },
      });

  if (!version || version.appId !== app.id) {
    res.status(404).json({ success: false, error: "Version not found" });
    return;
  }

  res.setHeader("Content-Type", ARTIFACT_MIME);
  const stream = gcsService.createReadStream(version.storagePath);
  stream.on("error", (err: Error) => {
    log.error(`failed streaming artifact app id=${app.id} version=${version.id}: ${err.message}`);
    if (!res.headersSent) res.status(502).json({ success: false, error: "Could not read the app" });
    else res.destroy();
  });
  stream.pipe(res);
});
