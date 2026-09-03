/**
 * One app per conversation.
 *
 * `create-app` has no update path — every call emits a complete project — so
 * before this a thread that iterated on one app produced N unrelated apps
 * (observed: five copies of "Univer Spreadsheet" in a single conversation).
 * Each was a full re-imagining, so "fix the header" could silently undo work
 * from two turns earlier, and the Library filled with dead iterations.
 *
 * This turns the second and later generations in a thread into VERSIONS of the
 * first app instead. Nothing about the tool or the wire format changes: the
 * attachment still carries the whole project. We simply notice, at persist
 * time, that this conversation already owns an app.
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

/**
 * Conversation id prefixes that are not user-facing chat threads and must never
 * materialize an app: `scheduled_` is a cron firing, `app_` is an artifact app
 * invoking an agent of its own. Both share the assistant-result path, and an
 * app silently appearing in someone's Library from a nightly job would be
 * baffling. Mirrors the prefix checks the runtime already keys behaviour off.
 */
const NON_CHAT_PREFIXES = ["scheduled_", "app_"] as const;

export function isChatConversation(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  return !NON_CHAT_PREFIXES.some((prefix) => conversationId.startsWith(prefix));
}

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

/**
 * Attach a freshly generated artifact to its conversation's app, creating that
 * app on the first generation.
 *
 * Returns null — never throws — when the artifact should not be session-scoped
 * (non-chat conversation, unvalidatable payload, no workspace) or when
 * something goes wrong. A failure here must not lose the user's artifact: the
 * attachment is still written and still renders, it simply is not yet an app.
 */
export async function attachArtifactToSessionApp(input: {
  conversationId: string | null | undefined;
  userId: string;
  /** Raw artifact JSON — the same bytes written to the chat attachment. */
  payload: Buffer;
}): Promise<SessionAppResult | null> {
  const { conversationId, userId, payload } = input;
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
    log.warn(`artifact failed validation, not session-scoping: ${String(err)}`);
    return null;
  }

  const workspaceId = await getWorkspaceIdForUser(userId, "artifact-apps");
  if (!workspaceId) return null;

  const contentHash = createHash("sha256").update(canonical).digest("hex");

  try {
    const existing = await prisma.artifactApp.findUnique({
      where: { conversationId: conversationId as string },
    });

    if (!existing) {
      return await createSessionApp({
        conversationId: conversationId as string,
        workspaceId,
        userId,
        title,
        icon,
        canonical,
        manifest,
        contentHash,
      });
    }

    return await appendSessionVersion({ app: existing, userId, icon, canonical, manifest, contentHash });
  } catch (err) {
    log.error(`failed to session-scope artifact for ${conversationId}: ${String(err)}`);
    return null;
  }
}

async function createSessionApp(input: {
  conversationId: string;
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
      workspaceId: input.workspaceId,
      ownerUserId: input.userId,
      conversationId: input.conversationId,
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

  log.info(`session app created ${app.id} for ${input.conversationId}`);
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

  log.info(`session app ${app.id} advanced to v${versionNumber}`);
  return { appId: app.id, versionId: version.id, versionNumber, created: false };
}
