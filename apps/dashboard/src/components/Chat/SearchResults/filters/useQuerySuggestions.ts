/**
 * Typed-prefix suggestions for the full-screen search box — the Cmd+K palette's own. The prefix is
 * recognised the way the palette recognises it and the rows are the palette's, in its order
 * (search/useMentionCandidates), so `from:`, `with:`, `assignee:`, `@`, `#`, `in:`, `in:#`,
 * `in:@`, `mentions:`, `priority:`, `board:` and the date prefixes offer the same things on both
 * surfaces. A pick lands on the filter the palette's chip for it would.
 */
import { useMemo } from 'react';
import { useAllChannels } from '../../../../hooks/useChannels';
import { entriesFor, type FilterEntry } from '../../../../search/filterRegistry';
import { deskScopeChannelId, type TriggerText } from '../../../../search/mentionCandidates';
import { resolveDateKeyword } from '../../../../search/filterModel';
import {
  useMentionCandidates,
  type MentionCandidate,
} from '../../../../search/useMentionCandidates';
import type { SearchResultsFilters } from '../../../../hooks/useSearchResultsScreen';

/** A DM or channel the palette's quick switch opens. */
export interface QuickSwitchTarget {
  kind: 'user' | 'channel';
  id: string;
}

export interface QuerySuggestion {
  id: string;
  label: string;
  /** Muted text after the label (a person's email), as in the palette. */
  detail?: string;
  /** The palette's heading for the row's section ("Users", "Channels", "DMs"…). */
  section: string;
  /** Drawn by the renderer; the hook stays free of JSX. */
  icon:
    | { kind: 'user'; userId: string }
    | { kind: 'channel'; channelId: string }
    | { kind: 'userGroup' }
    | { kind: 'priority'; value: string }
    | { kind: 'board' }
    | { kind: 'date' }
    | { kind: 'value' };
  /**
   * The filter change this suggestion makes, given the filters it's applied to. Null when this
   * tab has no such filter: the row is then only offered for its quick switch (`opens`).
   */
  apply: ((filters: SearchResultsFilters) => Partial<SearchResultsFilters>) | null;
  /**
   * `@person` or `#channel` typed into an otherwise empty box: the palette jumps to the DM or
   * channel instead of filtering by it, and so does this box.
   */
  opens?: QuickSwitchTarget;
}

export interface ActiveTypeahead {
  /** The prefix being typed, e.g. `from:`. */
  syntax: TriggerText;
  /** What's been typed after it. */
  query: string;
  /** Where the prefix starts, so the caller can cut it out of the input on pick. */
  index: number;
  /**
   * The prefix is a filter on this tab, set by picking a row: Enter with nothing to pick keeps
   * the text, as in the palette (the query parser would drop `from:nas`, `board:` and the like
   * rather than resolve them). False on a tab without that filter: there is nothing to pick.
   */
  pickOnly: boolean;
  suggestions: QuerySuggestion[];
  /** The rows the prefix lists are still loading (Desk mailbox people). */
  loading: boolean;
  /** The rows the prefix lists couldn't be loaded (Desk mailbox people). */
  loadFailed: boolean;
}

/** Appends to a list-valued filter, ignoring a value that's already applied. */
const addTo = (
  entry: FilterEntry,
  filters: SearchResultsFilters,
  id: string,
): Partial<SearchResultsFilters> => {
  const current = entry.getValue?.(filters);
  const list = Array.isArray(current) ? current : [];
  return list.includes(id) ? {} : (entry.setValue?.([...list, id]) ?? {});
};

const appendId = (list: string[], id: string): string[] =>
  list.includes(id) ? list : [...list, id];

/** A Desk contact is an address (id = email), not a user with an avatar. */
const isAddress = (candidate: MentionCandidate): boolean =>
  candidate.kind === 'person' && !!candidate.email && candidate.id === candidate.email;

const iconOf = (candidate: MentionCandidate): QuerySuggestion['icon'] => {
  switch (candidate.kind) {
    case 'person':
      return isAddress(candidate) ? { kind: 'value' } : { kind: 'user', userId: candidate.id };
    case 'channel':
      return { kind: 'channel', channelId: candidate.id };
    case 'userGroup':
      return { kind: 'userGroup' };
    case 'priority':
      return { kind: 'priority', value: candidate.id };
    case 'board':
      return { kind: 'board' };
    case 'date':
      return { kind: 'date' };
  }
};

/** The palette's section headings, per row kind and prefix. */
const sectionOf = (candidate: MentionCandidate, syntax: TriggerText): string => {
  switch (candidate.kind) {
    case 'person':
      return syntax === '@' || syntax === 'mentions:' ? 'People' : 'Users';
    case 'userGroup':
      return 'User Groups';
    case 'channel':
      return candidate.isDm ? 'DMs' : 'Channels';
    case 'priority':
      return 'Priority';
    case 'board':
      return 'Board';
    case 'date':
      return 'Date';
  }
};

/** The filters (registry ids) a prefix's pick sets. */
const filterIdsOf = (syntax: TriggerText): readonly string[] => {
  switch (syntax) {
    case 'from:':
      return ['from', 'fromEmail'];
    case 'to:':
      return ['toEmail'];
    case 'with:':
      return ['with'];
    case 'assignee:':
      return ['assignee'];
    case 'in:':
    case 'in:#':
    case 'in:@':
      return ['in'];
    case '@':
    case '#':
    case 'mentions:':
      return ['mentions'];
    case 'priority:':
      return ['priority'];
    case 'board:':
      return ['board'];
    case 'on:':
    case 'after:':
    case 'before:':
      return ['date'];
  }
};

/** This tab has the filter the prefix sets, so the prefix is a filter here and not just words. */
export const prefixFilterApplies = (
  syntax: TriggerText,
  docType: SearchResultsFilters['docType'],
): boolean => {
  const ids = filterIdsOf(syntax);
  return entriesFor(docType).some(entry => ids.includes(entry.id));
};

/**
 * `textBeforeCaret` is what the box holds up to the caret; only a prefix there is in progress,
 * as in the palette.
 */
export function useQuerySuggestions(
  textBeforeCaret: string,
  filters: SearchResultsFilters,
): ActiveTypeahead | null {
  // The first `in:` channel, when it's a Desk one, scopes `from:`/`to:` to its mailbox — the
  // palette's rule (it reads its first `in:` chip).
  const knownChannels = useAllChannels();
  const firstInChannelId = filters.inChannelIds[0];
  const deskChannelId = useMemo(
    () => deskScopeChannelId(firstInChannelId, id => knownChannels.find(c => c.id === id)),
    [firstInChannelId, knownChannels],
  );
  const { trigger, candidates, loading, loadFailed } = useMentionCandidates(textBeforeCaret, {
    deskTab: filters.docType === 'desk',
    deskChannelId,
  });

  return useMemo(() => {
    if (!trigger) return null;
    // A filter this tab can't apply is not offered: picking it would change nothing.
    const available = entriesFor(filters.docType);
    const entry = (id: string): FilterEntry | undefined => available.find(e => e.id === id);

    const applyFor = (candidate: MentionCandidate): QuerySuggestion['apply'] | null => {
      const { id } = candidate;
      switch (trigger.text) {
        case 'from:': {
          const target = entry(isAddress(candidate) ? 'fromEmail' : 'from');
          return target ? (f): Partial<SearchResultsFilters> => addTo(target, f, id) : null;
        }
        case 'to:': {
          const target = entry('toEmail');
          return target ? (f): Partial<SearchResultsFilters> => addTo(target, f, id) : null;
        }
        case 'with:':
        case 'assignee:': {
          const target = entry(trigger.text === 'with:' ? 'with' : 'assignee');
          return target ? (f): Partial<SearchResultsFilters> => addTo(target, f, id) : null;
        }
        case 'in:':
        case 'in:#':
        case 'in:@': {
          const target = entry('in');
          return target ? (f): Partial<SearchResultsFilters> => addTo(target, f, id) : null;
        }
        // A bare `@`/`#` pick, and every `mentions:` one, is a mention filter: the palette's
        // prefix-less and `mentions:` chips both land there.
        case '@':
        case '#':
        case 'mentions:': {
          if (!entry('mentions')) return null;
          if (candidate.kind === 'userGroup') {
            return f => ({ mentionUserGroupIds: appendId(f.mentionUserGroupIds, id) });
          }
          if (candidate.kind === 'channel') {
            return f => ({ mentionChannelIds: appendId(f.mentionChannelIds, id) });
          }
          return f => ({ mentionUserIds: appendId(f.mentionUserIds, id) });
        }
        case 'priority:': {
          const target = entry('priority');
          return target ? (): Partial<SearchResultsFilters> => target.setValue?.(id) ?? {} : null;
        }
        case 'board:': {
          const target = entry('board');
          return target ? (f): Partial<SearchResultsFilters> => addTo(target, f, id) : null;
        }
        // `on:` keeps the keyword, so the window stays live. A bound prefix means something
        // else — `before:yesterday` is "older than yesterday" — so a preset resolves to a date
        // and lands on that bound, as the palette's date chips do.
        case 'on:':
        case 'after:':
        case 'before:': {
          if (!entry('date')) return null;
          const typedDay = /^\d{4}-\d{2}-\d{2}$/.test(id);
          const day = typedDay ? id : (resolveDateKeyword(id)?.after ?? null);
          if (trigger.text === 'on:') {
            return () =>
              typedDay
                ? { dateRange: '', after: id, before: id }
                : { dateRange: id, after: '', before: '' };
          }
          if (!day) return null;
          return () =>
            trigger.text === 'after:'
              ? { dateRange: '', after: day }
              : { dateRange: '', before: day };
        }
        default:
          return null;
      }
    };

    // Every row, as the palette lists them: the box draws only the ones in view.
    const suggestions: QuerySuggestion[] = [];
    for (const candidate of candidates) {
      const apply = applyFor(candidate);
      const opens: QuickSwitchTarget | undefined =
        trigger.text === '@' && candidate.kind === 'person'
          ? { kind: 'user', id: candidate.id }
          : trigger.text === '#' && candidate.kind === 'channel'
            ? { kind: 'channel', id: candidate.id }
            : undefined;
      if (!apply && !opens) continue;
      const detail = candidate.kind === 'person' && !isAddress(candidate) ? candidate.email : '';
      suggestions.push({
        id: `${candidate.kind}-${candidate.id}`,
        label: candidate.name,
        ...(detail ? { detail } : {}),
        section: sectionOf(candidate, trigger.text),
        icon: iconOf(candidate),
        apply,
        ...(opens ? { opens } : {}),
      });
    }

    return {
      syntax: trigger.text,
      query: trigger.query,
      index: trigger.index,
      // Only where this tab has the filter: elsewhere (`#4521` on Tickets) there is nothing to pick.
      pickOnly: prefixFilterApplies(trigger.text, filters.docType),
      loading,
      loadFailed,
      suggestions,
    };
  }, [trigger, candidates, loading, loadFailed, filters.docType]);
}
