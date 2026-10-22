import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import type { AgentCard, DraftContext, Snapshot } from './types';

export interface DraftRequest {
  episodeId: string;
  workspaceId: string;
  channelId: string;
  /** The thread the answer would go in. */
  conversationId: string;
  agent: AgentCard;
  snapshot: Snapshot;
  /** Labels of the asked messages to answer. */
  answer: string[];
  /** Why the episode passed, for the run's own record. */
  why: string;
  /** Handed back with the draft. */
  context: DraftContext;
  /** It was already answered in the thread: reply only with what that answer leaves out. */
  onlyAdd?: boolean;
  /** The last draft was too long to post: the same answer, shorter. */
  shorter?: boolean;
}

/**
 * What claw-auth's standard result handler forwards: the draft, never a posted message,
 * with its sources already linked in the text.
 */
export interface DraftResult {
  sessionId?: string;
  status: 'completed' | 'failed';
  /** The answer, or empty when the agent found nothing worth saying. */
  result?: string;
  error?: string;
  toolsUsed?: string[];
}

/** The draft's context rides in its callback URL: the forward carries only the result. */
export const encodeDraftContext = (context: DraftContext): string =>
  Buffer.from(JSON.stringify(context)).toString('base64url');

export function decodeDraftContext(value: unknown): DraftContext | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as DraftContext;
  } catch {
    return null;
  }
}

/**
 * The task, as a tagged run gets it: the question as the asker wrote it. claw-auth adds
 * the thread as context, and the run's skill says how to answer unprompted.
 */
const buildTask = ({ snapshot, answer, onlyAdd, shorter }: DraftRequest): string => {
  const question = snapshot.asked
    .filter((m) => answer.includes(m.label))
    .map((m) => m.text)
    .join('\n\n');
  // A rewrite: the thread already has an answer, so say only what it leaves out.
  if (onlyAdd) {
    return `${question}\n\n(This is already answered in the thread. Reply only with what that answer leaves out, without repeating any of it, or with nothing.)`;
  }
  // A rewrite: the first answer was too long to post as a chat reply.
  return shorter
    ? `${question}\n\n(Your last answer was too long to post. Give the same answer as a short chat reply: at most three sentences, no headings or sections.)`
    : question;
};

/**
 * Ask claw-auth for a draft from `agent`. It runs the agent read-only, as its own bot,
 * and calls back with the draft instead of posting it. False when it couldn't start.
 */
export async function requestDraft(request: DraftRequest): Promise<{ sessionId: string } | null> {
  const callbackUrl =
    `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}/api/internal/proactivity/draft/` +
    `${encodeURIComponent(request.episodeId)}/${encodeURIComponent(request.agent.slug)}` +
    `?context=${encodeDraftContext(request.context)}`;
  try {
    const response = await fetch(`${config.xyneClaw.authUrl}/claw/api/v1/proactivity/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-s2s-key': config.internalS2sKey },
      body: JSON.stringify({
        agentSlug: request.agent.slug,
        agentUserId: request.agent.userId,
        workspaceId: request.workspaceId,
        channelId: request.channelId,
        conversationId: request.conversationId,
        episodeId: request.episodeId,
        task: buildTask(request),
        senderName: request.snapshot.askerName,
        channelName: request.snapshot.channelName,
        onlyAdd: request.onlyAdd === true,
        why: request.why,
        callbackUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      sessionId?: string;
      error?: string;
    } | null;
    if (!response.ok || !body?.success || !body.sessionId) {
      logger.warn('[Proactivity] draft request refused', {
        episodeId: request.episodeId,
        agent: request.agent.slug,
        status: response.status,
        error: body?.error,
      });
      return null;
    }
    return { sessionId: body.sessionId };
  } catch (error) {
    logger.warn('[Proactivity] draft request failed', {
      episodeId: request.episodeId,
      agent: request.agent.slug,
      error,
    });
    return null;
  }
}

/** One agent's run for a question, as claw-auth kept it. */
export interface StoredDraft {
  agentSlug: string;
  status: string;
  /** The task it was given: the prompt, with the conversation. */
  task: string;
  result: string | null;
  error: string | null;
  model: string | null;
  totalMs: number | null;
  toolCalls: Array<{
    toolName: string;
    args: string;
    result: string;
    isError: boolean;
    durationMs: number | null;
  }>;
  startedAt: string;
  completedAt: string | null;
}

/**
 * What each agent wrote for a question. The text lives only in the agents' runs in
 * claw-auth; the caller checks the reader may see the channel.
 */
export async function fetchDrafts(episodeId: string, channelId: string): Promise<StoredDraft[]> {
  const url = new URL(
    `${config.xyneClaw.authUrl}/claw/api/v1/proactivity/episodes/${encodeURIComponent(episodeId)}/drafts`
  );
  url.searchParams.set('channelId', channelId);
  const response = await fetch(url, {
    headers: { 'x-s2s-key': config.internalS2sKey },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: StoredDraft[];
  } | null;
  if (!response.ok || !body?.success) throw new Error(`drafts lookup failed: ${response.status}`);
  return body.data ?? [];
}
