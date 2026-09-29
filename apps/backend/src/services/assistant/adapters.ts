import type { Prisma } from '@prisma/client';
import type { ChannelRef, MessageRef, PersonRef, ThreadRef } from '@xyne/shared/assistant';
import type { ACLContext } from '@/database/acl/base-acl';
import { ChannelsACL } from '@/database/acl/tables/channels-acl';
import { UsersACL } from '@/database/acl/tables/users-acl';
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

/**
 * The real services behind the assistant: Redis for the session, the database for names, and
 * Vespa for past messages.
 */

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
export function databaseFinder(context: ACLContext): RecordFinder {
  const usersAcl = new UsersACL(context, db);
  const channelsAcl = new ChannelsACL(context, db);

  return {
    async find(kind, mention, hints) {
      if (kind === 'thread') return findConversations(mention, context.userId, hints);
      const words = normalizeName(mention)
        .split(' ')
        .filter((word) => word.length >= 2)
        .slice(0, 3);
      if (!words.length) return [];
      switch (kind) {
        case 'person':
          return findPeople(words, context.userId, (await usersAcl.getWhereClause()) ?? {});
        case 'channel':
          return findChannels(words, (await channelsAcl.getWhereClause()) ?? {});
        case 'message':
          // A message is only ever the one on screen ("this message"), never found by name.
          return [];
      }
    },
    async get(kind, id) {
      const channel = {
        is: { AND: [{ isArchived: false }, (await channelsAcl.getWhereClause()) ?? {}] },
      };
      switch (kind) {
        case 'channel': {
          const row = await db.channel.findFirst({
            where: { id, ...channel.is },
            select: { id: true, name: true },
          });
          return row ? channelRecord(row) : null;
        }
        case 'thread': {
          const row = await db.conversation.findFirst({
            where: { conversationId: id, channel },
            select: { channel: { select: { id: true, name: true } } },
          });
          const record: ThreadRef | null = row && {
            kind: 'thread',
            id,
            name: 'this thread',
            channelId: row.channel.id,
            channelName: row.channel.name,
          };
          return record && { record };
        }
        case 'message': {
          const row = await db.message.findFirst({
            where: {
              messageId: id,
              isDeleted: false,
              OR: [{ visibleTo: null }, { visibleTo: context.userId }],
              conversation: { is: { channel } },
            },
            select: { conversation: { select: { channelId: true } } },
          });
          const record: MessageRef | null = row && {
            kind: 'message',
            id,
            name: 'this message',
            channelId: row.conversation.channelId,
          };
          return record && { record };
        }
        default:
          return null;
      }
    },
  };
}

/** Rows fetched per lookup; `matchName` ranks them. */
const MAX_PEOPLE = 250;
const MAX_CHANNELS = 25;

/** First try all spoken words; on a miss, allow one name word to be misheard. */
async function findPeople(
  words: string[],
  selfId: string,
  access: Prisma.UserWhereInput
): Promise<FoundRecord[]> {
  const byName = await people(selfId, access, { AND: words.map(nameHas) });
  if (byName.length > 0) return byName;
  // One word may be misheard: match its first letter, and every other word as said. Requiring
  // the other words keeps a common word such as "doctor" from pulling unrelated people.
  return people(selfId, access, {
    OR: words.map((word, index) => ({
      AND: [
        { OR: likelyInitials(word).map(nameStarts) },
        ...words.filter((_, other) => other !== index).map(nameHas),
      ],
    })),
  });
}

function nameHas(word: string): Prisma.UserWhereInput {
  const contains = { contains: word, mode: 'insensitive' as const };
  return { OR: [{ name: contains }, { displayName: contains }] };
}

function nameStarts(letter: string): Prisma.UserWhereInput {
  const startsWith = { startsWith: letter, mode: 'insensitive' as const };
  return { OR: [{ name: startsWith }, { displayName: startsWith }] };
}

/** X and Z can be confused at the start of a spoken name ("Xyne" / "Zyne"). */
function likelyInitials(word: string): string[] {
  const initial = word.charAt(0);
  return initial === 'x' || initial === 'z' ? ['x', 'z'] : [initial];
}

async function people(
  selfId: string,
  access: Prisma.UserWhereInput,
  match: Prisma.UserWhereInput
): Promise<FoundRecord[]> {
  const rows = await db.user.findMany({
    where: {
      AND: [{ status: 'ACTIVE', id: { not: selfId }, ...match }, access],
    },
    select: { id: true, name: true, displayName: true, email: true, userType: true },
    take: MAX_PEOPLE,
  });
  return rows.map((row) => {
    const record: PersonRef = { kind: 'person', id: row.id, name: row.displayName || row.name };
    return {
      record,
      detail: row.userType === 'USER' ? row.email : row.userType === 'BOT' ? 'Agent' : 'App',
    };
  });
}

async function findChannels(
  words: string[],
  access: Prisma.ChannelWhereInput
): Promise<FoundRecord[]> {
  const rows = await db.channel.findMany({
    where: {
      AND: [
        {
          scopeType: 'DEFAULT',
          isArchived: false,
          AND: words.map((word) => ({ name: { contains: word, mode: 'insensitive' as const } })),
        },
        access,
      ],
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
        ...(hints.people.length
          ? { participants: hints.people, participantsMode: 'all' as const }
          : {}),
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
