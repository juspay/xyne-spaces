import type { Prisma } from '@prisma/client';

/**
 * Stashed on `Call.metadata.unlinkedTranscript` when the calls admin panel
 * detaches a transcript. The GCS files are kept, so every path that would
 * silently rebuild the link from storage (the transcript-ready webhook, the
 * room_finished reconcile, the manual "process transcript" button) and every
 * read that goes to storage by call id has to honour this marker.
 */
export interface UnlinkedTranscriptMarker {
  /** The `Call.transcript` storage path that was detached. */
  url: string | null;
  /** User id of whoever unlinked it. */
  by: string;
  /** ISO timestamp of the unlink. */
  at: string;
}

type MetadataCarrier = { metadata?: Prisma.JsonValue | null };

export function getUnlinkedTranscript(
  call: MetadataCarrier | null | undefined,
): UnlinkedTranscriptMarker | null {
  const metadata = call?.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const marker = (metadata as Record<string, unknown>).unlinkedTranscript;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  return marker as unknown as UnlinkedTranscriptMarker;
}

export function isTranscriptUnlinked(call: MetadataCarrier | null | undefined): boolean {
  return getUnlinkedTranscript(call) !== null;
}
