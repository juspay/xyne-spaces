/**
 * S2S read-back of a conversation's current app, for the `create-app` tool.
 *
 * The tool runs in xyne-claw, which is stateless and has no database — it is a
 * pure validator by design. But an *incremental* update has to start from the
 * code that is already there, and the agent never sees that code: the tool
 * result carries only the manifest (file paths), while the bytes go to GCS. So
 * every "change the header colour" regenerated the whole project from
 * conversational memory — thousands of output tokens, truncation on large apps,
 * and bugs from two iterations ago quietly reappearing.
 *
 * This is the read half that closes that gap. It is keyed by CONVERSATION, not
 * by app id, because that is the only identifier the tool has: Step 1 made a
 * conversation own exactly one app, which is what lets `:convId` be
 * unambiguous.
 *
 * Strictly S2S and strictly read-only. It serves HEAD — the version the owner
 * and the agent are working on, which is what makes "restore v2, now add X"
 * edit v2 rather than the newest build.
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { gcsService } from "../services/storageService.js";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-apps-internal");
export const artifactAppsInternalRouter: Router = Router();

/**
 * Resolve a conversation to the app version the agent should build on.
 *
 * Head, not newest: `headVersionId` moves backward on restore, and an update
 * that silently based on the highest version number would undo the rollback the
 * user just performed. Falls back to the newest version only for apps created
 * before head tracking existed.
 */
async function resolveHeadVersion(conversationId: string) {
  const app = await prisma.artifactApp.findUnique({ where: { conversationId } });
  if (!app || app.isArchived) return null;

  const version = app.headVersionId
    ? await prisma.artifactAppVersion.findUnique({ where: { id: app.headVersionId } })
    : await prisma.artifactAppVersion.findFirst({
        where: { appId: app.id },
        orderBy: { versionNumber: "desc" },
      });

  if (!version || version.appId !== app.id) return null;
  return { app, version };
}

/**
 * GET /by-conversation/:convId/payload — the full project the agent should edit.
 *
 * Returns the stored payload verbatim (it was canonicalized through
 * `buildReactArtifact` before being written, so it is already exactly what the
 * validator approved) plus the identifiers the caller needs to reason about
 * what it is holding.
 */
artifactAppsInternalRouter.get(
  "/by-conversation/:convId/payload",
  async (req: Request<{ convId: string }>, res: Response): Promise<void> => {
    const found = await resolveHeadVersion(req.params.convId);
    if (!found) {
      res.status(404).json({ success: false, error: "No app for this conversation" });
      return;
    }
    const { app, version } = found;

    let raw: Buffer;
    try {
      raw = await gcsService.getFileBuffer(version.storagePath);
    } catch (err) {
      log.error(`failed reading head payload app=${app.id} version=${version.id}: ${String(err)}`);
      res.status(502).json({ success: false, error: "Could not read the current app" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(502).json({ success: false, error: "Stored app payload is not valid JSON" });
      return;
    }

    res.json({
      success: true,
      appId: app.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      payload,
    });
  },
);
