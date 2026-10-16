import type { JsonValue } from '@openfeature/server-sdk';
import { normalizeRelatedDraft } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';
import {
  askJev,
  isPrivateJevConfigured,
  type JevFailure,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';

export interface DiscussionTitleVerdict {
  offer: boolean;
  hold: boolean;
  score?: number;
}

const CONFIG_KEY = 'chat_discussion_title_config';

interface DiscussionTitleConfig {
  enabled: boolean;
  shadow: boolean;
  threshold: number;
  holdThreshold: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: DiscussionTitleConfig = {
  enabled: false,
  shadow: false,
  threshold: 0.7,
  holdThreshold: 0.5,
  timeoutMs: 3000,
};

const STARTS_DISCUSSION: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'Is `draft` the opening post of a discussion, something several people will reply to ' +
    'and come back to, rather than a quick chat message?',
  criteria: {
    true:
      'An announcement, proposal, incident update, decision to review, or a question that ' +
      'needs input from several people, like "Proposal: move the settlement batch to 2am IST" ' +
      'or "UPI success rate dipped from 14:10 to 14:40, looking into it"',
    false:
      'A reply, an acknowledgement, a question for one person, or small talk, like "can you ' +
      'check the logs?", "done, merged" or "lunch at 1?"',
  },
};

const JEV_COOLDOWN_MS = 30_000;
let jevDownUntil = 0;
const isOutage = (failure: JevFailure): boolean =>
  failure.kind === 'timeout' ||
  failure.kind === 'network' ||
  (failure.kind === 'status' && failure.status >= 500);

const KEEP_SHOWING: DiscussionTitleVerdict = { offer: false, hold: true };

export async function checkDiscussionTitle(
  text: string,
  auth: { userId: string; workspaceId: string },
  signal?: AbortSignal
): Promise<DiscussionTitleVerdict | null> {
  if (!isPrivateJevConfigured()) return null;
  let config: DiscussionTitleConfig;
  try {
    const remote = (await superpositionClient.getObjectValue(CONFIG_KEY, {} as JsonValue, {
      userId: auth.userId,
      workspaceId: auth.workspaceId,
    })) as Partial<DiscussionTitleConfig> | null;
    config = { ...DEFAULT_CONFIG, ...remote };
  } catch (error) {
    logger.warn('[DiscussionTitle] config unavailable', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
  if (!config.enabled) return null;

  const draft = normalizeRelatedDraft(text);
  if (Date.now() < jevDownUntil) return KEEP_SHOWING;

  const started = Date.now();
  const answers = await askJev(
    { draft },
    { starts_discussion: STARTS_DISCUSSION },
    config.timeoutMs,
    signal,
    {
      onFailure: (failure) => {
        if (isOutage(failure)) jevDownUntil = Date.now() + JEV_COOLDOWN_MS;
      },
    }
  );
  const ms = Date.now() - started;
  if (signal?.aborted) return KEEP_SHOWING;
  const answer = answers?.starts_discussion;
  if (!answer || answer.type !== 'noul') {
    logger.info('[DiscussionTitle] check', { ms, outcome: 'jev_failed' });
    return KEEP_SHOWING;
  }
  const score = answer.noul;
  logger.info('[DiscussionTitle] check', { ms, score, shadow: config.shadow });
  if (config.shadow) return { offer: false, hold: false, score };
  return { offer: score >= config.threshold, hold: score >= config.holdThreshold, score };
}
