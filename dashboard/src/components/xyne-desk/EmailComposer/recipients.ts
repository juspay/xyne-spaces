import { type RecipientSuggestion } from '../RecipientSuggestionsDropdown/RecipientSuggestionsDropdown';

/**
 * Recipient-input helpers extracted from the EmailComposer body. Pure
 * functions / factories — they take their dependencies explicitly so the
 * composer file stays focused on layout + wiring.
 */

export type RecipientField = 'to' | 'cc' | 'bcc';

/** Parses RFC 5322-ish `Name <user@domain>` strings into name+email parts. */
export const parseFromField = (raw: string): { name: string; email: string | null } => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { name: 'Unknown', email: null };
  const match = trimmed.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (match) return { name: match[1]!.trim(), email: match[2]!.trim() };
  const emailOnly = trimmed.match(/^<?([^\s<>@]+@[^\s<>]+)>?$/);
  if (emailOnly)
    return { name: emailOnly[1]!.split('@')[0] ?? emailOnly[1]!, email: emailOnly[1]! };
  return { name: trimmed, email: null };
};

interface User {
  email?: string | null;
  name?: string | null;
}
interface DeskContact {
  email: string;
  name: string | null;
}
export interface ThreadEmail {
  from?: string | null;
  to?: ReadonlyArray<string> | null;
  cc?: ReadonlyArray<string> | null;
  bcc?: ReadonlyArray<string> | null;
  replyTo?: ReadonlyArray<string> | null;
}

export interface ComposerEmail extends ThreadEmail {
  id: string;
  createdAt: number;
}

/**
 * Merge org users, desk-mailbox contacts, and thread participants into a
 * single de-duplicated suggestion pool. Priority: org > desk > thread,
 * since org users have the most reliable name data. The desk's own
 * mailbox AND any configured send-as alias / DL are excluded from every
 * source — suggesting either would let users mail the desk itself.
 *
 * `selfEmails` accepts a string or list so callers can pass the bound
 * mailbox + alias together; legacy single-string callers still work.
 */
export const buildContactPool = (
  users: ReadonlyArray<User>,
  deskContacts: ReadonlyArray<DeskContact>,
  threadEmails: ReadonlyArray<ThreadEmail> | null | undefined,
  selfEmails: string | ReadonlyArray<string | null | undefined>,
): RecipientSuggestion[] => {
  const map = new Map<string, RecipientSuggestion>();
  const selfSet = new Set<string>(
    (Array.isArray(selfEmails) ? selfEmails : [selfEmails])
      .filter((s): s is string => !!s)
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0),
  );
  const isSelf = (email: string): boolean => selfSet.has(email);

  for (const u of users) {
    const email = (u.email || '').toLowerCase().trim();
    if (!email || isSelf(email)) continue;
    map.set(email, { email, name: u.name || undefined, source: 'org' });
  }
  for (const c of deskContacts) {
    const email = c.email.toLowerCase().trim();
    if (!email || isSelf(email) || map.has(email)) continue;
    map.set(email, { email, name: c.name || undefined, source: 'desk' });
  }
  const addRaw = (raw: string | null | undefined): void => {
    if (!raw) return;
    const parsed = parseFromField(raw);
    const email = (parsed.email || raw).toLowerCase().trim();
    if (!email || !email.includes('@') || isSelf(email) || map.has(email)) return;
    map.set(email, {
      email,
      name: parsed.email && parsed.name !== email ? parsed.name : undefined,
      source: 'thread',
    });
  };
  for (const e of threadEmails ?? []) {
    addRaw(e.from);
    e.to?.forEach(addRaw);
    e.cc?.forEach(addRaw);
    e.bcc?.forEach(addRaw);
    e.replyTo?.forEach(addRaw);
  }
  return Array.from(map.values());
};

const SOURCE_RANK: Record<RecipientSuggestion['source'], number> = {
  org: 0,
  desk: 1,
  thread: 2,
};
const MAX_SUGGESTIONS = 8;

/**
 * Filter the contact pool by the user's typed query and return the top
 * matches in source-priority + alphabetical order, capped to keep the
 * dropdown light.
 */
export const buildSuggestions = (
  contactPool: ReadonlyArray<RecipientSuggestion>,
  query: string,
  excludeEmails: ReadonlyArray<string>,
): RecipientSuggestion[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exclude = new Set(excludeEmails.map(e => e.toLowerCase()));
  const matches = contactPool.filter(c => {
    if (exclude.has(c.email)) return false;
    return c.email.toLowerCase().includes(q) || (c.name?.toLowerCase().includes(q) ?? false);
  });
  matches.sort((a, b) => {
    const sa = SOURCE_RANK[a.source];
    const sb = SOURCE_RANK[b.source];
    if (sa !== sb) return sa - sb;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });
  return matches.slice(0, MAX_SUGGESTIONS);
};

interface KeyDownDeps {
  field: RecipientField;
  inputValue: string;
  emails: ReadonlyArray<string>;
  setEmails: (next: string[]) => void;
  setInputValue: (next: string) => void;
  suggestions: ReadonlyArray<RecipientSuggestion>;
  suggestionIndex: number;
  setSuggestionIndex: (updater: (current: number) => number) => void;
  activeSuggestField: RecipientField | null;
  closeSuggestions: () => void;
  onSuggestionSelect: (field: RecipientField, email: string) => void;
}

/**
 * Split a raw input string on commas / whitespace and trim each segment. Return only
 * segments that look like an email address (contain '@') and are not
 * already in `existing`.
 */
export const splitAndValidateEmails = (raw: string, existing: ReadonlyArray<string>): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const existingSet = new Set(existing.map(e => e.trim().toLowerCase()));
  return trimmed
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.includes('@'))
    .filter(s => !existingSet.has(s.toLowerCase()));
};

/**
 * Build a recipient-field keyDown handler. Same shape works for To, Cc,
 * Bcc — the field-specific bits (which suggestions, which emails array,
 * which setters) are passed in via `deps`.
 *
 * Behavior:
 *  - ArrowUp/Down/Enter/Escape navigate the suggestion dropdown when open.
 *  - Enter / Comma / Space / Tab commit the typed value as a chip if it
 *    looks like an email and isn't already in the list.
 *  - Backspace on an empty input pops the last chip.
 */
export const makeRecipientKeyDownHandler = (
  deps: KeyDownDeps,
): ((e: React.KeyboardEvent<HTMLInputElement>) => void) => {
  return e => {
    const dropdownOpen = deps.activeSuggestField === deps.field && deps.suggestions.length > 0;

    if (dropdownOpen && e.key === 'ArrowDown') {
      e.preventDefault();
      deps.setSuggestionIndex(i => Math.min(i + 1, deps.suggestions.length - 1));
      return;
    }
    if (dropdownOpen && e.key === 'ArrowUp') {
      e.preventDefault();
      deps.setSuggestionIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (dropdownOpen && e.key === 'Escape') {
      e.preventDefault();
      deps.closeSuggestions();
      return;
    }
    if (dropdownOpen && e.key === 'Enter') {
      const picked = deps.suggestions[deps.suggestionIndex];
      if (picked) {
        e.preventDefault();
        deps.onSuggestionSelect(deps.field, picked.email);
        return;
      }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === 'Tab') {
      e.preventDefault();
      const newEmails = splitAndValidateEmails(deps.inputValue, deps.emails);
      if (newEmails.length > 0) {
        deps.setEmails([...deps.emails, ...newEmails]);
      }
      if (newEmails.length > 0 || deps.inputValue.includes('@')) {
        deps.setInputValue('');
      }
    } else if (e.key === 'Backspace' && !deps.inputValue && deps.emails.length > 0) {
      deps.setEmails(deps.emails.slice(0, -1));
    }
  };
};
