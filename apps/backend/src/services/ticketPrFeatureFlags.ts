// Feature-flag gates for the ticket-initiated Bitbucket PR integration.
//
// All flags DEFAULT TO FALSE so the feature ships dark and is rolled out per
// the Tech Doc's staged plan (read-only panel first, then link, then create,
// then webhook sync, then strict validation). Flags resolve through the
// existing Superposition client and fall back to the default on any error.

import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

export const TICKET_PR_FLAGS = {
  PANEL: 'ticket_pr_panel_enabled',
  CREATE: 'ticket_pr_create_enabled',
  LINK: 'ticket_pr_link_enabled',
  WEBHOOK_SYNC: 'ticket_pr_webhook_sync_enabled',
  STRICT_VALIDATION: 'ticket_pr_strict_validation_enabled',
} as const;

export type TicketPrFlagKey = (typeof TICKET_PR_FLAGS)[keyof typeof TICKET_PR_FLAGS];

export interface TicketPrFlagContext {
  workspaceId?: string;
  userId?: string;
  boardId?: string;
}

/**
 * Resolve a single ticket-PR feature flag. Never throws — returns `false` if
 * Superposition is unavailable, so a misconfigured flag store cannot
 * accidentally enable a write path.
 */
export async function isTicketPrFlagEnabled(
  flag: TicketPrFlagKey,
  context: TicketPrFlagContext = {},
): Promise<boolean> {
  try {
    if (!superpositionClient.isReady()) {
      return false;
    }
    // Build a plain string record so it satisfies OpenFeature's EvaluationContext
    // index-signature (a named-optional interface does not).
    const evalContext: Record<string, string> = {};
    if (context.workspaceId) evalContext.workspaceId = context.workspaceId;
    if (context.userId) evalContext.userId = context.userId;
    if (context.boardId) evalContext.boardId = context.boardId;
    return await superpositionClient.getBooleanValue(flag, false, evalContext);
  } catch (error) {
    logger.error(`[TicketPR] Failed to resolve flag '${flag}':`, error);
    return false;
  }
}

/** Resolve all ticket-PR flags at once (used by the panel bootstrap endpoint). */
export async function resolveTicketPrFlags(
  context: TicketPrFlagContext = {},
): Promise<Record<TicketPrFlagKey, boolean>> {
  const entries = await Promise.all(
    Object.values(TICKET_PR_FLAGS).map(
      async (flag) => [flag, await isTicketPrFlagEnabled(flag, context)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<TicketPrFlagKey, boolean>;
}
