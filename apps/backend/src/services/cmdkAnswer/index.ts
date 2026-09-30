import type { JsonValue } from '@openfeature/server-sdk';
import { LLMClient, createUserMessage } from '@framework';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { getIntentConfig } from '@/services/queryIntent';
import { findRelatedContext } from '@/services/relatedContext';
import type { Candidate, RetrievalContext } from '@/services/relatedContext/retrieval';

export type CmdkAnswerSkipReason = 'off' | 'not_ready' | 'failed' | 'nothing';

export type CmdkAnswerEvent =
  | { type: 'sources'; sources: Array<Pick<Candidate, 'id' | 'kind' | 'result'>> }
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'skip'; reason: CmdkAnswerSkipReason }
  | { type: 'error' };

const CONFIG_KEY = 'cmdk_ai_answer_config';

interface CmdkAnswerConfig {
  model: string;
}

const DEFAULT_CONFIG: CmdkAnswerConfig = {
  model: 'glm-flash-experimental',
};

const MAX_SOURCES = 5;
const LLM_TIMEOUT_MS = 20000;
const MAX_TOKENS = 350;
const NO_ANSWER = 'NO_ANSWER';

const SYSTEM_PROMPT = [
  'You answer a question someone typed into their workspace search, using only the numbered sources you are given: chat threads, tickets, documents and calls from their workspace.',
  '- Answer in 1 to 4 short sentences, or a short list when the answer is a set of steps.',
  '- After each claim, add [clf-N] for the source N it came from, before any punctuation, like "The VPN link is pinned in #it-help[clf-2]." Only use numbers you were given.',
  '- Do not mention the sources, the search or these rules.',
  `- If the sources do not answer the question, reply with exactly ${NO_ANSWER} and nothing else.`,
].join('\n');

const getConfig = async (auth: RetrievalContext['auth']): Promise<CmdkAnswerConfig> => {
  const remote = (await superpositionClient.getObjectValue(CONFIG_KEY, {} as JsonValue, {
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  })) as Partial<CmdkAnswerConfig> | null;
  return { ...DEFAULT_CONFIG, ...remote };
};

const buildPrompt = (query: string, sources: Candidate[]): string =>
  [
    `Question: ${query}`,
    'Sources:',
    ...sources.map((source, i) => `[${i + 1}] ${source.text}`),
  ].join('\n\n');

export async function answerCmdkQuery(
  query: string,
  ctx: RetrievalContext,
  emit: (event: CmdkAnswerEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const finish = (outcome: string, extra: Record<string, unknown> = {}): void => {
    logger.info('[CmdkAnswer] answer', {
      outcome,
      ...timings,
      totalMs: Date.now() - started,
      ...extra,
    });
  };
  const skip = (
    reason: CmdkAnswerSkipReason,
    outcome: string,
    extra: Record<string, unknown> = {}
  ): void => {
    emit({ type: 'skip', reason });
    finish(outcome, extra);
  };

  try {
    if (!(await getIntentConfig(ctx.auth)).enabled) return skip('off', 'off');
    const config = await getConfig(ctx.auth);

    let pool: Candidate[] = [];
    const related = await findRelatedContext(query, ctx, signal, (candidates) => {
      pool = candidates;
    });
    timings.relatedMs = Date.now() - started;
    if (signal.aborted) return finish('abandoned');
    if (!related) return skip('off', 'related_off');
    if (related.failed) return skip('failed', 'related_failed');
    if (related.ready === false) return skip('not_ready', 'not_ready');

    const byId = new Map(pool.map((candidate) => [candidate.id, candidate]));
    const sources = related.items.slice(0, MAX_SOURCES).flatMap((item) => byId.get(item.id) ?? []);
    if (sources.length === 0) {
      return skip('nothing', 'not_relevant', { candidates: pool.length });
    }

    const credential = await orgLLMCredentialService.getCredentialByWorkspaceId(
      ctx.auth.workspaceId,
      OrgLLMServiceAccountPurpose.ASK_AI
    );
    if (!credential) return skip('off', 'no_credential');

    const llm = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: credential.apiKey,
          baseUrl: credential.baseUrl,
          timeout: LLM_TIMEOUT_MS,
        },
      },
      defaultModel: config.model,
    });
    const { stream, finalMessage } = await llm.generateStream({
      systemPrompt: SYSTEM_PROMPT,
      messages: [createUserMessage(buildPrompt(query, sources))],
      parameters: { temperature: 0.2, maxTokens: MAX_TOKENS },
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
      abortSignal: signal,
    });
    finalMessage.catch(() => undefined);

    let pending = '';
    let answering = false;
    for await (const chunk of stream) {
      if (chunk.type !== 'content' || !chunk.content) continue;
      if (answering) {
        emit({ type: 'delta', content: chunk.content });
        continue;
      }
      pending += chunk.content;
      const head = pending.trimStart();
      if (head.startsWith(NO_ANSWER)) break;
      if (NO_ANSWER.startsWith(head)) continue;
      answering = true;
      timings.firstTokenMs = Date.now() - started;
      emit({
        type: 'sources',
        sources: sources.map(({ id, kind, result }) => ({ id, kind, result })),
      });
      emit({ type: 'delta', content: head });
    }
    if (signal.aborted) return finish('abandoned');
    if (!answering) return skip('nothing', 'no_answer', { sources: sources.length });
    emit({ type: 'done' });
    finish('ok', { candidates: pool.length, sources: sources.length });
  } catch (error) {
    if (signal.aborted) return finish('abandoned');
    logger.error('[CmdkAnswer] answer failed', {
      error: error instanceof Error ? error.name : 'unknown',
      totalMs: Date.now() - started,
    });
    emit({ type: 'error' });
  }
}
