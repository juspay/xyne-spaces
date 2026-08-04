export const VESPA_EMBEDDING_CHUNK_SIZE = 5;

/**
 * Split searchable text into non-empty, whitespace-normalized chunks that fit
 * below the embedding model's input limit. Prefer word boundaries, but hard
 * split an individual oversized token so the maximum is always respected.
 *
 * Vespa's array embedder creates one mapped tensor cell per returned chunk.
 * An empty input is represented by a single empty chunk to preserve the
 * existing feed behaviour for optional text fields.
 */
export const chunkPlainText = (
  text: string,
  maxLen = VESPA_EMBEDDING_CHUNK_SIZE,
): string[] => {
  if (!Number.isInteger(maxLen) || maxLen <= 0) {
    throw new Error('maxLen must be a positive integer');
  }

  let remaining = text.trim().replace(/\s+/g, ' ');
  if (!remaining) return [''];

  const chunks: string[] = [];
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf(' ', maxLen + 1);
    if (splitAt <= 0) splitAt = maxLen;

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks.length > 0 ? chunks : [''];
};

