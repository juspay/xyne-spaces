import type { Prisma } from '@prisma/client';

/**
 * A Google Doc created from a recording's summary.
 *
 * Stored on `calls.metadata.googleDocs` because the Docs API hands back the
 * document id exactly once — at creation time. Persisting it is the only way the
 * recording screen can list every doc that was ever exported from a recording.
 */
// A type alias rather than an interface on purpose: only aliases carry an implicit
// index signature, which is what lets these entries be written straight into a
// Prisma JSON column without an `unknown` cast.
export type RecordingGoogleDocLink = {
  documentId: string;
  title: string;
  url: string;
  /** ISO timestamp of when the doc was created. */
  createdAt: string;
  createdByUserId: string;
};

/** Keeps the metadata blob bounded — this is a recent-history list, not an archive. */
const MAX_RECORDING_GOOGLE_DOCS = 50;

const DEFAULT_DOC_TITLE = 'Untitled document';

export const recordingGoogleDocUrl = (documentId: string): string =>
  `https://docs.google.com/document/d/${documentId}/edit`;

function toGoogleDocLink(value: unknown): RecordingGoogleDocLink | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const documentId = typeof entry.documentId === 'string' ? entry.documentId.trim() : '';
  if (!documentId) return null;

  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  return {
    documentId,
    title: title || DEFAULT_DOC_TITLE,
    url: url || recordingGoogleDocUrl(documentId),
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    createdByUserId: typeof entry.createdByUserId === 'string' ? entry.createdByUserId : '',
  };
}

/**
 * Reads the exported-docs list off `calls.metadata`, dropping malformed entries so a
 * hand-edited or legacy metadata blob can never break the recording detail response.
 */
export function readRecordingGoogleDocLinks(
  metadata: Prisma.JsonValue | null | undefined,
): RecordingGoogleDocLink[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const raw = (metadata as Record<string, unknown>).googleDocs;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const link = toGoogleDocLink(entry);
    return link ? [link] : [];
  });
}

/** Newest first, deduped by document id, capped at {@link MAX_RECORDING_GOOGLE_DOCS}. */
export function appendRecordingGoogleDocLink(
  existing: RecordingGoogleDocLink[],
  link: RecordingGoogleDocLink,
): RecordingGoogleDocLink[] {
  return [link, ...existing.filter((entry) => entry.documentId !== link.documentId)].slice(
    0,
    MAX_RECORDING_GOOGLE_DOCS,
  );
}
