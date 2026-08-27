import { z } from 'zod';
import {
  OrgLLMServiceAccountPurpose,
  isHumanApplied,
  parseAppliedTags,
  serializeAppliedTags,
  type AppliedTag,
  type ThreadTypeEntry,
} from '@xyne/shared';
import { config } from '@/config/env';
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
import { getThreadTypeVocabulary } from './vocabulary';

const TAG = '[MessageClassification]';

/**
 * Minimum thread size to classify. 1 by default: the queue defers every thread to midnight
 * and dedupes per thread, so a short thread costs one call for its whole life — the
 * threshold no longer buys anything, and a one-message thread still has a clear type.
 */
export const MIN_THREAD_SIZE = Number(
  process.env['MESSAGE_CLASSIFICATION_MIN_THREAD_SIZE'] ?? 1,
);

/** Upper bound on messages sent to the model in one pass. */
const MAX_THREAD_CONTEXT = 60;

/** A ticket description can be pages long; the opening is where the intent lives. */
const TICKET_DESCRIPTION_LIMIT = 1000;

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
 * Has a person ruled on this thread's tags?
 *
 * A curated thread is never sent to the model again — not to protect cost, but because a
 * re-run would argue with a decision someone already made. Three things count as a ruling:
 *
 *  - the column is non-null but holds no tags: the legacy '[]' a clear used to write
 *  - any tag is tombstoned: someone removed it, and a removal is the one edit that leaves
 *    no other trace, so re-deriving would hand it straight back
 *  - any VOCABULARY tag was applied by hand: a person picked the type themselves
 *
 * A free-form tag deliberately does NOT count. Inventing "gateway-timeout" says nothing
 * about whether ISSUE is right or whether HOW_TO should appear once the fix is posted — and
 * the classifier can only ever emit vocabulary names, so it cannot touch the free-form one.
 */
const isCurated = (
  raw: string | null,
  tags: AppliedTag[],
  vocabulary: readonly ThreadTypeEntry[],
): boolean => {
  if (raw === null) return false;
  if (tags.length === 0) return true;

  const known = new Set(vocabulary.map(entry => entry.name));
  return tags.some(
    tag => tag.removed === true || (isHumanApplied(tag) && known.has(tag.name)),
  );
};

/**
 * Enough has been said since the last pass to be worth another look.
 *
 * `max(at)` across the thread's tags IS the last-classification time, so no extra column is
 * needed to remember it. The floor stops a one-word "thanks" buying a model call.
 */
const MIN_NEW_MESSAGES_TO_RECLASSIFY = Number(
  process.env['MESSAGE_CLASSIFICATION_MIN_NEW_MESSAGES'] ?? 3,
);

const newMessagesSince = (tags: AppliedTag[], messages: { createdAt: Date }[]): number => {
  const lastPass = Math.max(0, ...tags.map(tag => tag.at));
  // A legacy tag carries at:0, which would make every message look new. Treating it as
  // "never classified" is right: nothing is known about when it was tagged.
  return messages.filter(message => message.createdAt.getTime() > lastPass).length;
};

/**
 * Classify a thread in one LLM call and apply the results.
 *
 * The model returns thread types, each citing the messages that evidence it. Both halves are
 * stored: the types land on the conversation, and every cited message gets the types it is
 * the source for — so a chip on a thread can always be traced to the message that caused it.
 *
 * Everything the classifier writes is AI-applied and approved; a person's tags carry their
 * own provenance and are never touched here.
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
    select: { id: true, workspaceId: true },
  });
  if (!channel) {
    return { tagged: 0, skipped: 'no-channel' };
  }

  // The vocabulary is per workspace and editable at runtime, so it is fetched once and
  // threaded through everything below: the freeze check needs it to tell a vocabulary tag
  // from a free-form one, and the same list generates the prompt AND validates what comes
  // back. Building the prompt from one list and checking answers against another is how a
  // workspace ends up with every model answer silently dropped.
  const vocabulary = await getThreadTypeVocabulary(channel.workspaceId);

  // A workspace whose vocabulary is empty has not set one up, or has removed everything.
  // Bail rather than prompt the model with no types: it would either invent names that fail
  // validation and get dropped, or return nothing, and either way every thread would cost an
  // LLM call to achieve nothing.
  if (vocabulary.length === 0) {
    return { tagged: 0, skipped: 'no-vocabulary' };
  }

  const existingTags = parseAppliedTags(conversation.threadType);
  if (isCurated(conversation.threadType, existingTags, vocabulary)) {
    return { tagged: 0, skipped: 'curated-by-hand' };
  }

  // A ticket's title and description are usually the clearest statement of what the thread
  // is about — someone wrote them deliberately, unlike the conversation itself. Fetched
  // before the size guard: a thread created FROM a ticket has only a SYSTEM notice in it,
  // so it would otherwise bail as too short with its best signal unread.
  const ticket = await db.ticket.findFirst({
    where: { conversationId },
    select: { title: true, description: true },
    orderBy: { createdAt: 'asc' },
  });

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
    // Newest first, reversed below: taking the oldest N would never reach a long thread's
    // recent messages.
    orderBy: { createdAt: 'desc' },
    take: MAX_THREAD_CONTEXT,
  });

  messages.reverse(); // back to chronological — the model is told the thread is in order

  // Every message is offered as context: the model is classifying the thread, and it needs
  // the whole thing to pick which messages are the evidence for each type.
  const threadMessages: ClassifierMessage[] = messages
    .map(m => ({
      id: m.messageId,
      text: stripHtml(m.content ?? ''),
      author_display_name: m.sender?.name ?? 'Unknown',
      timestamp_iso: m.createdAt.toISOString(),
    }))
    .filter(m => m.text.length > 0);

  if (threadMessages.length < MIN_THREAD_SIZE && !ticket) {
    return { tagged: 0, skipped: 'thread-too-short' };
  }

  // Already classified, and not curated. Worth re-reading only if the thread has actually
  // moved on — otherwise a re-run pays for the same answer.
  if (existingTags.length > 0) {
    const fresh = newMessagesSince(existingTags, messages);
    if (fresh < MIN_NEW_MESSAGES_TO_RECLASSIFY) {
      return { tagged: 0, skipped: 'nothing-new' };
    }
    logger.info(`${TAG} Re-classifying a thread that has grown`, {
      conversationId,
      newMessages: fresh,
      existing: existingTags.map(tag => tag.name),
    });
  }

  // Passed as a fact, not a rule — what it implies lives in the prompt, not in code.
  const rootMessage = await db.message.findUnique({
    where: { messageId: conversation.initialMessageId },
    select: { msgType: true },
  });
  const rootIsBot = rootMessage?.msgType === 'BOT';

  const modelName = config.messageClassification.model;
  const { threadTypes } = await classifyThread(
    {
      thread_messages: threadMessages,
      root_is_bot: rootIsBot,
      ...(ticket && {
        ticket: {
          title: ticket.title,
          description: stripHtml(ticket.description).slice(0, TICKET_DESCRIPTION_LIMIT),
        },
      }),
    },
    null,
    channel.workspaceId,
    modelName,
    vocabulary,
  );

  const now = Date.now();

  // Everything the model produced, merged onto what is already there. A tag with no cited
  // message still counts for the thread — a type derived from the ticket has no message
  // behind it.
  //
  // Additive, and existing entries are kept untouched. Two reasons: a tag that survives a
  // re-run keeps its ORIGINAL timestamp and cited message, so the tooltip goes on meaning
  // "first tagged" rather than silently becoming "last classified"; and a type the model
  // happens not to repeat this time is not removed, so chips do not flicker with model
  // variance between runs.
  // No evidence pointer on the thread. The model's citations decide which MESSAGES get the
  // tag, and that is the whole record: to see why a thread is an ISSUE you look at which of
  // its messages carry ISSUE — messages the thread view has already loaded. A pointer here
  // would duplicate that into a column replicated to every client, and nothing read it.
  const byName = new Map(existingTags.map(tag => [tag.name, tag]));
  for (const type of threadTypes) {
    if (byName.has(type.name)) continue;
    byName.set(type.name, { name: type.name, at: now });
  }
  const threadTags: AppliedTag[] = [...byName.values()];

  // Inverted: messageId -> the types it is the evidence for. A message can justify several
  // types, and a type can cite several messages, so this is many-to-many.
  const byMessage = new Map<string, AppliedTag[]>();
  for (const type of threadTypes) {
    for (const messageId of type.sourceMessageIds) {
      const tags = byMessage.get(messageId) ?? [];
      // The tag alone: which messages evidence a type IS the record, so nothing points back.
      // The model's citations decide which messages land here, and that is the whole trail —
      // reading it back is a matter of asking which messages carry the name.
      tags.push({ name: type.name, at: now });
      byMessage.set(messageId, tags);
    }
  }

  let tagged = 0;
  for (const [messageId, tags] of byMessage) {
    await writeMessageTags(messageId, tags);
    await refeedToVespa(messageId, conversation.workspaceId);
    tagged += tags.length;
  }

  const nextThreadType = threadTags.length > 0 ? serializeAppliedTags(threadTags) : null;
  if (nextThreadType) {
    await db.conversation.update({
      where: { conversationId },
      data: { threadType: nextThreadType },
    });
    // The root message doc is the one carrying the thread type, so it needs refeeding even
    // if its own tags didn't change.
    await refeedToVespa(conversation.initialMessageId, conversation.workspaceId);
  }

  return { tagged, threadType: nextThreadType };
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

/**
 * Add the classifier's tags to a message, keeping whatever is already there.
 *
 * A merge, not an overwrite: a person may have tagged this message by hand, and a later pass
 * must not erase that. Existing names win — a tag someone deactivated stays deactivated
 * rather than being re-applied by the next run.
 */
async function writeMessageTags(messageId: string, tags: AppliedTag[]): Promise<void> {
  const message = await db.message.findUnique({
    where: { messageId },
    select: { messageActs: true },
  });
  if (!message) {
    logger.warn(`${TAG} Model cited a message that no longer exists`, { messageId });
    return;
  }

  const existing = parseAppliedTags(message.messageActs);
  const known = new Set(existing.map(tag => tag.name));
  const merged = [...existing, ...tags.filter((tag: AppliedTag) => !known.has(tag.name))];

  await db.message.update({
    where: { messageId },
    data: { messageActs: serializeAppliedTags(merged) },
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
}

interface ClassifierInput {
  thread_messages: ClassifierMessage[];
  /** True when a bot or automated system opened the thread. Gates the ALERT type. */
  root_is_bot: boolean;
  /** Present when the thread was turned into a ticket. */
  ticket?: { title: string; description: string };
}

/** One thread type the model returned, with the messages it says justify it. */
export interface ClassifiedType {
  name: string;
  /** Always ids that were actually sent. Empty when the type came from the ticket. */
  sourceMessageIds: string[];
}

interface Classification {
  /** The thread as a whole — a thread can be several things at once. */
  threadTypes: ClassifiedType[];
}

/** No more than this many citations per type, matching what the prompt asks for. */
const MAX_SOURCES_PER_TYPE = 3;

// Lenient on purpose: the model's raw shape is untrusted. Anything unrecognised is dropped
// rather than failing the whole job. Both the current object form and a bare list of names
// are accepted — a smaller model asked for objects will sometimes answer with strings.
const RawTypeSchema = z.union([
  z.string(),
  z.object({
    name: z.string().nullish(),
    // Tolerate a bare string as well as an array: models collapse single-element arrays
    // even when the schema asks for one.
    sourceMessageIds: z.union([z.string(), z.array(z.string())]).nullish(),
  }),
]);

const RawOutputSchema = z.object({
  threadTypes: z.union([RawTypeSchema, z.array(RawTypeSchema)]).nullish(),
});

const asArray = <T,>(value: T | T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

/**
 * Coerce onto the closed vocabulary. Near-misses (case, hyphens, whitespace) are worth
 * normalising; guessing at genuinely unknown values is not, so those become null.
 */
const coerce = (raw: string | null | undefined, valid: Set<string>): string | null => {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return valid.has(normalized) ? normalized : null;
};

/**
 * The key minted for this classifier alone, so its rate limit and spend are its own. Env
 * rather than an org service-account row: one key for the worker, nothing to provision.
 */
const dedicatedCredential = (): OrgLLMCredential | null => {
  const { threadTypeClassificationApiKey: apiKey, baseUrl } = config.litellm;
  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl, defaultModel: null, purpose: OrgLLMServiceAccountPurpose.DEFAULT };
};

async function classifyThread(
  input: ClassifierInput,
  projectId: string | null,
  workspaceId: string,
  modelName: string,
  vocabulary: readonly ThreadTypeEntry[],
): Promise<Classification> {
  const credential =
    dedicatedCredential() ??
    (projectId
      ? await orgLLMCredentialService.getCredentialByProjectId(
          projectId,
          OrgLLMServiceAccountPurpose.DEFAULT,
        )
      : await orgLLMCredentialService.getCredentialByWorkspaceId(
          workspaceId,
          OrgLLMServiceAccountPurpose.DEFAULT,
        ));
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  const output = await callLiteLLM(credential, modelName, [
    { role: 'system', content: buildClassifierPrompt(vocabulary) },
    { role: 'user', content: JSON.stringify(input, null, 2) },
  ]);

  // Strip reasoning blocks and pull the first JSON object out — models wrap output in
  // prose or fences no matter how firmly the prompt says not to.
  const cleaned = output.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = RawOutputSchema.parse(JSON.parse(jsonMatch ? jsonMatch[0] : cleaned));

  // Only ids that were actually sent. Blocks a hallucinated citation, which would otherwise
  // become a Prisma update against a message that does not exist.
  const sentIds = new Set(input.thread_messages.map(m => m.id));
  const validThreadTypes = new Set(vocabulary.map(entry => entry.name));

  const threadTypes: ClassifiedType[] = [];
  const seen = new Set<string>();

  for (const raw of asArray(parsed.threadTypes)) {
    const rawName = typeof raw === 'string' ? raw : raw.name;
    const name = coerce(rawName, validThreadTypes);
    if (!name) {
      logger.warn('[MessageClassifier] Unusable thread type; dropping', { returned: rawName });
      continue;
    }
    // A model asked for several types will sometimes repeat one; first citation wins.
    if (seen.has(name)) continue;
    seen.add(name);

    const cited = typeof raw === 'string' ? [] : asArray(raw.sourceMessageIds);
    const sourceMessageIds = [...new Set(cited)]
      .filter(id => {
        if (sentIds.has(id)) return true;
        logger.warn('[MessageClassifier] Type cited an unknown message id; dropping citation', {
          type: name,
          returned: id,
        });
        return false;
      })
      .slice(0, MAX_SOURCES_PER_TYPE);

    threadTypes.push({ name, sourceMessageIds });
  }

  if (threadTypes.length === 0) {
    logger.warn('[MessageClassifier] Model returned no usable thread type', {
      returned: parsed.threadTypes,
    });
  }

  return { threadTypes };
}
