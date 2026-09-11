/**
 * Proof bundle for `/experiment findings`.
 *
 * The findings markdown alone is not usable output: every proof artifact was
 * delivered as a SEPARATE thread attachment, scattered across hours of epoch
 * messages, so reconstructing "which file proves which finding" means scrolling
 * the thread by hand. Worse, a proof whose message is buried is effectively
 * lost — which is how the first three runs ended up with 125 of 129 proof paths
 * pointing at files nobody could open.
 *
 * This walks the thread's attachments, matches them back to the findings that
 * cite them, and returns ONE zip laid out by epoch:
 *
 *   findings.md            — the full ledger (same content as the .md reply)
 *   MANIFEST.md            — finding -> file, including what is missing and why
 *   epoch-01/proof_x.cjs
 *   epoch-02/bench_y.js
 *   unmatched/notes.md     — delivered in-thread but not cited by any finding
 */
import JSZip from "jszip";
import { errMsg } from "./errors.js";
import type { ExperimentFinding, ExperimentRun } from "@prisma/client";
import { interact, spacesFetchBuffer, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { createLogger } from "../logger.js";

const log = createLogger("experiment-bundle");

/** Spaces' upload path and the chat surface both suffer with very large files,
 *  and a runaway bundle would stall the reply. Proof artifacts are scripts and
 *  logs — a bundle this size already means something is wrong. */
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_SINGLE_BYTES = 15 * 1024 * 1024;
const MAX_ATTACHMENTS_SCANNED = 500;

interface ThreadAttachment {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  entityId: string;
}

export interface BundleEntry {
  findingId: string;
  epoch: number;
  title: string;
  citedPath: string | null;
  /** Path inside the zip, or null when nothing could be included. */
  zipPath: string | null;
  status: "included" | "not-delivered" | "no-proof-path" | "too-large" | "download-failed";
}

export interface ProofBundle {
  buffer: Buffer;
  filename: string;
  entries: BundleEntry[];
  includedCount: number;
  missingCount: number;
}

function basename(p: string): string {
  return (p.split("/").pop() ?? p).trim().toLowerCase();
}

function epochDir(epoch: number): string {
  return `epoch-${String(epoch).padStart(2, "0")}`;
}

/** Every non-deleted attachment in the thread, newest first.
 *
 *  Queried BOTH ways, exactly as the spaces-thread-attachments tool does:
 *  denormalised `conversationId` on the attachment row, and `entityId` against
 *  the thread's messages. Neither alone is complete — older rows predate the
 *  denormalised column, and the message hop misses attachments whose message
 *  was pruned. */
async function listThreadAttachments(
  conversationId: string,
  auth: SpacesAuthContext,
): Promise<ThreadAttachment[]> {
  const direct = (await interact({
    model: "messageAttachment",
    operation: "findMany",
    where: { conversationId: { equals: conversationId }, isDeleted: { equals: false } },
    orderBy: [{ createdAt: "desc" }],
    take: MAX_ATTACHMENTS_SCANNED,
  }, auth).catch(() => null)) as ThreadAttachment[] | null;

  const messages = (await interact({
    model: "message",
    operation: "findMany",
    where: { conversationId: { equals: conversationId }, hasAttachment: { equals: true } },
    orderBy: [{ createdAt: "desc" }],
    take: MAX_ATTACHMENTS_SCANNED,
  }, auth).catch(() => null)) as Array<{ messageId?: string }> | null;

  const messageIds = (messages ?? []).map((m) => m.messageId).filter((id): id is string => Boolean(id));
  const byMessage = messageIds.length > 0
    ? ((await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { entityId: { in: messageIds }, isDeleted: { equals: false } },
        orderBy: [{ createdAt: "desc" }],
        take: MAX_ATTACHMENTS_SCANNED,
      }, auth).catch(() => null)) as ThreadAttachment[] | null)
    : null;

  const merged = new Map<string, ThreadAttachment>();
  for (const row of [...(direct ?? []), ...(byMessage ?? [])]) {
    if (row?.id && !merged.has(row.id)) merged.set(row.id, row);
  }
  return [...merged.values()];
}

export async function buildExperimentProofBundle(args: {
  run: ExperimentRun;
  findings: ExperimentFinding[];
  findingsMarkdown: string;
  conversationId: string;
  /** The requester's Spaces credentials. REQUIRED: this runs in the claw-auth
   *  API process, which — unlike a spawned MCP server — has no
   *  XYNE_SPACES_TOKEN in its environment, so an unauthenticated call would
   *  throw "Spaces auth token missing" and silently degrade to markdown. */
  auth: SpacesAuthContext;
}): Promise<ProofBundle | null> {
  const { run, findings, findingsMarkdown, conversationId, auth } = args;

  let attachments: ThreadAttachment[];
  try {
    attachments = await listThreadAttachments(conversationId, auth);
  } catch (err) {
    log.warn(`[experiment] bundle: attachment listing failed id=${run.id}: ${errMsg(err)}`);
    return null;
  }
  if (attachments.length === 0) return null;

  // Newest-first ordering means the FIRST row for a name is the freshest
  // delivery — a re-delivered proof supersedes the earlier one.
  const byName = new Map<string, ThreadAttachment>();
  for (const a of attachments) {
    const key = basename(a.originalFilename ?? "");
    if (key && !byName.has(key)) byName.set(key, a);
  }

  const zip = new JSZip();
  const entries: BundleEntry[] = [];
  const downloaded = new Map<string, Buffer>();
  const usedZipPaths = new Set<string>();
  const claimed = new Set<string>();
  let totalBytes = 0;

  for (const finding of findings) {
    const cited = finding.proofArtifactPath?.trim() || null;
    const base = { findingId: finding.id, epoch: finding.epoch, title: finding.title, citedPath: cited };

    if (!cited) {
      entries.push({ ...base, zipPath: null, status: "no-proof-path" });
      continue;
    }
    const key = basename(cited);
    const attachment = byName.get(key);
    if (!attachment) {
      entries.push({ ...base, zipPath: null, status: "not-delivered" });
      continue;
    }
    if (attachment.size > MAX_SINGLE_BYTES || totalBytes + attachment.size > MAX_TOTAL_BYTES) {
      entries.push({ ...base, zipPath: null, status: "too-large" });
      continue;
    }

    let buf = downloaded.get(attachment.id);
    if (!buf) {
      try {
        const dl = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(attachment.id)}/download`, auth);
        buf = dl.buffer;
        downloaded.set(attachment.id, buf);
        totalBytes += buf.length;
      } catch (err) {
        log.warn(`[experiment] bundle: download failed attachment=${attachment.id}: ${errMsg(err)}`);
        entries.push({ ...base, zipPath: null, status: "download-failed" });
        continue;
      }
    }

    // One physical file per epoch dir; a proof cited by two findings in the
    // same epoch is stored once and referenced twice in the manifest.
    let zipPath = `${epochDir(finding.epoch)}/${attachment.originalFilename}`;
    if (usedZipPaths.has(zipPath) && !claimed.has(`${finding.epoch}:${attachment.id}`)) {
      const dot = attachment.originalFilename.lastIndexOf(".");
      const stem = dot > 0 ? attachment.originalFilename.slice(0, dot) : attachment.originalFilename;
      const ext = dot > 0 ? attachment.originalFilename.slice(dot) : "";
      let i = 2;
      while (usedZipPaths.has(`${epochDir(finding.epoch)}/${stem}-${i}${ext}`)) i++;
      zipPath = `${epochDir(finding.epoch)}/${stem}-${i}${ext}`;
    }
    if (!usedZipPaths.has(zipPath)) {
      zip.file(zipPath, buf);
      usedZipPaths.add(zipPath);
    }
    claimed.add(`${finding.epoch}:${attachment.id}`);
    claimed.add(attachment.id);
    entries.push({ ...base, zipPath, status: "included" });
  }

  // Anything delivered to the thread that no finding cites. Often the real
  // proof under a different filename, so it ships rather than being dropped.
  for (const a of attachments) {
    if (claimed.has(a.id)) continue;
    if (a.size > MAX_SINGLE_BYTES || totalBytes + a.size > MAX_TOTAL_BYTES) continue;
    try {
      const dl = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(a.id)}/download`, auth);
      totalBytes += dl.buffer.length;
      let path = `unmatched/${a.originalFilename}`;
      let i = 2;
      while (usedZipPaths.has(path)) path = `unmatched/${i++}-${a.originalFilename}`;
      zip.file(path, dl.buffer);
      usedZipPaths.add(path);
      claimed.add(a.id);
    } catch {
      // Best-effort: an unmatched extra must never fail the bundle.
    }
  }

  zip.file("findings.md", findingsMarkdown);
  zip.file("MANIFEST.md", buildManifest(run, entries));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const includedCount = entries.filter((e) => e.status === "included").length;
  return {
    buffer,
    filename: bundleFilename(run),
    entries,
    includedCount,
    missingCount: entries.length - includedCount,
  };
}

function bundleFilename(run: ExperimentRun): string {
  const slug = run.agentSlug.replace(/[^\w.\-]+/g, "_").slice(0, 60) || "agent";
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  return `experiment-proofs-${slug}-${stamp}.zip`;
}

const STATUS_NOTE: Record<BundleEntry["status"], string> = {
  "included": "included",
  "not-delivered": "NOT IN BUNDLE — cited path was never delivered to this thread",
  "no-proof-path": "NOT IN BUNDLE — finding recorded no proofArtifactPath",
  "too-large": "NOT IN BUNDLE — attachment exceeded the bundle size cap",
  "download-failed": "NOT IN BUNDLE — attachment download failed",
};

function buildManifest(run: ExperimentRun, entries: BundleEntry[]): string {
  const byEpoch = new Map<number, BundleEntry[]>();
  for (const e of entries) {
    const list = byEpoch.get(e.epoch) ?? [];
    list.push(e);
    byEpoch.set(e.epoch, list);
  }
  const included = entries.filter((e) => e.status === "included").length;
  const lines = [
    `# Proof bundle — ${run.agentSlug}`,
    ``,
    `- Experiment id: ${run.id}`,
    `- Findings: ${entries.length}`,
    `- Proofs included: ${included}`,
    `- Proofs missing: ${entries.length - included}`,
    ``,
    `A finding listed as NOT IN BUNDLE has no runnable evidence attached to this`,
    `thread. Treat it as a lead, not a confirmed defect.`,
    ``,
  ];
  for (const epoch of [...byEpoch.keys()].sort((a, b) => a - b)) {
    lines.push(`## Epoch ${epoch}`, ``);
    for (const e of byEpoch.get(epoch)!) {
      lines.push(`- **${e.title}**`);
      lines.push(`  - cited: ${e.citedPath ?? "(none)"}`);
      lines.push(`  - ${e.zipPath ? `file: \`${e.zipPath}\`` : STATUS_NOTE[e.status]}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
