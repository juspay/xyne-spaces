import { ChannelScopeType, UserType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { logger } from '@/utils/logger';

// Keyterms bias ElevenLabs realtime STT towards words it would otherwise misspell:
// the speaker's people, our product names and bot names.

const TAG = '[VoiceInputStream]';

export type VoiceInputUser = { userId: string; workspaceId: string };

const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 20;
const MIN_NAME_WORD_LENGTH = 3;
const BOT_NAMES_TTL_MS = 60 * 60 * 1000;
const BOT_NAMES_MAX_WORKSPACES = 100;
// How long a cold names lookup may delay the upstream connect.
const COLD_LOOKUP_WAIT_MS = 300;
const RECENT_DM_PARTNERS = 20;
const PERSONAL_NAMES_TTL_MS = 10 * 60 * 1000;
const PERSONAL_NAMES_MAX_USERS = 500;

// Product terms: _HOT_WORDS in python-agent/transcribe_audio_handler.py, plus the newer
// Xyne products it does not list yet.
const STATIC_KEYTERMS = [
  'Xyne',
  'Xyne Claw',
  'Xyne Desk',
  'Xyne Scribe',
  'Xyne Search',
  'Xyne Calls',
  'Juspay Euler',
  'Namma Cloud',
  'Xyne Chats',
  'Xyne Tickets',
  'Juspay Hyperswitch',
  'Xyne Support',
  'Namma Yatri',
  'Xyne Spaces',
  'Juspay',
  'Xyne Code',
  'Xyne Training',
  'Namma Bengaluru',
  'Xyne Automatic',
  'Xyne AI',
  'Xyne Assistant',
  'Namma Shuttle',
  'Xyne Agent',
  'Xyne Bot',
  'Juspay Technologies',
  'Namma Switch',
];

type NamesEntry = { names: string[]; expiresAt: number };

// Names lookups must never hold up a voice session. Cached names are returned at once, even
// expired ones, while a refresh runs in the background. A cold cache waits briefly for the
// lookup, then moves on without names; the lookup still finishes and fills the cache.
function createNamesCache(
  label: string,
  ttlMs: number,
  maxEntries: number,
  load: (user: VoiceInputUser) => Promise<string[]>
): (key: string, user: VoiceInputUser) => Promise<string[]> {
  const entries = new Map<string, NamesEntry>();
  const refreshing = new Map<string, Promise<string[]>>();

  const refresh = (key: string, user: VoiceInputUser): Promise<string[]> => {
    const running = refreshing.get(key);
    if (running) return running;
    const promise = load(user)
      .then(names => {
        if (!entries.has(key) && entries.size >= maxEntries) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
        entries.set(key, { names, expiresAt: Date.now() + ttlMs });
        return names;
      })
      .catch(err => {
        logger.warn(`${TAG} Failed to load ${label} for keyterms:`, err);
        return entries.get(key)?.names ?? [];
      })
      .finally(() => refreshing.delete(key));
    refreshing.set(key, promise);
    return promise;
  };

  return async (key, user) => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.names;
    const pending = refresh(key, user);
    if (entry) return entry.names;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string[]>(resolve => {
      timer = setTimeout(() => resolve([]), COLD_LOOKUP_WAIT_MS);
    });
    return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  };
}

// Bots of the speaker's workspace. The tenant scope applies the workspace filter; the explicit
// workspaceId keeps it right even if the scope is ever dropped.
const getBotNames = createNamesCache(
  'bot names',
  BOT_NAMES_TTL_MS,
  BOT_NAMES_MAX_WORKSPACES,
  user =>
    runWithContext({ userId: user.userId, workspaceId: user.workspaceId }, async () => {
      const bots = await DatabaseClient.getInstance().user.findMany({
        where: { userType: UserType.BOT, workspaceId: user.workspaceId },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      return bots.map(b => (b.name || '').trim()).filter(Boolean);
    })
);

// The speaker's own name, then the people they DM'd most recently, so their names are
// spelled right. Scoped to the speaker's tenant context like any user query.
const getPersonalNames = createNamesCache(
  'personal names',
  PERSONAL_NAMES_TTL_MS,
  PERSONAL_NAMES_MAX_USERS,
  user =>
    runWithContext({ userId: user.userId, workspaceId: user.workspaceId }, async () => {
      const db = DatabaseClient.getInstance();
      const [self, dms] = await Promise.all([
        db.user.findUnique({ where: { id: user.userId }, select: { name: true } }),
        db.channel.findMany({
          where: {
            scopeType: ChannelScopeType.DM,
            participants: { some: { userId: user.userId } },
          },
          orderBy: { lastActivityAt: 'desc' },
          take: RECENT_DM_PARTNERS,
          select: {
            participants: {
              where: { userId: { not: user.userId } },
              select: { user: { select: { name: true } } },
            },
          },
        }),
      ]);
      return [self?.name, ...dms.flatMap(d => d.participants.map(p => p.user.name))]
        .map(name => (name || '').trim())
        .filter(Boolean);
    })
);

// Names are often stored as handles ("vinit.khandal", "priya_s@acme.com"); a keyterm is
// copied into the transcript verbatim, so bias towards the spoken form ("Vinit Khandal").
function spokenName(name: string): string {
  return name
    .replace(/@.*$/, '')
    .split(/[\s._]+/)
    .filter(Boolean)
    .map(word => (word === word.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// A name over the keyterm length limit contributes its individual words instead.
function nameTerms(rawName: string): string[] {
  const name = spokenName(rawName);
  return name.length <= MAX_KEYTERM_LENGTH
    ? [name]
    : name.split(' ').filter(word => word.length >= MIN_NAME_WORD_LENGTH);
}

// Recognition bias terms, most important first (the cap drops the tail): personal names,
// product terms, then bot names. Names that are not cached yet are left out, never awaited long.
export async function buildKeyterms(user: VoiceInputUser): Promise<string[]> {
  const [personalNames, botNames] = await Promise.all([
    getPersonalNames(user.userId, user),
    getBotNames(user.workspaceId, user),
  ]);

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of [...personalNames.flatMap(nameTerms), ...STATIC_KEYTERMS, ...botNames]) {
    const key = term.toLowerCase();
    if (term.length > MAX_KEYTERM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.slice(0, MAX_KEYTERMS);
}
