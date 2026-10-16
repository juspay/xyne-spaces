import type { UserTags } from '../api/xyneAIEvents';

interface DirectoryUser {
  id: string;
  name: string;
  displayName?: string | null | undefined;
  email: string;
}

type MentionResolver = (name: string) => string | undefined;

const normalize = (name: string): string => name.trim().toLowerCase();

const directoryIndexes = new WeakMap<readonly DirectoryUser[], Map<string, string | null>>();

// Built once per users list and shared by every answer; a name two people share maps to no one.
function directoryIndex(users: readonly DirectoryUser[]): Map<string, string | null> {
  const cached = directoryIndexes.get(users);
  if (cached) return cached;
  const ids = new Map<string, string | null>();
  for (const { id, name, displayName, email } of users) {
    for (const key of [name, displayName, email.split('@')[0]]) {
      const known = key ? ids.get(normalize(key)) : undefined;
      if (key) ids.set(normalize(key), known === undefined || known === id ? id : null);
    }
  }
  directoryIndexes.set(users, ids);
  return ids;
}

/** Maps a mentioned name to a user id. The run's `userTags` are authoritative; the directory fills in the rest. */
export function buildMentionResolver(
  userTags: UserTags | undefined,
  users: readonly DirectoryUser[],
): MentionResolver {
  const directory = directoryIndex(users);
  const tagged = new Map<string, string>();
  for (const [tag, { name, userId }] of Object.entries(userTags ?? {})) {
    tagged.set(normalize(tag.replace(/^[<@]|>$/g, '')), userId);
    tagged.set(normalize(name), userId);
  }
  return name => {
    const key = normalize(name);
    return tagged.get(key) ?? directory.get(key) ?? undefined;
  };
}

// `@First Last` (up to four words, which may hold . _ -) or a `<Full Name>` placeholder.
const MENTION_RE =
  /(^|\W)(?:@([A-Za-z0-9][\w.-]*(?: [A-Za-z0-9][\w.-]*){0,3})|<([A-Z][^<>\n:/=]*)>)/g;

const mentionLink = (name: string, userId: string): string =>
  `[@${name}](xyne://user/${encodeURIComponent(userId)})`;

// An `@` run tags its longest leading words that resolve; the rest stays text.
function linkAtMention(run: string, resolve: MentionResolver): string | undefined {
  const words = run.split(' ');
  for (let count = words.length; count > 0; count -= 1) {
    const name = words.slice(0, count).join(' ');
    for (const candidate of [name, name.replace(/[.,;:!?-]+$/, '')]) {
      const userId = resolve(candidate);
      if (userId) return mentionLink(candidate, userId) + run.slice(candidate.length);
    }
  }
  return undefined;
}

// Fenced blocks (closed or still streaming) and inline code are left exactly as written.
const CODE_RE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

const outsideCode = (markdown: string, transform: (prose: string) => string): string =>
  markdown
    .split(CODE_RE)
    .map((part, index) => (index % 2 === 0 ? transform(part) : part))
    .join('');

/**
 * Turns resolved `@Name` / `<Name>` into tappable mention links. An unresolved
 * `<Name>` is escaped so markdown does not drop it as an HTML tag.
 */
export const linkMentions = (markdown: string, resolve: MentionResolver): string =>
  outsideCode(markdown, prose =>
    prose.replace(MENTION_RE, (_match, lead: string, at?: string, angled?: string) => {
      if (at !== undefined) return lead + (linkAtMention(at, resolve) ?? `@${at}`);
      const userId = resolve(angled ?? '');
      return lead + (userId ? mentionLink(angled ?? '', userId) : `\\<${angled}>`);
    }),
  );

const RELATIVE_LINK_RE = /\]\((\/(?!\/)[^)\s]*)\)/g;

/** The dashboard answers with app-relative links; the in-app link helpers need absolute ones. */
export const absolutizeDashboardLinks = (
  markdown: string,
  origins: { app: string; dashboard: string },
): string =>
  outsideCode(markdown, prose =>
    prose.replace(RELATIVE_LINK_RE, (_match, path: string) => {
      const origin = path.includes('/chat/canvas/') ? origins.dashboard : origins.app;
      return `](${origin.replace(/\/$/, '')}${path})`;
    }),
  );
