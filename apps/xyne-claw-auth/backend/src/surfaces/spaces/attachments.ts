/**
 * Outbound attachment shaping for the Spaces surface: enforce the 10k char
 * message cap (overflow -> PDF), the 10-file multipart cap (overflow -> zip
 * bundle / PDF gallery), and resolve bare @Name mentions before posting.
 * Extracted from routes/webhook.ts (2026-07-22 refactor session 1.4).
 */
import JSZip from "jszip";
import { createLogger } from "../../logger.js";
import { spacesDbAvailable } from "../../lib/spaces-db.js";
import { renderAttachmentsToPdf } from "../../lib/result-pdf.js";
import { renderMarkdownToHtml } from "../../lib/result-html.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../../lib/mention-transform.js";
import { buildSpacesMentionLookups, buildSpacesMentionLookupsDb } from "../../lib/mention-lookups.js";

const log = createLogger("spaces-attachments");


/**
 * Spaces backend caps `Message.content` at 10,000 chars (enforced in its
 * messageRepository.create — `validateString(..., 'content', 10000)`).
 * Posting longer text returns an opaque 500, not 413, so the user sees
 * nothing. We mirror the same 9,500-char buffer the Spaces team uses
 * elsewhere (notificationService.MAX_MESSAGE_LENGTH = 9500) and convert
 * anything longer into a PDF attachment.
 */
export const MAX_MESSAGE_CHARS = 9500;

/**
 * Spaces' multipart `/files/filesUpload` endpoint is fronted by multer with
 * `files: 10` per request (see `backend/src/middleware/upload.ts:8`). Any
 * count above that triggers a 500 "Too many files". Threshold matches that
 * server-side limit exactly — anything ≤10 passes through untouched.
 *
 * When an agent emits more than this (typically sandbox/playwright runs
 * with many screenshots), we bundle ALL of them into one PDF via
 * `renderAttachmentsToPdf` and send that single PDF as the only attachment.
 * Result: never lose an over-quota delivery; the chat thread stays under
 * the multer cap; the user can still browse the originals via the bundle.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export interface OutgoingAttachment {
  data: string;       // base64
  mimeType: string;
  fileName: string;
}

export function isImageAttachment(a: OutgoingAttachment): boolean {
  return a.mimeType.toLowerCase().startsWith("image/");
}

/**
 * Bundle attachments into a single .zip, preserving their real bytes. Unlike
 * the PDF gallery (which can only embed images and silently drops everything
 * else), a zip works for ANY file type — PDFs, CSVs, docx, etc. Filenames are
 * de-duplicated so two files sharing a name don't clobber each other.
 */
export async function zipAttachmentsToBuffer(attachments: OutgoingAttachment[]): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const a of attachments) {
    let name = a.fileName?.trim() || "file";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);
    zip.file(name, Buffer.from(a.data, "base64"));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Prepare an agent-result message for posting to Spaces:
 *
 *   - If the text body exceeds the 10K Spaces cap, render the FULL body
 *     into a PDF, attach it, and replace the chat body with a short
 *     stub + a preview of the first ~600 chars so the thread isn't empty.
 *   - If the total attachment count exceeds the Spaces cap, slice to the
 *     first N and annotate the body.
 *
 * Returns `{ text, attachments }` ready to feed into either the JSON or
 * multipart post path. Callers should switch to the multipart path
 * whenever `attachments.length > 0` after this returns.
 */
export async function prepareAgentResultForPosting(
  rawText: string,
  rawAttachments: OutgoingAttachment[] | undefined,
  meta: {
    agentSlug?: string;
    /** Spaces session token of the human who triggered the agent. When
     *  present we use it to resolve plain `@Name` mentions against
     *  `/api/users/search` BEFORE running the bracketed-form expander —
     *  so an LLM that emitted bare `@Anirudh Naruka` (without the
     *  required `[userId]`) still produces a clickable, notifying tag.
     *  When absent (no user context — e.g. cron-triggered runs), we
     *  skip resolution and behave as today. */
    senderSpacesToken?: string;
    senderSpacesSessionId?: string;
    /** Workspace scope for the user-search call. Required when senderSpacesToken
     *  is set — otherwise the search isn't workspace-scoped and could leak. */
    senderWorkspaceId?: string;
    /** The agent's own workspace — used to scope name resolution for headless
     *  runs (no human sender), derived from the agent's app user. */
    agentWorkspaceId?: string;
  } = {},
): Promise<{ text: string; attachments: OutgoingAttachment[] }> {
  // Resolve unbracketed `@Name` (e.g. the LLM wrote `@Anirudh Naruka`) →
  // `@Name[userId]` via Spaces' user-search, using the triggering human's
  // session token (reliably available — getSpacesAuthForUser refreshes an
  // expired JWT). Limit=2 → ambiguous names are left as-is (no false pings).
  // Then the HTML expander below lifts the bracketed form into the mention span.
  // Resolve via the human's session token when we have one; otherwise fall back
  // to the direct-DB reader (headless runs — event triggers, cron, automations —
  // have only the agent's app token, which Spaces' user endpoints reject with a
  // 401, so without this their `@Name` mentions stayed dead text).
  let resolved = rawText;
  const lookups = meta.senderSpacesToken
    ? buildSpacesMentionLookups({
        token: meta.senderSpacesToken,
        ...(meta.senderSpacesSessionId ? { sessionId: meta.senderSpacesSessionId } : {}),
        ...(meta.senderWorkspaceId ? { workspaceId: meta.senderWorkspaceId } : {}),
      })
    : spacesDbAvailable()
      ? buildSpacesMentionLookupsDb(meta.agentWorkspaceId)
      : null;
  log.info(
    `[webhook/result] mention lookup branch=${meta.senderSpacesToken ? "sender-token" : lookups ? "db-fallback" : "none"} agent=${meta.agentSlug ?? "(unknown)"} senderWorkspaceId=${meta.senderWorkspaceId ?? "(none)"} agentWorkspaceId=${meta.agentWorkspaceId ?? "(none)"} rawLen=${rawText.length}`,
  );
  if (!lookups && /(^|[^A-Za-z0-9_>])@[A-Za-z0-9._%+\-]+/.test(rawText)) {
    log.warn(
      `[webhook/result] mention resolution skipped with @-like text: no sender token and Spaces DB unavailable agent=${meta.agentSlug ?? "(unknown)"}`,
    );
  }
  if (lookups) {
    resolved = await resolveUnboundMentions(resolved, lookups);
  }

  // Then: expand mention shorthand (e.g. `@Name[userId]`) into the HTML span
  // Spaces needs to render a clickable, notifying mention. Done here so every
  // postMessage/updateMessage/multipart caller below gets the same treatment.
  // Idempotent on already-expanded HTML.
  let text = expandSpacesMentions(resolved);
  let attachments: OutgoingAttachment[] = rawAttachments ? [...rawAttachments] : [];

  // Track the length-fallback attachment separately so the attachment-bundle
  // step below doesn't accidentally fold it into the bundle. It's the agent's
  // PRIMARY response and should stay a standalone attachment.
  let lengthAttachment: OutgoingAttachment | null = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 1) Body too long → render full body to a standalone HTML attachment,
  //    replace body with stub. HTML (vs the old PDF walker) lets the browser
  //    own layout: tables, code blocks, nested lists render correctly with
  //    no custom walker, and we reuse the same template as create-html-report
  //    so length-fallback artifacts look identical to deliberate reports.
  if (text.length > MAX_MESSAGE_CHARS) {
    const htmlBuffer = await renderMarkdownToHtml(text, {
      title: "Agent Response",
      subtitle: [
        meta.agentSlug ? `Agent: ${meta.agentSlug}` : null,
        `Generated: ${new Date().toISOString()}`,
        `Length: ${text.length.toLocaleString()} chars`,
      ].filter(Boolean).join("  ·  "),
    });
    lengthAttachment = {
      data: htmlBuffer.toString("base64"),
      mimeType: "text/html",
      fileName: `agent-response-${stamp}.html`,
    };
    const preview = text.slice(0, 600).replace(/\s+$/, "");
    text =
      `_Response was ${text.length.toLocaleString()} characters — over the ` +
      `${MAX_MESSAGE_CHARS.toLocaleString()}-char Spaces limit. Full answer ` +
      `attached as an HTML file (open in any browser)._\n\n${preview}${text.length > 600 ? "…" : ""}`;
  }

  // 2) Too many original attachments → bundle to fit under Spaces' 10-file
  //    multer cap WITHOUT dropping any bytes:
  //      • Screenshots (image/*) → one browsable PDF gallery (only images
  //        embed cleanly; this is the "screenshots can live in the HTML/PDF"
  //        path).
  //      • Everything else (PDF, CSV, docx, …) → one .zip, so the real bytes
  //        survive. The old all-into-PDF path silently dropped non-image files
  //        (they only got a filename listing), which is the breakage we're
  //        fixing.
  //    Worst case this yields 2 bundle files (gallery + zip), both under cap.
  //    Length-HTML (if any) is kept separate and re-prepended after this step.
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    const originalCount = attachments.length;
    const screenshots = attachments.filter(isImageAttachment);
    const others = attachments.filter((a) => !isImageAttachment(a));
    const bundled: OutgoingAttachment[] = [];

    if (screenshots.length > 0) {
      const galleryBuffer = await renderAttachmentsToPdf(screenshots, {
        title: "Screenshots",
        subtitle: [
          meta.agentSlug ? `Agent: ${meta.agentSlug}` : null,
          `Generated: ${new Date().toISOString()}`,
          `Count: ${screenshots.length} image(s)`,
        ].filter(Boolean).join("  ·  "),
      });
      bundled.push({
        data: galleryBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileName: `screenshots-${screenshots.length}-${stamp}.pdf`,
      });
    }

    if (others.length > 0) {
      const zipBuffer = await zipAttachmentsToBuffer(others);
      bundled.push({
        data: zipBuffer.toString("base64"),
        mimeType: "application/zip",
        fileName: `attachments-${others.length}-files-${stamp}.zip`,
      });
    }

    attachments = bundled;
    const parts: string[] = [];
    if (screenshots.length > 0) parts.push(`${screenshots.length} screenshot(s) bundled as a PDF`);
    if (others.length > 0) parts.push(`${others.length} file(s) zipped`);
    text +=
      `\n\n_${originalCount} attachments exceeded Spaces' ${MAX_ATTACHMENTS_PER_MESSAGE}-file ` +
      `per-message limit — ${parts.join(" and ")}._`;
  }

  // 3) Re-prepend the length-PDF so it sits as the first attachment.
  const finalAttachments = lengthAttachment ? [lengthAttachment, ...attachments] : attachments;

  return { text, attachments: finalAttachments };
}

/**
 * Retry the given async fetch operation once on 5xx responses. Spaces
 * occasionally throws transient `500 Internal server error` on
 * /chat/postMessage (observed in prod ~5x/day) — a single 2-second backoff
 * recovers most of them. 4xx errors are NOT retried — they're caller bugs
 * that won't fix themselves.
 *
 * `fn` must throw an Error whose message starts with "Spaces app API NNN:"
 * — the format used by spacesAppFetch / spacesAppFetchMultipart below.
 */
