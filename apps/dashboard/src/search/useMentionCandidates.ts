import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { isDeskChannelType } from '@xyne/shared';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { ChipType } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import {
  groupChannelsByScope,
  isDMChannel,
} from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { useAffinityCallback } from '../hooks/useAffinityCallback';
import { useAuthContextValues } from '../hooks/useAuth';
import { useCachedQuery } from '../hooks/useCachedQuery';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../hooks/useChannels';
import { useDeskContacts } from '../hooks/useDeskContacts';
import { ALL_DESK, useDeskPeople } from '../hooks/useDeskPeople';
import { CMDK_USER_LIMIT } from '../hooks/useSearchMetrics';
import { useUsers, useUsersById, useUserSearch } from '../hooks/useUsers';
import { stateMachineActor, type VisibleChannel } from '../machines/stateMachine';
import { rankChannelsByAffinity } from '../utils/rankingUtils';
import { getUserDisplayName } from '../utils/userDisplayName';
import { queries } from '../zero/queries';
import {
  boardCandidates,
  buildDmContactRecency,
  buildSearchableChannels,
  dateCandidates,
  deskPeopleCandidates,
  detectMentionTrigger,
  dmCandidates,
  MENTION_GROUP_MAX,
  priorityCandidates,
  rankedPeopleCandidates,
  regularChannelCandidates,
  type MentionTrigger,
} from './mentionCandidates';

interface SearchChannelPool {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
}

type Channel = ReturnType<typeof useAllChannels>[number];

// Every search box shares one pool: grouping and ranking ~750 channels is the expensive part,
// so it runs once per change of the store slices it reads, not once per mounted box.
let poolCache: { keys: readonly unknown[]; pool: SearchChannelPool } | null = null;

function rankSearchChannelPool(
  channelData: Channel[],
  visibleAllChannels: VisibleChannel[],
  allChannelsUserStatus: ReturnType<typeof useUserChannelStatuses>,
): SearchChannelPool {
  if (!channelData.length) return { starred: [], channels: [], directMessages: [] };

  // Index visible channels by id once (O(n)); the previous `.find` inside this
  // `.map` was O(n * m) over ~749 all x ~431 visible channels per recompute.
  const visibleById = new Map(visibleAllChannels.map(vc => [vc.id, vc]));
  const visibleChannels = channelData.map(channel => {
    const vc = visibleById.get(channel.id);
    if (vc) {
      return vc;
    }
    return {
      ...channel,
    };
  }) as VisibleChannel[];
  const grouped = groupChannelsByScope(visibleChannels, allChannelsUserStatus);

  // groupChannelsByScope excludes EMAIL channels (they live in Desk, not chat sidebar).
  // Re-include them so the search `in:` picker can scope to desk channels.
  const emailChannels = visibleChannels.filter(c => isDeskChannelType(c.type));

  // Rank each group by personalization weight (desc), tie-break on recency (shared with the
  // `/chat`/`/call` pickers). No weights → 0 ties → pure recency, identical to the previous order.
  return {
    starred: rankChannelsByAffinity(grouped.starred),
    channels: rankChannelsByAffinity([...grouped.channels, ...emailChannels]),
    directMessages: rankChannelsByAffinity(grouped.directMessages),
  };
}

/**
 * The channels search matches against, grouped and ranked as the Cmd+K palette lists them:
 * every channel the client holds (a visible one keeps its sidebar data), starred / channels /
 * DMs by scope, Desk email channels with the channels, each group by affinity then recency.
 * `channelData` is every channel the client holds, ungrouped.
 */
export function useSearchChannelPool(): SearchChannelPool & { channelData: Channel[] } {
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  // Re-ranks when affinity weights finish loading (they're read imperatively while ranking).
  const affinityVersion = useAffinityCallback();
  // `useAllChannels` builds its array per caller, so the shared cache keys on the store slices.
  const rawAllChannels = useSelector(stateMachineActor, state => state.context.allChannels);
  const pool = useMemo(() => {
    const keys = [rawAllChannels, visibleAllChannels, allChannelsUserStatus, affinityVersion];
    if (poolCache && poolCache.keys.every((key, i) => key === keys[i])) return poolCache.pool;
    const next = rankSearchChannelPool(channelData, visibleAllChannels, allChannelsUserStatus);
    poolCache = { keys, pool: next };
    return next;
  }, [rawAllChannels, channelData, visibleAllChannels, allChannelsUserStatus, affinityVersion]);
  return useMemo(() => ({ ...pool, channelData }), [pool, channelData]);
}

/**
 * The first `max` rows of each section (people, user-groups, channels, DMs…), in order: a list
 * drawn whole is capped per section, so a long channel list can't push the DMs after it out.
 */
export function capEachSection(candidates: MentionCandidate[], max: number): MentionCandidate[] {
  const counts = new Map<string, number>();
  return candidates.filter(candidate => {
    const section = candidate.kind === 'channel' && candidate.isDm ? 'dm' : candidate.kind;
    const seen = counts.get(section) ?? 0;
    counts.set(section, seen + 1);
    return seen < max;
  });
}

// How long after a failed Desk people request a retyped `from:`/`to:` waits before asking again.
const DESK_RETRY_COOLDOWN_MS = 30_000;

/** One row of a filter typeahead. `id` is what the filter stores (a Desk contact's address). */
export type MentionCandidate =
  | { kind: 'person'; id: string; name: string; email?: string }
  | { kind: 'userGroup'; id: string; name: string }
  | { kind: 'channel'; id: string; name: string; isDm: boolean }
  | { kind: 'priority' | 'board' | 'date'; id: string; name: string };

export interface MentionCandidatesContext {
  /** The Desk tab is on: `in:` lists email channels only, `from:`/`to:` mailbox contacts. */
  deskTab: boolean;
  /** An applied `in:` Desk channel: `from:`/`to:` list its mailbox contacts. */
  deskChannelId?: string | undefined;
}

/**
 * The filter typeahead for `text` (what is typed before the caret): the prefix being typed, and
 * the rows Cmd+K offers for it, in its order — so a box outside the palette offers exactly what
 * the palette does. Sections the palette pages (`@`, `mentions:`) come back flat, each to its
 * expanded size.
 */
export function useMentionCandidates(
  text: string,
  { deskTab, deskChannelId }: MentionCandidatesContext,
): {
  trigger: MentionTrigger | null;
  candidates: MentionCandidate[];
  loading: boolean;
  loadFailed: boolean;
} {
  const isDeskContext = !!deskChannelId || deskTab;
  const trigger = useMemo(
    () => detectMentionTrigger(text, { enableToTrigger: isDeskContext }),
    [text, isDeskContext],
  );
  const type = trigger?.type ?? null;
  const query = trigger?.query ?? '';
  // What the prefix lists. Hooks can't be conditional, so every source is subscribed, but each
  // one is only searched (or fetched) while a prefix that lists it is being typed.
  const listsPeople = type === ChipType.USER || type === ChipType.MENTIONS;
  const listsChannels = type === ChipType.CHANNEL || type === ChipType.MENTIONS;
  const listsGroups = trigger?.text === '@' || type === ChipType.MENTIONS;
  const listsDeskPeople = trigger?.text === 'from:' || trigger?.text === 'to:';

  const { userID } = useAuthContextValues();
  const currentUserId = userID ?? '';
  const allUsers = useUsers();
  const usersById = useUsersById();
  const pool = useSearchChannelPool();
  const allChannels = useMemo(
    () => (listsChannels ? buildSearchableChannels(pool, currentUserId, usersById) : []),
    [listsChannels, pool, currentUserId, usersById],
  );
  const dmContactRecency = useMemo(
    () =>
      listsPeople
        ? buildDmContactRecency(pool.directMessages, currentUserId)
        : new Map<string, number>(),
    [listsPeople, pool.directMessages, currentUserId],
  );
  const mentionUsers = useUserSearch(listsPeople ? query : '', CMDK_USER_LIMIT);
  const userGroups = useUserGroupSearch(listsGroups ? query : '', MENTION_GROUP_MAX);
  // Desk mailbox people load the first time a Desk `from:`/`to:` is typed in this Desk scope, then
  // stay loaded while the scope stays: a retyped prefix reuses them instead of starting the request
  // again. A new scope waits for its own `from:`/`to:`; leaving Desk forgets it. A failed request
  // is retried by the next `from:`/`to:`, but not within DESK_RETRY_COOLDOWN_MS of the failure.
  const deskScope = deskChannelId ?? (deskTab ? ALL_DESK : undefined);
  const [deskWantedFor, setDeskWantedFor] = useState<string | undefined>(undefined);
  if (listsDeskPeople && deskScope && deskWantedFor !== deskScope) setDeskWantedFor(deskScope);
  if (!deskScope && deskWantedFor !== undefined) setDeskWantedFor(undefined);
  const deskWanted = !!deskScope && deskWantedFor === deskScope;
  const deskContacts = useDeskContacts(deskWanted ? deskChannelId : undefined);
  const deskPeople = useDeskPeople(deskWanted ? deskScope : undefined);
  const deskFailed = deskWanted && deskPeople.status === 'failed';
  const [deskRetryReady, setDeskRetryReady] = useState(false);
  useEffect(() => {
    setDeskRetryReady(false);
    if (!deskFailed) return undefined;
    const timer = setTimeout(() => setDeskRetryReady(true), DESK_RETRY_COOLDOWN_MS);
    return (): void => clearTimeout(timer);
  }, [deskFailed]);
  if (!listsDeskPeople && deskFailed && deskRetryReady) setDeskWantedFor(undefined);
  // The mailbox people the prefix lists are still on their way, or couldn't be loaded: the box
  // says so rather than 'No matches'.
  const loading = listsDeskPeople && deskWanted && deskPeople.status === 'idle';
  const loadFailed = listsDeskPeople && deskFailed;
  const [allBoards] = useCachedQuery(queries.getAllBoardsList(), {
    enabled: type === ChipType.BOARD,
  });

  const candidates = useMemo((): MentionCandidate[] => {
    if (!trigger) return [];
    const toChannel = ({
      channel,
      displayName,
    }: {
      channel: { id: string; scopeType: VisibleChannel['scopeType'] };
      displayName: string;
    }): MentionCandidate => ({
      kind: 'channel',
      id: channel.id,
      name: displayName,
      isDm: isDMChannel(channel.scopeType),
    });
    const regular = (): MentionCandidate[] =>
      regularChannelCandidates(allChannels, query, { deskTab }).map(toChannel);
    const dms = (): MentionCandidate[] =>
      deskTab ? [] : dmCandidates(allChannels, query, currentUserId, usersById).map(toChannel);
    const people = (): MentionCandidate[] => {
      if (isDeskContext && (trigger.text === 'from:' || trigger.text === 'to:')) {
        return deskPeopleCandidates(
          query,
          trigger.text,
          deskPeople,
          deskContacts,
          CMDK_USER_LIMIT,
        ).map(p => ({
          kind: 'person',
          id: p.id,
          name: p.name,
          ...(p.email && { email: p.email }),
        }));
      }
      // `to:` is Desk-only.
      if (trigger.text === 'to:') return [];
      // As in the palette: the people prefixes show the display name, `mentions:` the name.
      const byDisplayName = trigger.type === ChipType.USER;
      return rankedPeopleCandidates(mentionUsers ?? [], allUsers, query, dmContactRecency).map(
        p => ({
          kind: 'person',
          id: p.id,
          name: byDisplayName ? getUserDisplayName(p) : p.name,
          ...(p.email && { email: p.email }),
        }),
      );
    };
    // A group's row reads its `@`-handle (alias), as the token it lands does.
    const groups = (): MentionCandidate[] =>
      (userGroups ?? []).slice(0, MENTION_GROUP_MAX).map(group => ({
        kind: 'userGroup',
        id: group.id,
        name: group.alias ?? group.name,
      }));

    switch (trigger.type) {
      case ChipType.USER:
        // `@` lists people, then user-groups; the other people prefixes list people only.
        return trigger.text === '@'
          ? [...people().slice(0, MENTION_GROUP_MAX), ...groups()]
          : people();
      case ChipType.CHANNEL:
        if (trigger.text === 'in:#') return regular();
        if (trigger.text === 'in:@') return dms();
        // `in:` and `#`: channels, then DMs.
        return [...regular(), ...dms()];
      case ChipType.MENTIONS:
        // People, user-groups, then channels (no DMs: a DM is never `#`-referenced).
        return [
          ...people().slice(0, MENTION_GROUP_MAX),
          ...groups(),
          ...regular().slice(0, MENTION_GROUP_MAX),
        ];
      case ChipType.PRIORITY:
        return priorityCandidates(query).map(p => ({ kind: 'priority', ...p }));
      case ChipType.BOARD:
        return boardCandidates(
          (allBoards ?? []) as ReadonlyArray<{ id: string; name: string }>,
          query,
        ).map(b => ({ kind: 'board', ...b }));
      case ChipType.DATE:
        return dateCandidates(query).map(d => ({ kind: 'date', ...d }));
      default:
        return [];
    }
  }, [
    trigger,
    query,
    allChannels,
    deskTab,
    isDeskContext,
    currentUserId,
    usersById,
    deskPeople,
    deskContacts,
    mentionUsers,
    allUsers,
    dmContactRecency,
    userGroups,
    allBoards,
  ]);

  return { trigger, candidates, loading, loadFailed };
}
