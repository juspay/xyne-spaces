import { logger } from '@/utils/logger';

/**
 * Refresh a call's channel pill after its title, time or status changed.
 *
 * Fire-and-forget: the pill is a read-only card, so a failed refresh must never fail
 * the call operation that triggered it. Safe to call for any call — it no-ops unless
 * that call actually has a live pill.
 */
export function queueScheduledCallPillSync(callId: string, context: string): void {
  setImmediate(() => {
    void (async () => {
      try {
        // Loaded lazily: callRepository is itself a caller, so importing the
        // repositories index at module scope would close an initialization cycle.
        const { repositories } = await import('@/database/repositories');
        await repositories.calls.syncScheduledCallPillMessage(callId);
      } catch (error) {
        logger.error(
          `[${context}] Failed to sync scheduled-call pill | callId=${callId} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
  });
}
