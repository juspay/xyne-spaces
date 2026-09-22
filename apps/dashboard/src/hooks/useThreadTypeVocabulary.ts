import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ThreadTypeEntry } from '@xyne/shared';
import { threadTypeVocabularyApi, type VocabularyEntry } from '../api/threadTypeVocabularyApi';
import { useShowThreadTags } from './useShowThreadTags';

export const THREAD_TYPE_VOCABULARY_KEY = ['thread-type-vocabulary'];

/**
 * The workspace's thread-type vocabulary — the list the picker offers, and the labels,
 * colours and order every chip renders with.
 *
 * One request per session, shared by every picker and chip: it changes only when an admin
 * edits it, so a long staleTime is right and refetching per thread would be waste.
 *
 * There is NO fallback to the list in code, and there must not be. A workspace's vocabulary
 * is its rows and nothing else, so an empty answer is a real answer: it means an admin has
 * not installed any types yet. Filling the picker from code would offer types the workspace
 * does not have — and picking one would send a name the server has never heard of, which
 * lands as a free-form PROPOSAL for a type nobody chose to install.
 *
 * While the request is in flight the picker is briefly empty and chips render from their
 * stored name without label or colour. That is the honest reading of "we do not know yet".
 */
export const useThreadTypeVocabulary = (): {
  entries: ThreadTypeEntry[];
  entry: (name: string) => ThreadTypeEntry | undefined;
  /** Vocabulary order first, then anything unknown alphabetically. */
  sort: (names: string[]) => string[];
} => {
  const { showThreadTags } = useShowThreadTags();

  const { data } = useQuery({
    queryKey: THREAD_TYPE_VOCABULARY_KEY,
    enabled: showThreadTags,
    // Approved entries only, and deliberately so: candidates are unbounded — anyone can
    // invent a free-form tag — and pulling all of them into every client to resolve the two
    // or three on screen does not scale. A free-form chip renders from its stored name.
    queryFn: () => threadTypeVocabularyApi.get(),
    staleTime: 15 * 60 * 1000,
  });

  const entries = useMemo<VocabularyEntry[]>(() => data ?? [], [data]);

  const rank = useMemo(() => {
    const order = new Map(entries.map((entry, index) => [entry.name, index]));
    // Free-form tags and entries an admin has removed have no rank, so they trail the
    // vocabulary in alphabetical order rather than jumping around between renders.
    return (name: string): number => order.get(name) ?? entries.length;
  }, [entries]);

  // Undefined for a free-form tag: it has no approved entry, so the chip falls back to its
  // stored name and the tooltip simply omits the definition line.
  const entry = useCallback(
    (name: string) => entries.find(candidate => candidate.name === name),
    [entries],
  );

  const sort = useCallback(
    (names: string[]): string[] =>
      [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    [rank],
  );

  return { entries, entry, sort };
};
