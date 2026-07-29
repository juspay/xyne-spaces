/**
 * Shared entity URL patterns for extracting entity references from dashboard URLs.
 *
 * Used by:
 * - activityContextResolver (entity extraction from analytics event URLs)
 * - helpers/parseXyneUrlsFromContent (link-paste implicit nudge)
 *
 * If dashboard routes change, update this single file.
 */

/**
 * Surface types recognised in URLs. This is a superset of the Prisma SurfaceAreaType
 * enum — activityContextResolver also tracks CHANNEL which is not a SurfaceAreaType.
 */
export type UrlSurfaceType =
  | 'MESSAGE'
  | 'TICKET'
  | 'CANVAS'
  | 'CALL'
  | 'CONVERSATION'
  | 'CHANNEL';

export interface EntityUrlPattern {
  pattern: RegExp;
  surfaceType: UrlSurfaceType;
  idGroup: number;
}

/**
 * Segment-based patterns that match entity references in URL paths.
 * Order matters: more specific patterns should come first.
 */
export const ENTITY_URL_PATTERNS: EntityUrlPattern[] = [
  { pattern: /\/tickets?\/([a-zA-Z0-9_-]+)/i, surfaceType: 'TICKET', idGroup: 1 },
  { pattern: /\/canvas\/([a-zA-Z0-9_-]+)/i, surfaceType: 'CANVAS', idGroup: 1 },
  { pattern: /\/conversations?\/([a-zA-Z0-9_-]+)/i, surfaceType: 'CONVERSATION', idGroup: 1 },
  { pattern: /\/channels?\/([a-zA-Z0-9_-]+)/i, surfaceType: 'CHANNEL', idGroup: 1 },
  { pattern: /\/messages?\/([a-zA-Z0-9_-]+)/i, surfaceType: 'MESSAGE', idGroup: 1 },
  { pattern: /\/calls?\/([a-zA-Z0-9_-]+)/i, surfaceType: 'CALL', idGroup: 1 },
];

/**
 * Hash-fragment patterns for entity references encoded in URL hashes.
 * Dashboard uses hash params for message navigation: #messageId=MSG_ID
 */
export const HASH_ENTITY_PATTERNS: EntityUrlPattern[] = [
  { pattern: /messageId=([a-zA-Z0-9_-]+)/i, surfaceType: 'MESSAGE', idGroup: 1 },
];
