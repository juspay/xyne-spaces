export const TAG_SCRIPT_TIMEOUT_MAX_MS = 5 * 60 * 1000; // 300,000ms = 5 minutes

/**
 * Canonical tag-name format: lowercase, hyphen-separated, alphanumeric segments.
 *
 * Used by:
 *  - Backend  (backend/src/tags/schema.ts) – `TagNameSchema` validation
 *  - Frontend (dashboard/.../ui/TagChipInput/TagChipInput.tsx) – normalizes chip input
 */
export const TAG_FORMAT_REGEX = /^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/;
export const TAG_FORMAT_MESSAGE = 'must be lowercase, hyphen-separated, alphanumeric segments';

/**
 * Normalizes free-typed text into the canonical tag format: lowercased, with
 * runs of whitespace/non-alphanumeric characters collapsed into single hyphens
 * and leading/trailing hyphens trimmed. Returns '' if nothing usable remains.
 */
export const normalizeTagName = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface DuplicateTag {
  value: string;
  index: number;
}

/**
 * Finds case-insensitive duplicate entries in a list of tag names.
 *
 * Used by:
 *  - Backend  (backend/src/tags/schema.ts) – rejects duplicate `tags`/`blacklist` entries
 *  - Frontend (dashboard/.../DeskSettings/TagGenerationConfig.tsx) – inline validation before save
 *
 * Returns one entry per duplicate occurrence (i.e. the second, third, ... occurrence of a
 * repeated value), each with the original casing and its index in the input list.
 */
export const findDuplicateTags = (list: string[] | undefined): DuplicateTag[] => {
  if (!list) return [];
  const seen = new Set<string>();
  const duplicates: DuplicateTag[] = [];
  list.forEach((tag, index) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      duplicates.push({ value: tag, index });
    } else {
      seen.add(key);
    }
  });
  return duplicates;
};

// Controlled classification vocabulary (thread types).
export * from './vocabularies';
// The applied-tag record and the one parser/serializer for the stored columns.
export * from './appliedTags';
