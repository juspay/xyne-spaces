import type { ExternalSource } from '@prisma/client';
import type { ExternalSourceAdapter } from '@/integrations/core/types';
import { catchUpFromCursor } from '@/integrations/adapters/google/refetch';
import { asService } from './base';

/**
 * Relocated from emailFetchWorker.ts's processCursorCatchup: the worker acts for the whole
 * workspace the source belongs to, not as any one member, so it needs workspace scope without
 * a per-user ACL predicate.
 */
export function catchUpFromCursorAsService(
  source: ExternalSource,
  adapter: ExternalSourceAdapter,
  cursor: string,
  workspaceId: string,
) {
  return asService(
    ['ExternalSource', 'Ticket', 'Email'],
    'email-fetch-worker: cursor catchup runs for the workspace, not one member',
    'email-fetch-worker',
    workspaceId,
    () => catchUpFromCursor(source, adapter, cursor),
  );
}
