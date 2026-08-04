/**
 * Internal attachment-ingestion endpoint.
 *
 * Turns raw document attachments (pdf / docx / xlsx / pptx / html / csv / txt /
 * json / zip) into extracted markdown using claw's own converter pipeline
 * (`ingestAttachments`). This lets callers that only have an LLM transport —
 * e.g. the Spaces summariser calling LiteLLM directly — reuse the exact
 * extraction the agent runtime uses, instead of duplicating the parser
 * dependencies (unpdf, mammoth, exceljs, jszip, …).
 *
 * Documents only. Images need no server-side processing (the caller inlines
 * them as vision `image_url` parts); if any are sent they're simply not part of
 * the returned markdown.
 *
 * Why on claw, not claw-auth: the converter pipeline lives here alongside the
 * agent runtime that already depends on it. claw-auth just proxies.
 *
 * S2S-protected via the shared x-s2s-key middleware. Reached through claw-auth's
 * `/attachments/ingest` proxy, never directly by a browser.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { ingestAttachments, type AttachmentInput } from "../attachment-ingest.js";
import { createLogger } from "../logger.js";

const log = createLogger("attachments-ingest");

export const attachmentsRouter = Router();

/** Raised for malformed request payloads → surfaced as 400 (caller bug). */
class IngestBadRequest extends Error {}

function parseAttachments(raw: unknown): AttachmentInput[] {
  if (!Array.isArray(raw)) {
    throw new IngestBadRequest("`attachments` must be an array");
  }
  return raw.map((a, i) => {
    if (a === null || typeof a !== "object") {
      throw new IngestBadRequest(`attachments[${i}] must be an object`);
    }
    const { fileName, mimeType, data } = a as Record<string, unknown>;
    if (typeof fileName !== "string" || typeof mimeType !== "string" || typeof data !== "string") {
      throw new IngestBadRequest(`attachments[${i}] requires string fileName, mimeType and data`);
    }
    return { fileName, mimeType, data };
  });
}

attachmentsRouter.post(
  "/internal/attachments/ingest",
  validateS2SKey,
  async (req: Request, res: Response) => {
    try {
      const attachments = parseAttachments(
        (req.body as { attachments?: unknown } | undefined)?.attachments,
      );
      // Each converter resolves to an error stub rather than throwing, so a bad
      // single file never aborts the batch; ingestAttachments returns cleanly.
      const { derivedContextFiles } = await ingestAttachments(attachments, (m) => log.info(m));
      res.json({
        success: true,
        files: derivedContextFiles.map((f) => ({ path: f.path, content: f.content })),
      });
    } catch (err) {
      const status = err instanceof IngestBadRequest ? 400 : 500;
      const message = err instanceof Error ? err.message : "Internal error";
      if (status >= 500) log.error(`[attachments-ingest] failed: ${message}`);
      res.status(status).json({ success: false, error: message });
    }
  },
);
