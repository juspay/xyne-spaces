/**
 * Persist a generated artifact onto the app it was built for.
 *
 * `create-app` stamps the target onto the manifest: a freshly minted `appId`
 * (`newApp: true`) on a create, or the id of the user's existing app on an
 * update. Apps used to be keyed by conversation — one per thread — which made
 * it impossible to build a second app in a chat or to keep working on an app
 * from anywhere but the thread that created it. Addressing by id removes both.
 *
 * Every later generation of the same app becomes a VERSION of it rather than an
 * unrelated copy, so the Library does not fill with dead iterations.
 *
 * It runs in the assistant-result path rather than inside the tool because the
 * tool executes in xyne-claw (stateless, no database) and must stay a pure
 * validator, while this needs Prisma, the workspace lookup, and GCS — all of
 * which live here, next to the code that already writes the attachment.
 */

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { gcsService } from "../services/storageService.js";
import { getWorkspaceIdForUser } from "./spaces-db.js";
import { buildReactArtifact } from "xyne-claw-shared/tools/react-artifact";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-app-session");

const ARTIFACT_MIME = "application/json";
const MAX_TITLE = 120;

import { isChatConversation } from "./conversation-kind.js";

export { isChatConversation };

/** Where a version's bytes live. Copied, never referenced from the attachment:
 *  an app must not break because someone deleted the conversation that made it
 *  (the same rule the explicit Save path follows). */
function storagePathFor(appId: string): string {
  return `artifact-apps/${appId}/${randomUUID()}.json`;
}

export interface SessionAppResult {
  appId: string;
  versionId: string;
  versionNumber: number;
  /** True on the generation that created the app, false when it versioned one. */
  created: boolean;
}

/** Which app a build is for, as `create-app` stamped it on the manifest. */
export interface ArtifactAppTarget {
  appId?: unknown;
  newApp?: unknown;
}

/** Same shape the tool mints and accepts; anything else is not an id we wrote. */
const APP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Attach a freshly generated artifact to its app, creating that app when the
 * tool minted a new id for it.
 *
 * Ownership is re-checked here even though the tool checked it: the tool runs in
 * another service, and this is the write that actually lands. A build aimed at
 * an app the user does not own is NOT versioned onto it — it stays a plain
 * attachment.
 *
 * Returns null — never throws — when the artifact should not become an app
 * (non-chat conversation, unvalidatable payload, no workspace, foreign or
 * missing target) or when something goes wrong. A failure here must not lose
 * the user's artifact: the attachment is still written and still renders, it
 * simply is not yet an app.
 */
export async function attachArtifactToApp(input: {
  conversationId: string | null | undefined;
  userId: string;
  /** Raw artifact JSON — the same bytes written to the chat attachment. */
  payload: Buffer;
  /** The `reactArtifact` manifest from the attachment metadata. */
  target: ArtifactAppTarget;
  /** Request's verified Spaces workspace — disambiguates two-membership users. */
  workspaceId?: string;
}): Promise<SessionAppResult | null> {
  const { conversationId, userId, payload, target, workspaceId: workspaceHint } = input;
  if (!isChatConversation(conversationId) || !userId) return null;

  // Re-validate rather than trust the bytes, exactly as the Save path does, and
  // persist what the validator approved rather than the original buffer.
  let canonical: Buffer;
  let manifest: unknown;
  let title: string;
  let icon: string | null;
  try {
    const built = buildReactArtifact(JSON.parse(payload.toString("utf8")) as Record<string, unknown>);
    canonical = Buffer.from(JSON.stringify(built.payload), "utf8");
    manifest = built.manifest;
    title = built.payload.title.slice(0, MAX_TITLE);
    icon = built.payload.icon ?? null;
  } catch (err) {
    log.warn(`artifact failed validation, not attaching to an app: ${String(err)}`);
    return null;
  }

  const workspaceId = await getWorkspaceIdForUser(userId, "artifact-apps", workspaceHint);
  if (!workspaceId) return null;

  const contentHash = createHash("sha256").update(canonical).digest("hex");

  try {
    const appId = typeof target.appId === "string" && APP_ID_RE.test(target.appId) ? target.appId : null;

    if (!appId) {
      // A build from a xyne-claw that predates app ids (deploy skew). Become a
      // new app rather than guess which one it meant.
      return await createSessionApp({
        workspaceId,
        userId,
        title,
        icon,
        canonical,
        manifest,
        contentHash,
      });
    }

    const existing = await prisma.artifactApp.findUnique({ where: { id: appId } });

    if (!existing) {
      // Only a create may bring an app into being, and only under the id the
      // tool minted for it. An update whose app vanished stays an attachment.
      if (target.newApp !== true) {
        log.warn(`update targeted missing app ${appId}; not versioning`);
        return null;
      }
      return await createSessionApp({
        id: appId,
        workspaceId,
        userId,
        title,
        icon,
        canonical,
        manifest,
        contentHash,
      });
    }

    if (existing.isArchived || existing.ownerUserId !== userId) {
      log.warn(`user ${userId} cannot write app ${appId}; not versioning`);
      return null;
    }

    return await appendSessionVersion({ app: existing, userId, icon, canonical, manifest, contentHash });
  } catch (err) {
    log.error(`failed to attach artifact to an app (conversation ${conversationId}): ${String(err)}`);
    return null;
  }
}

async function createSessionApp(input: {
  /** The id `create-app` minted, so the agent can already address the app. */
  id?: string;
  workspaceId: string;
  userId: string;
  title: string;
  icon: string | null;
  canonical: Buffer;
  manifest: unknown;
  contentHash: string;
}): Promise<SessionAppResult | null> {
  const app = await prisma.artifactApp.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      workspaceId: input.workspaceId,
      ownerUserId: input.userId,
      title: input.title,
      ...(input.icon ? { icon: input.icon } : {}),
      // Created, never shared. Auto-materializing must not auto-publish —
      // publishing stays a deliberate act.
      visibility: "PRIVATE",
    },
  });

  const path = storagePathFor(app.id);
  try {
    await gcsService.uploadFile(input.canonical, path, ARTIFACT_MIME);
  } catch (err) {
    // Don't leave a titled app with nothing behind it.
    await prisma.artifactApp.delete({ where: { id: app.id } }).catch(() => undefined);
    log.error(`failed storing first version for app ${app.id}: ${String(err)}`);
    return null;
  }

  const version = await prisma.artifactAppVersion.create({
    data: {
      workspaceId: app.workspaceId,
      appId: app.id,
      versionNumber: 1,
      manifest: input.manifest as object,
      storagePath: path,
      contentHash: input.contentHash,
      sizeBytes: input.canonical.byteLength,
      createdBy: input.userId,
    },
  });

  await prisma.artifactApp.update({
    where: { id: app.id },
    data: { headVersionId: version.id },
  });

  log.info(`app created ${app.id}`);
  return { appId: app.id, versionId: version.id, versionNumber: 1, created: true };
}

async function appendSessionVersion(input: {
  app: { id: string; workspaceId: string; icon: string | null };
  userId: string;
  /** The agent's pick for THIS build. Adopted only if the app has no icon yet —
   *  an icon the user chose (or an earlier build set) is never replaced. */
  icon: string | null;
  canonical: Buffer;
  manifest: unknown;
  contentHash: string;
}): Promise<SessionAppResult> {
  const { app } = input;

  // A byte-identical rebuild is the same version, not a new one — the agent
  // regenerates unchanged projects readily. Head still moves to it so the
  // pointer reflects what this turn produced.
  const duplicate = await prisma.artifactAppVersion.findUnique({
    where: { appId_contentHash: { appId: app.id, contentHash: input.contentHash } },
  });
  if (duplicate) {
    await prisma.artifactApp.update({
      where: { id: app.id },
      data: { headVersionId: duplicate.id },
    });
    return {
      appId: app.id,
      versionId: duplicate.id,
      versionNumber: duplicate.versionNumber,
      created: false,
    };
  }

  const last = await prisma.artifactAppVersion.findFirst({
    where: { appId: app.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  const path = storagePathFor(app.id);
  await gcsService.uploadFile(input.canonical, path, ARTIFACT_MIME);

  const version = await prisma.artifactAppVersion.create({
    data: {
      workspaceId: app.workspaceId,
      appId: app.id,
      versionNumber,
      manifest: input.manifest as object,
      storagePath: path,
      contentHash: input.contentHash,
      sizeBytes: input.canonical.byteLength,
      // The person whose turn produced it — not necessarily the app's owner,
      // which is what makes per-author attribution work once threads are shared.
      createdBy: input.userId,
    },
  });

  await prisma.artifactApp.update({
    where: { id: app.id },
    data: {
      headVersionId: version.id,
      updatedAt: new Date(),
      ...(!app.icon && input.icon ? { icon: input.icon } : {}),
    },
  });

  log.info(`app ${app.id} advanced to v${versionNumber}`);
  return { appId: app.id, versionId: version.id, versionNumber, created: false };
}
