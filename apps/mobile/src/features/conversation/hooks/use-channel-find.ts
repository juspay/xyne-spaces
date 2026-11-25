import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler, Keyboard } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';

import { useSearchNavigation } from '@/src/features/global-search/hooks/use-search-navigation';
import {
  useSearchResults,
  type SearchResults,
} from '@/src/features/global-search/hooks/use-search-results';
import type { DisplaySearchResult } from '@/src/types/search';

import { channelFindRequest } from '../model/channel-find';

/** What the header holds: whether find is open, and the field's way in and out. */
type ChannelFindControls = {
  isOpen: boolean;
  open: () => void;
  /** Cancel: back to the header, the keyboard down and the query gone. */
  close: () => void;
  onQueryCommit: (query: string) => void;
};

/** What the results show, and how one opens. */
export type ChannelFindMatches = {
  /** The committed (debounced) text; the field keeps what is being typed. */
  query: string;
  results: SearchResults;
  /** Lands on the message in this room, or opens its thread. */
  openResult: (result: DisplaySearchResult) => void;
};

/**
 * "Find in this channel". The request, fetching and paging are the global
 * search's, locked to this channel, and a result opens through the same
 * navigation the search screen uses: for a message here that re-anchors this
 * room's list on it in place, as tapping a notification for it would.
 */
export function useChannelFind(
  channelId: string,
  channelLabel: string,
): { controls: ChannelFindControls; matches: ChannelFindMatches } {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const scope = useMemo(() => ({ channelId, label: channelLabel }), [channelId, channelLabel]);
  const request = useMemo(
    () => (isOpen ? channelFindRequest(query, scope) : null),
    [isOpen, query, scope],
  );
  const results = useSearchResults(request);

  const open = useCallback((): void => setIsOpen(true), []);
  const close = useCallback((): void => {
    Keyboard.dismiss();
    setIsOpen(false);
    setQuery('');
  }, []);

  // Closed before the jump, so the room it lands on is not hidden under results.
  const leave = useCallback((): void => {
    setIsOpen(false);
    setQuery('');
  }, []);
  const { openResult } = useSearchNavigation(leave);

  // Android back closes find before it leaves the room. Only while the room is
  // in front: a thread card over it takes back for itself, and the listener is
  // added again (so it is the newest) when the room comes back to the front.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isOpen || !isFocused) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return (): void => subscription.remove();
  }, [close, isFocused, isOpen]);

  // A channel switch keeps the screen mounted; find belongs to the room it was opened in.
  useEffect(() => leave, [channelId, leave]);

  const controls = useMemo(
    (): ChannelFindControls => ({ isOpen, open, close, onQueryCommit: setQuery }),
    [close, isOpen, open],
  );
  const matches = useMemo(
    (): ChannelFindMatches => ({ query, results, openResult }),
    [openResult, query, results],
  );
  return { controls, matches };
}

/**
 * Split so the header re-renders only as find opens and closes, and only the
 * results follow each query, page and status; the room and its list read neither.
 */
export const ChannelFindControlsContext = createContext<ChannelFindControls | null>(null);
export const ChannelFindMatchesContext = createContext<ChannelFindMatches | null>(null);

export function useChannelFindControls(): ChannelFindControls {
  const controls = useContext(ChannelFindControlsContext);
  if (!controls) {
    throw new Error('useChannelFindControls must be used within <ChannelFindProvider>');
  }
  return controls;
}

export function useChannelFindMatches(): ChannelFindMatches {
  const matches = useContext(ChannelFindMatchesContext);
  if (!matches) {
    throw new Error('useChannelFindMatches must be used within <ChannelFindProvider>');
  }
  return matches;
}
