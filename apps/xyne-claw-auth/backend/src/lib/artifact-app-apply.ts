/**
 * Approved artifact-app writes (source `custom:react-artifact`).
 *
 * `publish-app` is a write tool, so the runtime parks it as a signed pending
 * action and it executes HERE, on approval — not in xyne-claw. It has no MCP
 * connector, so like agent-tools and create-skill it is applied directly
 * against claw-auth's own tables. Every approval path (claw chat
 * `/approve-action`, Spaces flow cards, approved-write) must route through
 * this one function so the rules cannot drift between them.
 *
 * The HMAC over {serverType, tool, params, userId} proves the action is the
 * one the agent proposed for this user; it carries no authority of its own, so
 * ownership is checked against the row exactly as `POST /artifact-apps/:id/publish`
 * does.
 */

import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-app-apply");

const SERVER_TYPE = "react-artifact";
const PUBLISH_TOOL = "publish-app";
const APP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isArtifactAppAction(serverType: string, tool: string): boolean {
  return serverType === SERVER_TYPE && tool === PUBLISH_TOOL;
}

export type ArtifactAppApplyOutcome = { ok: true; message: string } | { ok: false; error: string };

export async function applyArtifactAppAction(
  tool: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<ArtifactAppApplyOutcome> {
  if (tool !== PUBLISH_TOOL) return { ok: false, error: `Unsupported app action: ${tool}` };

  const appId = typeof params["appId"] === "string" ? params["appId"].trim() : "";
  if (!APP_ID_RE.test(appId)) return { ok: false, error: "This publish request names no valid app." };

  const app = await prisma.artifactApp.findUnique({ where: { id: appId } });
  if (!app || app.isArchived) return { ok: false, error: "That app no longer exists." };
  if (app.ownerUserId !== userId) return { ok: false, error: `"${app.title}" belongs to someone else — only its owner can publish it.` };

  // Head is what the owner is looking at; apps from before head tracking fall
  // back to their newest version — the same choice the publish tool made when
  // it described the action to the user.
  const version = app.headVersionId
    ? await prisma.artifactAppVersion.findUnique({ where: { id: app.headVersionId } })
    : await prisma.artifactAppVersion.findFirst({ where: { appId: app.id }, orderBy: { versionNumber: "desc" } });
  if (!version || version.appId !== app.id) return { ok: false, error: `"${app.title}" has no version to publish.` };

  await prisma.artifactApp.update({
    where: { id: app.id },
    data: { visibility: "WORKSPACE", publishedVersionId: version.id, publishedAt: new Date() },
  });

  log.info(`app ${app.id} v${version.versionNumber} published by ${userId}`);
  return {
    ok: true,
    message:
      `Published "${app.title}" (version ${version.versionNumber}) to the workspace. Everyone in it can now ` +
      "open the app. Later updates stay private until it is published again.",
  };
}
