import { z } from 'zod';
import {
  MESSAGE_ACTS,
  MESSAGE_ACT_NAMES,
  THREAD_TYPES,
  OrgLLMServiceAccountPurpose,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { logLLMCallStart, logLLMError, logLLMSuccess } from '@/agents/agentLogger';
import {
  orgLLMCredentialService,
  type OrgLLMCredential,
} from '@/services/orgLLMCredentialService';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { buildClassifierPrompt } from './prompt';

const TAG = '[MessageClassification]';

/**
 * A thread is only classified once it has at least this many messages. Several acts are
 * defined by what is open above them (ANSWER, RESOLUTION), so a one-message view guesses.
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
 * Once per message: a message that already has acts is sent as context but never rewritten.
 * The vocabulary's dependencies all point backwards, so a later pass gets no better answer,
 * and the column has no provenance — a re-run would silently clobber hand-applied acts.
 * threadType is the exception, re-derived each pass and written only when it changes.
 *
 * Writes go through Prisma (no client context in a worker); Zero replicates to clients.
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
      messageActs: true,
      sender: { select: { name: true } },
    },
    // Newest first, reversed below: taking the oldest N would never reach a long thread's
    // recent messages.
    orderBy: { createdAt: 'desc' },
    take: MAX_THREAD_CONTEXT,
  });

  messages.reverse(); // back to chronological — the model is told the thread is in order

  const threadMessages: ClassifierMessage[] = messages
    .map(m => {
      const existing = parseActs(m.messageActs);
      return {
        id: m.messageId,
        text: stripHtml(m.content ?? ''),
        author_display_name: m.sender?.name ?? 'Unknown',
        timestamp_iso: m.createdAt.toISOString(),
        // Present => settled; enforced off-limits by the filter in classifyThread().
        ...(existing.length > 0 && { existing_acts: existing }),
      };
    })
    .filter(m => m.text.length > 0);

  if (threadMessages.length < MIN_THREAD_SIZE) {
    return { tagged: 0, skipped: 'thread-too-short' };
  }

  // Nothing new to tag and a type already set: the call could only rewrite what is there.
  const unclassified = threadMessages.filter(m => !m.existing_acts);
  if (unclassified.length === 0 && conversation.threadType) {
    return { tagged: 0, skipped: 'already-classified' };
  }

  // Passed as a fact, not a rule — what it implies lives in the prompt, not in code.
  const rootMessage = await db.message.findUnique({
    where: { messageId: conversation.initialMessageId },
    select: { msgType: true },
  });
  const rootIsBot = rootMessage?.msgType === 'BOT';

  const modelName = process.env['MESSAGE_CLASSIFIER_MODEL'] ?? 'gpt-4o-mini';
  const { acts, threadType: modelThreadType } = await classifyThread(
    {
      thread_messages: threadMessages,
      root_is_bot: rootIsBot,
      // Anchor against re-typing churn: every flip broadcasts a new chip to the channel.
      ...(conversation.threadType && { current_thread_type: conversation.threadType }),
    },
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
 * Push a message back into Vespa so its acts become searchable.
 *
 * Explicit because Prisma writes bypass the Zero side-effect layer that normally queues
 * these. Failures are swallowed — an unindexed tag is not worth failing classification for.
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

/** Log prefix, kept aligned with the other agents in agentLogger's output. */
const AGENT_NAME = 'MessageClassifier';

/** The LiteLLM key's parallel-request limit is shared with entity extraction, so 429s are
 *  expected and transient — back off rather than burn a Bull attempt. */
const RATE_LIMIT_MAX_RETRIES = 6;

/** Generous — a 60-message thread on a loaded endpoint is not fast. */
const REQUEST_TIMEOUT_MS = 300_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One LiteLLM /chat/completions call. A plain fetch rather than an agent framework — this
 * is single-shot with no tools, and going direct is what lets us set the params below.
 * Mirrors services/entityExtraction/entityLlmClient.ts against the same endpoint.
 */
async function callLiteLLM(
  credential: OrgLLMCredential,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const url = `${credential.baseUrl.replace(/\/$/, '')}/chat/completions`;

  // Disabling glm's <think> trace took entity extraction 45s -> 7.7s. Gated on the model:
  // OpenAI 400s on unrecognised body params.
  const supportsThinkingToggle = /glm/i.test(model);

  // agentLogger's direct-call entry points, so this reads like every other agent in logs.
  logLLMCallStart(AGENT_NAME, model, 'ORG_LITELLM_SERVICE_ACCOUNT');

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // Classification wants determinism, not variety.
        temperature: 0,
        ...(supportsThinkingToggle && { chat_template_kwargs: { enable_thinking: false } }),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      // Exponential backoff with jitter: 1.5s, 3s, 6s, ... capped at 30s.
      const waitMs = Math.min(30_000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
      logger.warn(`${TAG} Rate limited, backing off`, { attempt: attempt + 1, waitMs, model });
      await response.body?.cancel();
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      const error = new Error(`LiteLLM error: ${response.status} ${body}`);
      logLLMError(AGENT_NAME, error);
      throw error;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    logLLMSuccess(AGENT_NAME, content);
    return content;
  }
}

interface ClassifierMessage {
  id: string;
  text: string;
  author_display_name: string;
  timestamp_iso: string;
  /** Acts this message already carries. Absent means it still needs classifying. */
  existing_acts?: string[];
}

/** messageActs is a stringified array; anything unparseable is treated as untagged. */
const parseActs = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

interface ClassifierInput {
  thread_messages: ClassifierMessage[];
  /** True when a bot or automated system opened the thread. Gates the ALERT type. */
  root_is_bot: boolean;
  /** The thread's current type, when it already has one. Anchor against re-typing churn. */
  current_thread_type?: string;
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
 * Coerce onto the closed vocabulary. Near-misses (case, hyphens, whitespace) are worth
 * normalising; guessing at genuinely unknown values is not, so those become null.
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
  const credential = await orgLLMCredentialService.getCredentialByProjectId(
    projectId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  const output = await callLiteLLM(credential, modelName, [
    { role: 'system', content: buildClassifierPrompt() },
    { role: 'user', content: JSON.stringify(input, null, 2) },
  ]);

  // Strip reasoning blocks and pull the first JSON object out — models wrap output in
  // prose or fences no matter how firmly the prompt says not to.
  const cleaned = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = RawOutputSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : cleaned));

  // Sent AND still unclassified. Blocks both a hallucinated id and a model that ignores
  // the prompt and re-classifies a settled message. The prompt asks; this guarantees.
  const eligibleIds = new Set(
    input.thread_messages.filter(m => !m.existing_acts?.length).map(m => m.id),
  );
  const acts = new Map<string, string[]>();

  for (const entry of parsed.classifications) {
    if (!eligibleIds.has(entry.id)) {
      logger.warn('[MessageClassifier] Model returned an unknown or already-tagged id; dropping', {
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
