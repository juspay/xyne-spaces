import type { CallPreview, ChatBody } from './chatRow.types';

const nonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const nonNegativeFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/**
 * Converts untrusted message metadata into the only call shape the row layer
 * needs. A call remains paintable when optional metadata is incomplete; the
 * transcript view is gated separately on the call id it must fetch.
 */
export const callPreviewFromMetadata = (
  metadata: Record<string, unknown> | null,
): CallPreview | null => {
  if (metadata?.['isCallMessage'] !== true) {
    return null;
  }

  return {
    callId: nonEmptyString(metadata['callId']),
    title: nonEmptyString(metadata['callTitle']) ?? 'Call',
    operation: nonEmptyString(metadata['operation']),
    durationMs: nonNegativeFiniteNumber(metadata['durationMs']),
  };
};

/** V2 uses the call message body as the transcript-card heading, not metadata title alone. */
export const callContentFor = (
  call: CallPreview,
  body: Pick<ChatBody, 'plainText' | 'markdown'>,
): string => body.plainText.trim() || body.markdown.trim() || call.title;
