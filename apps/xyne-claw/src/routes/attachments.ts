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
import { GCS, STORAGE } from "../config.js";
import { rebuildUrlOnTrustedOrigin } from "../lib/url-guard.js";

const log = createLogger("attachments-ingest");
const URL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = Number(process.env["ATTACHMENT_URL_DOWNLOAD_TIMEOUT_MS"] ?? 120_000);
const URL_ATTACHMENT_MAX_BYTES = Number(process.env["ATTACHMENT_URL_MAX_BYTES"] ?? 50 * 1024 * 1024);

/**
 * SSRF fence for the URL-ingest path.
 *
 * This endpoint downloads a caller-supplied URL server-side. It is S2S-guarded,
 * but that alone is not a boundary: any bug or compromise upstream would turn
 * this pod into a fetch proxy for the cluster's internal network — including the
 * GCP metadata server (169.254.169.254), which would hand out this pod's own
 * service-account credentials. The URL is only ever a storage signed URL for
 * this deployment's own bucket, so restrict it to exactly those storage hosts
 * and to https by construction rather than trusting the caller.
 *
 * The fetched URL is REBUILT from the allowlist entry that matched (plus the
 * caller's re-encoded path and query), so the host/scheme handed to `fetch`
 * come from our configuration, not from the request body.
 *
 * Hosts are matched exactly (hostname, or host:port). The public-cloud hosts
 * are derived from the same STORAGE/GCS config claw-auth signs with, covering
 * both path-style and virtual-hosted signed URLs. Extra hosts (fake-gcs in
 * dev, a custom S3 endpoint) come from ATTACHMENT_URL_ALLOWED_HOSTS as a
 * comma-separated list; only those explicitly configured hosts may use http.
 */
function hostOfUrl(raw: string): string | undefined {
  try {
    return new URL(raw).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

const URL_ATTACHMENT_CONFIGURED_HOSTS: ReadonlySet<string> = new Set(
  [
    ...(STORAGE.s3Endpoint ? [hostOfUrl(STORAGE.s3Endpoint)] : []),
    ...(GCS.fakeHost ? [hostOfUrl(GCS.fakeHost)] : []),
    ...(process.env["ATTACHMENT_URL_ALLOWED_HOSTS"] ?? "").split(","),
  ]
    .map((h) => h?.trim().toLowerCase())
    .filter((h): h is string => !!h),
);

const URL_ATTACHMENT_ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  [
    // GCS: path-style (the @google-cloud/storage default) and virtual-hosted.
    "storage.googleapis.com",
    ...(GCS.bucketName ? [`${GCS.bucketName}.storage.googleapis.com`] : []),
    // S3: virtual-hosted (the SDK default) and path-style.
    ...(STORAGE.s3BucketName ? [`${STORAGE.s3BucketName}.s3.${STORAGE.s3Region}.amazonaws.com`] : []),
    `s3.${STORAGE.s3Region}.amazonaws.com`,
    ...URL_ATTACHMENT_CONFIGURED_HOSTS,
  ].map((h) => h.toLowerCase()),
);

/**
 * Validate a caller-supplied download URL and return the URL we will actually
 * fetch: same path and query, but the scheme and host are taken from the
 * allowlist entry that matched rather than from the caller's string.
 */
function assertDownloadableUrl(raw: string, fileName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new IngestBadRequest(`Attachment "${fileName}": malformed download URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new IngestBadRequest(`Attachment "${fileName}": download URL must use https`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostWithPort = parsed.host.toLowerCase();
  // Prefer a host:port entry; fall back to a bare-hostname entry, in which case
  // the (numeric) port from the URL is carried over.
  let matchedHost: string | undefined;
  let portSuffix = "";
  for (const allowed of URL_ATTACHMENT_ALLOWED_HOSTS) {
    if (allowed === hostWithPort) {
      matchedHost = allowed;
      portSuffix = "";
      break;
    }
    if (allowed === hostname && matchedHost === undefined) {
      matchedHost = allowed;
      portSuffix = parsed.port ? `:${Number.parseInt(parsed.port, 10)}` : "";
    }
  }
  if (matchedHost === undefined) {
    throw new IngestBadRequest(
      `Attachment "${fileName}": download host "${hostname}" is not an allowed storage host`,
    );
  }
  // http:// is allowed ONLY for an explicitly configured host (dev fake-gcs,
  // custom S3 endpoint); everything else must be https so the bytes aren't
  // readable in transit.
  const scheme = parsed.protocol === "https:" ? "https:" : "http:";
  if (scheme === "http:" && !URL_ATTACHMENT_CONFIGURED_HOSTS.has(matchedHost)) {
    throw new IngestBadRequest(`Attachment "${fileName}": download URL must use https`);
  }
  const rebuilt = rebuildUrlOnTrustedOrigin(parsed, `${scheme}//${matchedHost}${portSuffix}`);
  if (!rebuilt) {
    throw new IngestBadRequest(`Attachment "${fileName}": malformed download URL`);
  }
  return new URL(rebuilt);
}

export const attachmentsRouter = Router();

/** Raised for malformed request payloads → surfaced as 400 (caller bug). */
class IngestBadRequest extends Error {}

interface AttachmentIngestRequestItem {
  fileName: string;
  mimeType: string;
  data?: string;
  url?: string;
  size?: number;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]} (${bytes} bytes)`;
}

function parseAttachments(raw: unknown): AttachmentIngestRequestItem[] {
  if (!Array.isArray(raw)) {
    throw new IngestBadRequest("`attachments` must be an array");
  }
  return raw.map((a, i) => {
    if (a === null || typeof a !== "object") {
      throw new IngestBadRequest(`attachments[${i}] must be an object`);
    }
    const { fileName, mimeType, data, url, size } = a as Record<string, unknown>;
    if (typeof fileName !== "string" || typeof mimeType !== "string") {
      throw new IngestBadRequest(`attachments[${i}] requires string fileName and mimeType`);
    }
    if (typeof data !== "string" && typeof url !== "string") {
      throw new IngestBadRequest(`attachments[${i}] requires either string data or url`);
    }
    if (typeof data === "string" && typeof url === "string") {
      throw new IngestBadRequest(`attachments[${i}] must not include both data and url`);
    }
    if (size !== undefined && typeof size !== "number") {
      throw new IngestBadRequest(`attachments[${i}] size must be a number when provided`);
    }
    return {
      fileName,
      mimeType,
      ...(typeof data === "string" ? { data } : {}),
      ...(typeof url === "string" ? { url } : {}),
      ...(typeof size === "number" ? { size } : {}),
    };
  });
}

async function downloadUrlAttachment(item: AttachmentIngestRequestItem, index: number): Promise<AttachmentInput> {
  if (typeof item.data === "string") {
    return { fileName: item.fileName, mimeType: item.mimeType, data: item.data };
  }
  if (!item.url) {
    throw new IngestBadRequest(`attachments[${index}] requires either string data or url`);
  }
  if (typeof item.size === "number" && item.size > URL_ATTACHMENT_MAX_BYTES) {
    throw new IngestBadRequest(
      `Attachment "${item.fileName}" (${item.mimeType}, ${formatBytes(item.size)}) exceeds URL ingest limit ${formatBytes(URL_ATTACHMENT_MAX_BYTES)}`,
    );
  }

  // Validate BEFORE fetching. Errors deliberately name the host, never the URL —
  // a signed URL is a bearer credential and must not reach logs or the model.
  const downloadUrl = assertDownloadableUrl(item.url, item.fileName);
  const response = await fetch(downloadUrl, {
    redirect: "error", // a 302 to an internal host would bypass the allowlist
    signal: AbortSignal.timeout(URL_ATTACHMENT_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Download failed for "${item.fileName}" (${item.mimeType}): signed URL returned HTTP ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  const declaredBytes = contentLength ? Number(contentLength) : undefined;
  if (declaredBytes !== undefined && Number.isFinite(declaredBytes) && declaredBytes > URL_ATTACHMENT_MAX_BYTES) {
    throw new IngestBadRequest(
      `Attachment "${item.fileName}" (${item.mimeType}, ${formatBytes(declaredBytes)}) exceeds URL ingest limit ${formatBytes(URL_ATTACHMENT_MAX_BYTES)}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > URL_ATTACHMENT_MAX_BYTES) {
    throw new IngestBadRequest(
      `Attachment "${item.fileName}" (${item.mimeType}, ${formatBytes(buffer.length)}) exceeds URL ingest limit ${formatBytes(URL_ATTACHMENT_MAX_BYTES)}`,
    );
  }
  return { fileName: item.fileName, mimeType: item.mimeType, data: buffer.toString("base64") };
}

export async function materializeIngestAttachments(raw: unknown): Promise<AttachmentInput[]> {
  const requestAttachments = parseAttachments(raw);
  return Promise.all(requestAttachments.map(downloadUrlAttachment));
}

attachmentsRouter.post(
  "/internal/attachments/ingest",
  validateS2SKey,
  async (req: Request, res: Response) => {
    try {
      const attachments = await materializeIngestAttachments(
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
