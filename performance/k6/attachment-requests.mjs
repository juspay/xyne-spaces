// Read-only load for attachment retrieval — Wave 2 in
// docs/performance-testing-priority-decision.md: 1.0M downloads over fourteen days at a
// p99 of roughly 2.5s, where the cost is GCS retrieval and access checking rather than
// application logic.
//
// Pure data and functions only — no k6 globals — so the k6 scenario and the Node test
// suite can both import it.
//
// Routes verified in apps/backend/src/routes/attachments.ts, mounted on /api:
//   GET /api/attachments/:attachmentId/download
//   GET /api/attachments/:attachmentId/thumbnail
//
// COST NOTE: every iteration pulls real bytes out of object storage. The identifiers come
// from the fixture so an operator chooses which files a run touches, and the scenario asks
// k6 to discard bodies after transfer so latency is measured without buffering files.

export const ATTACHMENT_KINDS = Object.freeze(['download', 'thumbnail']);

export function selectAttachmentIds(user) {
  const ids = user?.attachmentIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === 'string' && id.trim() !== '');
}

export function buildAttachmentPath(attachmentId, kind) {
  if (typeof attachmentId !== 'string' || attachmentId.trim() === '') {
    throw new Error('Attachment identifier must be a non-empty string');
  }
  if (!ATTACHMENT_KINDS.includes(kind)) {
    throw new Error(`Unknown attachment kind: ${kind}`);
  }
  return `/api/attachments/${encodeURIComponent(attachmentId)}/${kind}`;
}
