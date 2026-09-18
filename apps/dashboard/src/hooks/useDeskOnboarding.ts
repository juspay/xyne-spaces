import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOnboardingState, searchOnboardingTickets } from '../services/clients/onboardingApi';
import { useDebouncedValue } from './useDebouncedValue';

export const GRADING_POLL_MS = 10_000;

export const onboardingStateQueryKey = (channelId: string) =>
  ['desk-onboarding', channelId] as const;

/**
 * The Onboarding tab's state for one desk. Nothing syncs live, so while any visible attempt is
 * being graded the query re-fetches every 10 seconds until grading finishes.
 */
export function useDeskOnboardingState(channelId: string) {
  return useQuery({
    queryKey: onboardingStateQueryKey(channelId),
    queryFn: () => fetchOnboardingState(channelId),
    enabled: !!channelId,
    refetchInterval: query =>
      query.state.data?.attempts.some(a => a.status === 'GRADING') ? GRADING_POLL_MS : false,
  });
}

export function useInvalidateDeskOnboarding(channelId: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: onboardingStateQueryKey(channelId) }),
    [queryClient, channelId],
  );
}

const TICKET_SEARCH_DEBOUNCE_MS = 300;

/** Searches this desk's tickets by Xyne ID or title, for the paper ticket picker (admins). */
export function useOnboardingTicketSearch(channelId: string, search: string) {
  const debounced = useDebouncedValue(search.trim(), TICKET_SEARCH_DEBOUNCE_MS);
  return useQuery({
    queryKey: ['desk-onboarding-ticket-search', channelId, debounced],
    queryFn: () => searchOnboardingTickets(channelId, debounced),
    enabled: !!channelId && debounced.length > 0,
  });
}

// Replies reach the server only on Save draft and Submit. Until then each keystroke is kept in
// localStorage, so switching tabs, closing Desk Settings or reloading loses nothing.

interface LocalReply {
  text: string;
  /**
   * The server's `draftSavedAt` this copy was typed on top of. A copy wins only while that is still
   * the server's latest draft — server and browser clocks are never compared.
   */
  baseDraftSavedAt: string | null;
}

const localKey = (attemptId: string): string => `desk-onboarding-replies:${attemptId}`;

function readLocalReplies(attemptId: string): Record<string, LocalReply> {
  try {
    const raw = window.localStorage.getItem(localKey(attemptId));
    return raw ? (JSON.parse(raw) as Record<string, LocalReply>) : {};
  } catch {
    return {};
  }
}

/** False when this browser refuses to store (private mode, quota): the caller must say so once. */
function writeLocalReplies(attemptId: string, replies: Record<string, LocalReply>): boolean {
  try {
    window.localStorage.setItem(localKey(attemptId), JSON.stringify(replies));
    return true;
  } catch {
    // Storage full or blocked: the reply stays in memory until Save draft.
    return false;
  }
}

export function clearLocalReplies(attemptId: string): void {
  try {
    window.localStorage.removeItem(localKey(attemptId));
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** Drop local reply copies for attempts that are no longer open (e.g. submitted on another device). */
export function clearFinishedLocalReplies(attempts: { id: string; status: string }[]): void {
  for (const attempt of attempts) {
    if (attempt.status !== 'IN_PROGRESS') clearLocalReplies(attempt.id);
  }
}

/**
 * Replies for one attempt: the server's saved draft, overridden per ticket by a local copy typed
 * on top of that same draft. A copy typed on an older draft (someone saved since, e.g. on another
 * device) loses to the server. `hasUnsaved` is true while any reply differs from the server.
 * Mount once per attempt (key the component by attempt id); the answer list is fixed at Start.
 */
export function useAttemptReplies(
  attemptId: string,
  serverReplies: { paperTicketId: string; replyText: string }[],
  draftSavedAt: string | null,
) {
  const [replies, setReplies] = useState<Record<string, string>>(() => {
    const local = readLocalReplies(attemptId);
    return Object.fromEntries(
      serverReplies.map(r => {
        const copy = local[r.paperTicketId];
        return [
          r.paperTicketId,
          copy && copy.baseDraftSavedAt === draftSavedAt ? copy.text : r.replyText,
        ];
      }),
    );
  });
  // The draft this browser last knew the server held; new copies are typed on top of it.
  const baseRef = useRef(draftSavedAt);

  // True once a keystroke could not be stored, so the UI stops promising replies are kept here.
  const [localStorageBlocked, setLocalStorageBlocked] = useState(false);

  const setReply = useCallback(
    (paperTicketId: string, text: string) => {
      setReplies(prev => ({ ...prev, [paperTicketId]: text }));
      const local = readLocalReplies(attemptId);
      local[paperTicketId] = { text, baseDraftSavedAt: baseRef.current };
      if (!writeLocalReplies(attemptId, local)) setLocalStorageBlocked(true);
    },
    [attemptId],
  );

  /**
   * After Save draft succeeds, drop local copies the server now holds and re-base the rest (typed
   * while the save was in flight) on the new draft, so they still win after a reload.
   */
  const markSaved = useCallback(
    (saved: { paperTicketId: string; replyText: string }[], newDraftSavedAt: string | null) => {
      baseRef.current = newDraftSavedAt;
      const local = readLocalReplies(attemptId);
      for (const reply of saved) {
        if (local[reply.paperTicketId]?.text === reply.replyText) delete local[reply.paperTicketId];
      }
      for (const copy of Object.values(local)) copy.baseDraftSavedAt = newDraftSavedAt;
      writeLocalReplies(attemptId, local);
    },
    [attemptId],
  );

  const hasUnsaved = serverReplies.some(r => (replies[r.paperTicketId] ?? '') !== r.replyText);

  return { replies, setReply, markSaved, hasUnsaved, localStorageBlocked };
}
