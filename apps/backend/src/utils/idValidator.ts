import { db } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Validation results for IDs
 */
export interface IdValidationResult {
  valid: string[];
  invalid: string[];
}

/**
 * Validate project IDs against the database
 * @param projectIds - Array of project IDs to validate
 * @returns Object containing valid and invalid IDs
 */
export async function validateProjectIds(projectIds: string[]): Promise<IdValidationResult> {
  try {
    if (!projectIds || projectIds.length === 0) {
      return { valid: [], invalid: [] };
    }

    // Query database for existing projects
    const existingProjects = await db.project.findMany({
      where: {
        id: {
          in: projectIds
        }
      },
      select: {
        id: true
      }
    });

    const existingIds = new Set(existingProjects.map(p => p.id));
    const valid = projectIds.filter(id => existingIds.has(id));
    const invalid = projectIds.filter(id => !existingIds.has(id));

    return { valid, invalid };
  } catch (error) {
    logger.error('Error validating project IDs:', error);
    throw new Error('Failed to validate project IDs');
  }
}

/**
 * Validate channel IDs against the database
 * @param channelIds - Array of channel IDs to validate
 * @returns Object containing valid and invalid IDs
 */
export async function validateChannelIds(channelIds: string[]): Promise<IdValidationResult> {
  try {
    if (!channelIds || channelIds.length === 0) {
      return { valid: [], invalid: [] };
    }

    // Query database for existing channels
    const existingChannels = await db.channel.findMany({
      where: {
        id: {
          in: channelIds
        }
      },
      select: {
        id: true
      }
    });

    const existingIds = new Set(existingChannels.map(c => c.id));
    const valid = channelIds.filter(id => existingIds.has(id));
    const invalid = channelIds.filter(id => !existingIds.has(id));

    return { valid, invalid };
  } catch (error) {
    logger.error('Error validating channel IDs:', error);
    throw new Error('Failed to validate channel IDs');
  }
}

/**
 * Validate user IDs against the database
 * @param userIds - Array of user IDs to validate
 * @returns Object containing valid and invalid IDs
 */
export async function validateUserIds(userIds: string[]): Promise<IdValidationResult> {
  try {
    if (!userIds || userIds.length === 0) {
      return { valid: [], invalid: [] };
    }

    // Query database for existing users
    const existingUsers = await db.user.findMany({
      where: {
        id: {
          in: userIds
        }
      },
      select: {
        id: true
      }
    });

    const existingIds = new Set(existingUsers.map(u => u.id));
    const valid = userIds.filter(id => existingIds.has(id));
    const invalid = userIds.filter(id => !existingIds.has(id));

    return { valid, invalid };
  } catch (error) {
    logger.error('Error validating user IDs:', error);
    throw new Error('Failed to validate user IDs');
  }
}

/**
 * Parse comma-separated IDs and filter out empty strings
 * @param idsString - Comma-separated string of IDs
 * @returns Array of trimmed, non-empty IDs
 */
export function parseIds(idsString: string | string[]): string[] {
  if (Array.isArray(idsString)) {
    return idsString.map(id => id.trim()).filter(Boolean);
  }
  return idsString.split(',').map(id => id.trim()).filter(Boolean);
}

/**
 * Validate board IDs against the database
 * @param boardIds - Array of board IDs to validate
 * @returns Object containing valid and invalid IDs
 */
export async function validateBoardIds(boardIds: string[]): Promise<IdValidationResult> {
  try {
    if (!boardIds || boardIds.length === 0) {
      return { valid: [], invalid: [] };
    }

    const existingBoards = await db.board.findMany({
      where: {
        id: {
          in: boardIds
        }
      },
      select: {
        id: true
      }
    });

    const existingIds = new Set(existingBoards.map(b => b.id));
    const valid = boardIds.filter(id => existingIds.has(id));
    const invalid = boardIds.filter(id => !existingIds.has(id));

    return { valid, invalid };
  } catch (error) {
    logger.error('Error validating board IDs:', error);
    throw new Error('Failed to validate board IDs');
  }
}

/**
 * Validate ticket IDs against the database
 * @param ticketIds - Array of ticket IDs to validate
 * @returns Object containing valid and invalid IDs
 */
export async function validateTicketIds(ticketIds: string[]): Promise<IdValidationResult> {
  try {
    if (!ticketIds || ticketIds.length === 0) {
      return { valid: [], invalid: [] };
    }

    const existingTickets = await db.ticket.findMany({
      where: {
        id: {
          in: ticketIds
        }
      },
      select: {
        id: true
      }
    });

    const existingIds = new Set(existingTickets.map(t => t.id));
    const valid = ticketIds.filter(id => existingIds.has(id));
    const invalid = ticketIds.filter(id => !existingIds.has(id));

    return { valid, invalid };
  } catch (error) {
    logger.error('Error validating ticket IDs:', error);
    throw new Error('Failed to validate ticket IDs');
  }
}

/**
 * Valid document types for the type: filter (shared across search and validation)
 */
export const VALID_DOC_TYPES = [
  'messages', 'attachments', 'channels', 'tickets', 'users', 'files',
  'canvas', 'transcript', 'rca',
  'people', 'emails', 'calls'
] as const;

/**
 * Validate docType values (static validation - no DB query needed)
 * @param docTypes - Array of document types to validate
 * @returns Object containing valid and invalid types
 */
export function validateDocTypes(docTypes: string[]): IdValidationResult {

  if (!docTypes || docTypes.length === 0) {
    return { valid: [], invalid: [] };
  }

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const t of docTypes) {
    const lower = t.toLowerCase();
    // Only accept exact matches — prefix expansion is handled client-side
    if ((VALID_DOC_TYPES as readonly string[]).includes(lower)) {
      valid.push(t);
    } else {
      invalid.push(t);
    }
  }

  return { valid, invalid };
}

/**
 * Characters that let a docId escape its URL path segment and rewrite the Vespa
 * Document V1 request path: / \ ? # % and any ASCII control char (0x00-0x1f).
 */
// eslint-disable-next-line no-control-regex -- control chars are exactly what we must reject in a path segment
const DOC_ID_PATH_METACHARACTERS = /[/\\?#%\x00-\x1f]/;

/**
 * Guard untrusted docId input at request boundaries before it reaches Vespa. The sink already
 * URL-encodes each path segment; this rejects traversal attempts up front (400 + audit log) instead
 * of letting them 404 deep in the call chain. Denylist rather than a strict allow-list because memory
 * docIds are client-supplied and free-form — we block only the injection metacharacters, which never
 * legitimately appear in a docId.
 */
export function isSafeDocId(docId: unknown): docId is string {
  if (typeof docId !== 'string' || docId.length === 0) {
    return false;
  }

  return !docId.includes('..') && !DOC_ID_PATH_METACHARACTERS.test(docId);
}
