/**
 * Brand-extraction attachment routes (XYNE-66818).
 *
 * Mounted INTO `agentChatRouter`, so the paths are served under `/agent-chat`
 * exactly as if declared there. They live in their own module because
 * agent-chat.ts cannot be imported in a test without its whole dependency
 * graph — and these carry an ACL and a validation boundary that deserve tests.
 */

import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { parseBrandSummary } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { chatAttachmentRepository, designSystemRepository } from "../repositories/index.js";
import { gcsService } from "../services/storageService.js";
import { getOrgId, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { matchesAuthenticatedUserId } from "../middleware/pin-user-id-param.js";

import { createLogger } from "../logger.js";
const log = createLogger("brand-attachments");

export const brandAttachmentsRouter: Router = Router();

/** A brand summary is a few KB of JSON; anything larger is not one. */
const BRAND_SUMMARY_MAX_BYTES = 256 * 1024;

/** The DesignSystem a brand.json was already saved as, recorded on the
 *  attachment so the card stays "saved" across a reload. */
function savedDesignSystemIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const saved = (metadata as Record<string, unknown>)["savedDesignSystemId"];
  return typeof saved === "string" && saved ? saved : null;
}

/**
 * A delivered `brand.json`, validated against the BrandSummary contract.
 *
 * The Brand Review Card reads this rather than the raw attachment: the payload
 * is model-written inside a sandbox and its colours become inline style values
 * in the browser, so it is validated with the canonical implementation in
 * xyne-claw-shared. The claw-auth frontend deliberately has no workspace
 * dependencies (see SettingsTab's note that shared constants are fetched at
 * runtime), so duplicating the validator there would have meant two copies of
 * a security check drifting apart.
 *
 * Same ACL as the download route below — this exposes the same bytes.
 */
/** The caller's org: the header requireAuth stamped, falling back to their own
 *  row. Same order the chat-project routes use. */
async function resolveCallerOrgId(req: Request, requesterId: string): Promise<string | null> {
  const headerOrgId = getOrgId(req);
  if (headerOrgId) return headerOrgId;
  const row = await prisma.user
    .findFirst({ where: { id: requesterId }, select: { orgId: true } })
    .catch(() => null);
  return row?.orgId ?? null;
}

brandAttachmentsRouter.get("/attachments/:id/brand-summary", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    // A brand summary is a few KB. Refusing anything larger keeps a malformed
    // or hostile upload from being read wholly into memory to be parsed.
    // `att.size` is nullable, and a null slipped past a truthiness check — so
    // fall back to the object's own metadata rather than skipping the cap.
    // An unknown size REFUSES rather than defaulting to 0: a 0 slipped past the
    // comparison below and the object was then read whole into memory, which is
    // exactly what the cap exists to prevent.
    const declaredSize =
      att.size ?? (await gcsService.getMetadata(att.url).then((m) => m.size).catch(() => null));
    if (declaredSize === null || declaredSize === undefined) {
      res.status(413).json({ success: false, error: "Brand summary size could not be determined" });
      return;
    }
    if (declaredSize > BRAND_SUMMARY_MAX_BYTES) {
      res.status(413).json({ success: false, error: "Brand summary is too large to parse" });
      return;
    }

    const buffer = await gcsService.getFileBuffer(att.url);
    const summary = parseBrandSummary(buffer.toString("utf8"));
    if (!summary) {
      // 422, not 500: the file was read fine, it just is not a brand summary.
      res.status(422).json({ success: false, error: "Not a valid brand summary" });
      return;
    }

    // Saving is idempotent across reloads: the card's "saved" state was
    // component-only, so after a refresh the button returned and each click
    // created another org-visible DesignSystem. The id is recorded on the
    // attachment, which is the only thing that survives the reload.
    // No contrast audit here. It used to ride along, computed from brand.json
    // colours, but a saved system is audited from its tokens.css — and the two
    // read a palette differently, so a token named outside the known slot list
    // was flagged on the card and then clean once saved. The card audits the
    // token CSS it is about to store instead. XYNE-66828.
    res.json({
      success: true,
      data: summary,
      savedDesignSystemId: savedDesignSystemIdOf(att.metadata),
    });
  } catch (err) {
    log.error("[agent-chat] brand summary error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * Record which DesignSystem a brand.json was saved as.
 *
 * Without this the card's "saved" state lives only in component state, so a
 * reload brings the Save button back and every click mints another
 * org-visible design system. The attachment is the only thing that outlives
 * the component, so the id is recorded there.
 *
 * Idempotent: a second call for the same attachment keeps the FIRST id rather
 * than overwriting it, so a double-click cannot silently repoint the card at a
 * duplicate.
 */
brandAttachmentsRouter.post("/attachments/:id/brand-saved", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const designSystemId = (req.body as { designSystemId?: unknown } | undefined)?.designSystemId;
    if (typeof designSystemId !== "string" || !designSystemId.trim()) {
      res.status(400).json({ success: false, error: "designSystemId must be a non-empty string" });
      return;
    }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    const existing = savedDesignSystemIdOf(att.metadata);
    if (existing) {
      res.json({ success: true, data: { savedDesignSystemId: existing, alreadySaved: true } });
      return;
    }

    // The id is recorded on an org-visible attachment and later used to show the
    // card as saved, so it must name a design system that actually exists in the
    // caller's org — not any string they send.
    const callerOrgId = await resolveCallerOrgId(req, requesterId);
    const target = callerOrgId
      ? await designSystemRepository.findById(designSystemId.trim(), callerOrgId)
      : null;
    if (!target) {
      res.status(404).json({ success: false, error: "Design system not found" });
      return;
    }

    const metadata = (att.metadata && typeof att.metadata === "object" && !Array.isArray(att.metadata))
      ? { ...(att.metadata as Record<string, unknown>) }
      : {};
    metadata["savedDesignSystemId"] = designSystemId.trim();
    await prisma.chatAttachment.update({
      where: { id: att.id },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });

    res.json({ success: true, data: { savedDesignSystemId: designSystemId.trim(), alreadySaved: false } });
  } catch (err) {
    log.error("[agent-chat] brand saved error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

