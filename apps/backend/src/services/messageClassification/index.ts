import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@juspay-jaf/jaf';
import { z } from 'zod';
import {
  MESSAGE_ACTS,
  MESSAGE_ACT_NAMES,
  THREAD_TYPES,
  OrgLLMServiceAccountPurpose,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { createAgentEventLogger } from '@/agents/agentLogger';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { buildClassifierPrompt } from './prompt';

const TAG = '[MessageClassification]';

/**
 * A thread is only classified once it has at least this many messages.
 *
 * Classifying message-by-message as they arrive is both wasteful and inaccurate: several
 * tags are defined by what is open elsewhere in the thread (ANSWER needs a question above
 * it, RESOLUTION needs an open issue), so a one-message view guesses. Waiting for a real
 * thread and classifying all of it in a single call is cheaper AND better informed.
 */
export const MIN_THREAD_SIZE = Number(
  process.env['MESSAGE_CLASSIFICATION_MIN_THREAD_SIZE'] ?? 5,
);

/** Upper bound on messages sent to the model in one pass. */
const MAX_THREAD_CONTEXT = 60;

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface ClassifyThreadResult {
  tagged: number;
  threadType?: string | null;
  skipped?: string;
}

/**
 * Classify every message in a thread in one LLM call and apply the results.
 *
 * Auto-apply: acts are written straight onto the messages rather than proposed for
 * confirmation. Users remove what's wrong. Note there is no per-tag provenance, so a
 * re-run also overwrites hand-applied acts — see the known gaps in
 * .plan/message-classification.md.
 *
 * Re-running on a grown thread re-tags earlier messages — deliberate, since later replies
 * change what an earlier message meant. Writes go through Prisma (this runs in a worker
 * with no client context); Zero replicates the rows to clients either way.
 */
export async function classifyAndTagThread(conversationId: string): Promise<ClassifyThreadResult> {
  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: {
      conversationId: true,
      initialMessageId: true,
      channelId: true,
      createdAt: true,
      workspaceId: true,
      threadType: true,
    },
  });
  if (!conversation) {
    return { tagged: 0, skipped: 'conversation-not-found' };
  }

  const channel = await db.channel.findUnique({
    where: { id: conversation.channelId },
    select: { id: true, projectId: true, workspaceId: true },
  });
  if (!channel?.projectId) {
    return { tagged: 0, skipped: 'no-project' };
  }

  const messages = await db.message.findMany({
    where: {
      conversationId,
      isDeleted: false,
      msgType: { not: 'SYSTEM' },
    },
    select: {
      messageId: true,
      content: true,
      createdAt: true,
      sender: { select: { name: true } },
    },
    // Newest first, then reversed below. Taking the OLDEST N would mean a long thread's
    // recent messages were never classified at all, and every re-run would re-process the
    // same opening stretch.
    orderBy: { createdAt: 'desc' },
    take: MAX_THREAD_CONTEXT,
  });

  messages.reverse(); // back to chronological — the model is told the thread is in order

  const threadMessages: ClassifierMessage[] = messages
    .map(m => ({
      id: m.messageId,
      text: stripHtml(m.content ?? ''),
      author_display_name: m.sender?.name ?? 'Unknown',
      timestamp_iso: m.createdAt.toISOString(),
    }))
    .filter(m => m.text.length > 0);

  if (threadMessages.length < MIN_THREAD_SIZE) {
    return { tagged: 0, skipped: 'thread-too-short' };
  }

  // Authorship isn't in the message text, so the model can't see it. We pass it in as a
  // fact; the rule about what it implies lives in the prompt, not here. No classification
  // decisions in code — one place owns the vocabulary and its rules.
  const rootMessage = await db.message.findUnique({
    where: { messageId: conversation.initialMessageId },
    select: { msgType: true },
  });
  const rootIsBot = rootMessage?.msgType === 'BOT';

  const modelName = process.env['MESSAGE_CLASSIFIER_MODEL'] ?? 'gpt-4o-mini';
  const { acts, threadType: modelThreadType } = await classifyThread(
    { thread_messages: threadMessages, root_is_bot: rootIsBot },
    channel.projectId,
    modelName,
  );

  let tagged = 0;
  for (const [messageId, messageActs] of acts) {
    await writeActs(messageId, messageActs);
    await refeedToVespa(messageId, conversation.workspaceId);
    tagged += messageActs.length;
  }

  const threadType = modelThreadType;


  // Only write on an actual change. The conversation row is synced to every client in the
  // channel, so a no-op update would broadcast for nothing.
  if (threadType && threadType !== conversation.threadType) {
    await db.conversation.update({
      where: { conversationId },
      data: { threadType },
    });
    // The root message doc is the one carrying threadType, so it needs refeeding even if
    // its own acts didn't change.
    await refeedToVespa(conversation.initialMessageId, conversation.workspaceId);
  }

  return { tagged, threadType };
}

/**
 * Write the classifier's acts onto the message row.
 *
 * The column holds the full set, so this is a plain overwrite rather than a diff — no
 * mapping rows to reconcile, no per-tag metadata to preserve.
 *
 * Caveat worth knowing: with acts stored as one column there is no per-tag record of who
 * applied it, so a re-run overwrites manual tags too. That is why the classifier stays
 * behind ENABLE_MESSAGE_CLASSIFICATION — when it is switched on, add a separate column for
 * manually-applied acts so the two can be merged instead of replaced.
 */
/**
 * Push a message back into Vespa so its acts and thread type become searchable.
 *
 * Needed explicitly because this service writes through Prisma, which bypasses the Zero
 * side-effect layer that normally queues these feeds. Failures are swallowed: an
 * unsearchable tag is worse than nothing indexed, but not worth failing the whole
 * classification over.
 */
async function refeedToVespa(messageId: string, workspaceId: string | null): Promise<void> {
  try {
    await vespaQueue.addJob({
      schema: messageSchema,
      jobType: 'feed',
      docId: messageId,
      userId: 'system',
      ...(workspaceId ? { workspaceId } : {}),
    });
  } catch (error) {
    logger.error(`${TAG} Failed to queue Vespa refeed`, { messageId, error });
  }
}

async function writeActs(messageId: string, acts: string[]): Promise<void> {
  const valid = acts.filter(act => (MESSAGE_ACT_NAMES as readonly string[]).includes(act));
  if (valid.length !== acts.length) {
    logger.warn(`${TAG} Dropping acts outside the vocabulary`, {
      messageId,
      dropped: acts.filter(a => !valid.includes(a)),
    });
  }

  await db.message.update({
    where: { messageId },
    // null rather than '[]' for "no acts" — one representation, so readers never handle both.
    data: { messageActs: valid.length > 0 ? JSON.stringify(valid) : null },
  });
}

// ─── LLM invocation ──────────────────────────────────────────────────────────────
const AGENT_NAME = 'MessageClassifierAgent';

interface ClassifierMessage {
  id: string;
  text: string;
  author_display_name: string;
  timestamp_iso: string;
}

interface ClassifierInput {
  thread_messages: ClassifierMessage[];
  /** True when a bot or automated system opened the thread. Gates the ALERT type. */
  root_is_bot: boolean;
}

interface Classification {
  /** messageId -> its message acts. Messages the model omitted or mis-tagged are absent. */
  acts: Map<string, string[]>;
  /** The thread as a whole. Null when the model returned nothing usable. */
  threadType: string | null;
}

const VALID_ACTS = new Set(MESSAGE_ACTS.map(entry => entry.name));
const VALID_THREAD_TYPES = new Set(THREAD_TYPES.map(entry => entry.name));

// Lenient on purpose: the model's raw shape is untrusted. Anything unrecognised becomes
// null and is dropped rather than failing the whole job.
const RawOutputSchema = z.object({
  threadType: z.string().nullish(),
  classifications: z
    .array(
      z.object({
        id: z.string(),
        // Tolerate a bare string as well as an array — models collapse single-element
        // arrays even when the schema asks for one.
        messageActs: z.union([z.string(), z.array(z.string())]).nullish(),
      }),
    )
    .default([]),
});

/**
 * Coerce a model's answer onto the closed vocabulary.
 *
 * Models return near-misses — wrong case, hyphens for underscores, stray whitespace,
 * occasionally a value from the other vocabulary. Normalising those is worth it; inventing
 * a mapping for genuinely unknown values is not, so anything that doesn't land on a real
 * vocabulary entry becomes null and is simply not applied.
 */
const coerce = (raw: string | null | undefined, valid: Set<string>): string | null => {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return valid.has(normalized) ? normalized : null;
};

async function classifyThread(
  input: ClassifierInput,
  projectId: string,
  modelName: string,
): Promise<Classification> {
  const agent: Agent<{ projectId: string }, unknown> = {
    name: AGENT_NAME,
    instructions: () => buildClassifierPrompt(),
    // Classification wants determinism, not variety.
    modelConfig: { temperature: 0 },
  };

  const credential = await orgLLMCredentialService.getCredentialByProjectId(
    projectId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  const provider = makeLiteLLMProvider(credential.baseUrl, credential.apiKey);
  const initialState: RunState<{ projectId: string }> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    currentAgentName: AGENT_NAME,
    context: { projectId },
    turnCount: 0,
  };

  const runConfig: RunConfig<{ projectId: string }> = {
    agentRegistry: new Map([[AGENT_NAME, agent]]),
    modelProvider: provider as RunConfig<{ projectId: string }>['modelProvider'],
    maxTurns: 1,
    modelOverride: modelName,
    onEvent: createAgentEventLogger('MessageClassifier', 'ORG_LITELLM_SERVICE_ACCOUNT'),
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status !== 'completed') {
    // Log the whole error object, not just its tag: the tag alone ("ModelBehaviorError")
    // says a model misbehaved but not how, which is exactly what you need when a provider
    // returns reasoning blocks or a shape the runner can't handle.
    if (result.outcome.status === 'error') {
      logger.error(`${TAG} Model run failed`, {
        error: result.outcome.error,
        model: modelName,
      });
    }
    throw new Error(
      `Message classification failed: ${
        result.outcome.status === 'error' ? result.outcome.error._tag : result.outcome.status
      }`,
    );
  }

  const output = result.outcome.output;
  let parsed: z.infer<typeof RawOutputSchema>;

  if (typeof output === 'string') {
    // Strip reasoning blocks and pull the first JSON object out — models wrap output in
    // prose or fences no matter how firmly the prompt says not to.
    const cleaned = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    parsed = RawOutputSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : cleaned));
  } else {
    parsed = RawOutputSchema.parse(output);
  }

  // Only ids that were actually sent are accepted — a model that invents or hallucinates
  // an id must not cause a write against an unrelated message.
  const knownIds = new Set(input.thread_messages.map(m => m.id));
  const acts = new Map<string, string[]>();

  for (const entry of parsed.classifications) {
    if (!knownIds.has(entry.id)) {
      logger.warn('[MessageClassifier] Model returned an unknown message id; dropping', {
        returned: entry.id,
      });
      continue;
    }
    const raw = Array.isArray(entry.messageActs)
      ? entry.messageActs
      : entry.messageActs
        ? [entry.messageActs]
        : [];

    // Dedupe: a model asked for several tags will sometimes repeat one.
    const tagged = [...new Set(raw.map(value => coerce(value, VALID_ACTS)).filter(Boolean))] as string[];

    if (tagged.length === 0) {
      logger.warn('[MessageClassifier] No usable message act returned; dropping', {
        messageId: entry.id,
        returned: entry.messageActs,
      });
      continue;
    }
    acts.set(entry.id, tagged);
  }

  const threadType = coerce(parsed.threadType, VALID_THREAD_TYPES);
  if (parsed.threadType && !threadType) {
    logger.warn('[MessageClassifier] Model returned an unknown thread type; dropping', {
      returned: parsed.threadType,
    });
  }

  return { acts, threadType };
}
