import type { ActionDefinition, ChannelRef, PersonRef } from '@xyne/shared/assistant';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { detailsPrompt, NO_DETAILS, parseDetailsReply, type ChatMessage, type ReadDetails } from './details';
import { normalizeName, type FoundRecord, type RecordFinder } from './records';
import { parseSession, serializeSession, sessionKey, SESSION_IDLE_SECONDS, type SessionStore } from './session';

/**
 * The real services behind the assistant's pure logic: Redis for the session, the database
 * for names, and LiteLLM for reading details. Nothing else in this folder does I/O.
 */

export const redisSessionStore: SessionStore = {
  async load(identity) {
    return parseSession(await redisService.get(sessionKey(identity)));
  },
  async save(identity, session) {
    await redisService.set(sessionKey(identity), serializeSession(session), SESSION_IDLE_SECONDS);
  },
};

/** Rows fetched per lookup; ranking happens in `matchName`. */
const MAX_ROWS = 25;

/**
 * Looks names up inside the request, so the app's own rules apply: people in the user's
 * workspace, and channels the user can open.
 */
export function databaseFinder(selfId: string): RecordFinder {
  return {
    async find(kind, mention) {
      const words = normalizeName(mention)
        .split(' ')
        .filter(word => word.length >= 2)
        .slice(0, 3);
      if (!words.length) return [];
      switch (kind) {
        case 'person':
          return findPeople(words, selfId);
        case 'channel':
          return findChannels(words);
        case 'thread':
          return [];
      }
    },
  };
}

async function findPeople(words: string[], selfId: string): Promise<FoundRecord[]> {
  const rows = await db.user.findMany({
    where: {
      status: 'ACTIVE',
      id: { not: selfId },
      OR: words.flatMap(word => [
        { name: { contains: word, mode: 'insensitive' as const } },
        { displayName: { contains: word, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true, name: true, displayName: true, email: true },
    take: MAX_ROWS,
  });
  return rows.map(row => {
    const record: PersonRef = { kind: 'person', id: row.id, name: row.displayName || row.name };
    return { record, detail: row.email };
  });
}

async function findChannels(words: string[]): Promise<FoundRecord[]> {
  const rows = await db.channel.findMany({
    where: {
      scopeType: 'DEFAULT',
      isArchived: false,
      AND: words.map(word => ({ name: { contains: word, mode: 'insensitive' as const } })),
    },
    select: { id: true, name: true },
    take: MAX_ROWS,
  });
  return rows.map(row => {
    const record: ChannelRef = { kind: 'channel', id: row.id, name: row.name };
    return { record, detail: `#${row.name}` };
  });
}

/** Past this, the turn goes on without details and asks for them instead. */
const DETAILS_TIMEOUT_MS = 6000;

export function isDetailsConfigured(): boolean {
  return Boolean(config.assistant.model && config.litellm.baseUrl && config.litellm.apiKey);
}

/** Reads details with the configured LiteLLM model. Never throws: a failure means no details. */
export async function readDetailsWithLiteLLM(
  text: string,
  candidates: readonly ActionDefinition[],
  inProgress: { action: string; asking: string | null } | null,
): Promise<ReadDetails> {
  if (!candidates.length) return NO_DETAILS;
  try {
    const reply = await complete(detailsPrompt(text, candidates, inProgress));
    return parseDetailsReply(reply, candidates);
  } catch (error) {
    logger.warn('[assistant] could not read details', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NO_DETAILS;
  }
}

async function complete(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${config.litellm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.litellm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.assistant.model,
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`LiteLLM answered ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? '';
}
