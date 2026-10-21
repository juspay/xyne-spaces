// Forwards git-host PR status changes to xyne-claw-auth so the PR card an agent
// posted in its Spaces thread follows the PR (shared by the GitHub and Bitbucket
// webhook services).

import { config } from '@/config/env';
import { sanitizeForLog } from '@/git-providers/github/apis';
import { logger } from '@/utils/logger';

/** The PR card statuses a webhook can drive (subset of PrStatus in xyne-claw-shared/flow/pr-flow.ts). */
export type PrCardStatus = 'created' | 'merged' | 'declined' | 'deleted';

export interface PrCardStatusEvent {
  provider: 'github' | 'bitbucket';
  status: PrCardStatus;
  prUrl: string;
  number: number;
  /** "owner/repo" (github) or "PROJECT/repo" (bitbucket). */
  repo: string;
  /** Current PR title, so a renamed PR renames its card too. */
  title?: string;
}

/**
 * Fire-and-forget POST to claw-auth /webhook/pr-event, which updates the agent's
 * PR card in place — but only if an agent originally posted a card for this PR
 * (matched there via the durable AgentWidgetBinding keyed on the PR URL). Fully
 * decoupled from the ticket sync: it must NEVER block or fail the webhook
 * handler, so it swallows every error. A PR with no agent card ⇒ silent no-op on
 * the claw-auth side.
 */
export function forwardPrCardStatus(ev: PrCardStatusEvent, logPrefix: string): void {
  const base = config.xyneClaw?.webhookUrl;
  const s2sKey = config.xyneClaw?.s2sKey;
  if (!base || !s2sKey) return; // not wired in this env → skip silently

  const url = `${base.replace(/\/+$/, '')}/pr-event`;

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-s2s-key': s2sKey },
    body: JSON.stringify(ev),
    signal: AbortSignal.timeout(10_000),
  })
    .then((res) => {
      if (!res.ok) {
        logger.warn(`${logPrefix} pr-card forward non-OK (HTTP ${res.status}) for PR ${sanitizeForLog(ev.prUrl)}`);
      }
    })
    .catch((err) => {
      logger.warn(
        `${logPrefix} pr-card forward failed for PR ${sanitizeForLog(ev.prUrl)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
