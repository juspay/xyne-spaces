import type { Prisma } from '@prisma/client';
import type { ChannelRef, PersonRef, ThreadRef } from '@xyne/shared/assistant';
import { db } from '@/database/client';
import { redisService } from '@/services/redisService';
import { vespaService } from '@/services/vespaSearch';
import {
  VespaDocType,
  type importedChannelFields,
  type VespaChatMessageDocument,
  type VespaSearchResult,
} from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import {
  normalizeName,
  UnavailableError,
  type FoundRecord,
  type RecordFinder,
  type SearchHints,
} from './records';
import {
  parseSession,
  serializeSession,
  sessionKey,
  SESSION_IDLE_SECONDS,
  type SessionStore,
} from './session';

/** The real services behind the assistant: Redis for the session, the database for names, and Vespa for past messages. */

export const redisSessionStore: SessionStore = {
  async load(identity) {
    return parseSession(await redisService.get(sessionKey(identity)));
  },
  async save(identity, session) {
    await redisService.set(sessionKey(identity), serializeSession(session), SESSION_IDLE_SECONDS);
  },
};

/**
 * Looks names up inside the request, so the app's own rules apply: people in the user's
 * workspace, and channels the user can open.
 */
export function databaseFinder(selfId: string): RecordFinder {
  return {
    async find(kind, mention, hints) {
      if (kind === 'thread') return findConversations(mention, selfId, hints);
      const words = normalizeName(mention)
        .split(' ')
        .filter((word) => word.length >= 2)
        .slice(0, 3);
      if (!words.length) return [];
      switch (kind) {
        case 'person':
          return findPeople(words, selfId);
        case 'channel':
          return findChannels(words);
      }
    },
    async get(kind, id) {
      if (kind !== 'channel') return null;
      const row = await db.channel.findFirst({
        where: { id, isArchived: false },
        select: { id: true, name: true },
      });
      return row ? channelRecord(row) : null;
    },
  };
}

/** Rows fetched per lookup; `matchName` ranks them. */
const MAX_PEOPLE = 250;
const MAX_CHANNELS = 25;

/**
 * People whose name contains every word said. A name heard by sound ("Dipanshu" for
 * "Deepanshu") matches none, so then the people whose name starts with the same letter are
 * fetched, and `matchName` compares how they sound.
 */
async function findPeople(words: string[], selfId: string): Promise<FoundRecord[]> {
  const byName = await people(selfId, {
    AND: words.map((word) => ({
      OR: [
        { name: { contains: word, mode: 'insensitive' as const } },
        { displayName: { contains: word, mode: 'insensitive' as const } },
      ],
    })),
  });
  if (byName.length > 0) return byName;
  const initial = words[0]?.charAt(0) ?? '';
  return people(selfId, {
    OR: [
      { name: { startsWith: initial, mode: 'insensitive' as const } },
      { displayName: { startsWith: initial, mode: 'insensitive' as const } },
    ],
  });
}

async function people(selfId: string, match: Prisma.UserWhereInput): Promise<FoundRecord[]> {
  const rows = await db.user.findMany({
    where: { status: 'ACTIVE', id: { not: selfId }, ...match },
    select: { id: true, name: true, displayName: true, email: true },
    take: MAX_PEOPLE,
  });
  return rows.map((row) => {
    const record: PersonRef = { kind: 'person', id: row.id, name: row.displayName || row.name };
    return { record, detail: row.email };
  });
}

async function findChannels(words: string[]): Promise<FoundRecord[]> {
  const rows = await db.channel.findMany({
    where: {
      scopeType: 'DEFAULT',
      isArchived: false,
      AND: words.map((word) => ({ name: { contains: word, mode: 'insensitive' as const } })),
    },
    select: { id: true, name: true },
    take: MAX_CHANNELS,
  });
  return rows.map(channelRecord);
}

function channelRecord(row: { id: string; name: string }): FoundRecord {
  const record: ChannelRef = { kind: 'channel', id: row.id, name: row.name };
  return { record, detail: `#${row.name}` };
}

/** Conversations offered per search, one button each. */
const MAX_CONVERSATIONS = 8;
const SNIPPET_LENGTH = 60;

/**
 * Past messages about `topic` in the channels and DMs the user can read (Vespa applies their
 * access, and a fuzzy pass catches misheard words), one per thread, best match first. Named
 * people keep threads they took part in; a named channel keeps threads in it.
 */
async function findConversations(
  topic: string,
  selfId: string,
  hints: SearchHints = { people: [], channels: [] }
): Promise<FoundRecord[]> {
  try {
    const response = await vespaService.searchService.searchVespa(topic, selfId, ['chat'], {
      groupBy: '',
      limit: MAX_CONVERSATIONS * 3,
      slack: {
        docType: [VespaDocType.MESSAGE],
        ...(hints.people.length ? { participants: hints.people } : {}),
        ...(hints.channels.length ? { channelId: hints.channels } : {}),
      },
    });
    const found = new Map<string, FoundRecord>();
    for (const { fields } of response.root.children ?? []) {
      if (!isMessage(fields)) continue;
      const thread = fields.threadId || fields.docId;
      const { channelId } = fields;
      if (!thread || !channelId || found.has(thread)) continue;
      const channelName = fields.channelName ?? fields.messageChannelName ?? '';
      const record: ThreadRef = {
        kind: 'thread',
        id: thread,
        name: snippetOf(fields.text),
        channelId,
        channelName,
      };
      const where = fields.isIm || fields.isMpim ? 'Direct message' : `#${channelName}`;
      found.set(thread, { record, detail: [where, fields.username].filter(Boolean).join(' · ') });
      if (found.size === MAX_CONVERSATIONS) break;
    }
    return [...found.values()];
  } catch (error) {
    logger.warn('[assistant] conversation search failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new UnavailableError(
      'Message search isn’t available right now. Please try again in a moment.'
    );
  }
}

/** A chat message hit, with the channel fields the search joins onto it. */
type MessageHit = VespaChatMessageDocument & Partial<importedChannelFields>;

function isMessage(fields: VespaSearchResult | undefined): fields is MessageHit {
  return fields !== undefined && 'threadId' in fields;
}

/** The start of a message, without the search's highlight tags. */
function snippetOf(text: string): string {
  const plain = text
    .replace(/<\/?hi>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > SNIPPET_LENGTH ? `${plain.slice(0, SNIPPET_LENGTH - 1)}…` : plain;
}
