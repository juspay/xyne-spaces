import { z } from 'zod';
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
export * from './vocabularies.js';
// The applied-tag record and the one parser/serializer for the stored columns.
export * from './appliedTags.js';

/** One tag category of a tags config: how its tags are chosen and what they look like. */
export const CategoryConfigSchema = z
  .object({
    method: z.enum(['manual', 'llm']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a valid hex color (e.g. #0891b2)').optional(),
    count: z.number().int().positive().optional(),
    tags: z.array(z.string().regex(TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE)).optional(),
    is_new_tag_allowed: z.boolean().optional(),
    blacklist: z.array(z.string().regex(TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE)).optional(),
    prompt: z.string().optional(),
  })
  .superRefine((category, ctx) => {
    for (const { value, index } of findDuplicateTags(category.tags)) {
      ctx.addIssue({ code: 'custom', path: ['tags', index], message: `tag "${value}" already exists` });
    }
    for (const { value, index } of findDuplicateTags(category.blacklist)) {
      ctx.addIssue({ code: 'custom', path: ['blacklist', index], message: `tag "${value}" already exists` });
    }
  });

/** A tags config: categories by name (each name in the tag format). Moved from the backend's tags/schema.ts. */
export const TagsConfigShapeSchema = z.object({
  categories: z.record(z.string(), CategoryConfigSchema).superRefine((categories, ctx) => {
    for (const category of Object.keys(categories)) {
      if (!TAG_FORMAT_REGEX.test(category)) {
        ctx.addIssue({ code: 'custom', path: [category], message: `category ${TAG_FORMAT_MESSAGE}` });
      }
    }
  }),
});
