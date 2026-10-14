/**
 * Everything the in-call UI knows about the call that LiveKit doesn't: who it is with (title,
 * hero avatar) and who is currently being rung (ringing tiles).
 * Sourced from Zero's `userActiveCalls` roster, so it works before the room has any tracks.
 * Ringing follows the dashboard exactly: tiles exist only in 1:1 DM calls (see `callRoster.utils`).
 */
import { useMemo, useRef } from 'react';
import { ChannelScopeType } from '@xyne/shared';

import { useAuth } from '@/src/contexts/AuthContext';
import { getChannelDisplayName, useAllChannels } from '@/src/hooks/useChannels';
import { useQuery } from '@/src/hooks/useQuery';
import { useUsers } from '@/src/hooks/useUsers';
import { getOtherParticipantIds } from '@/src/utils/channel-utils';
import { queries } from '@/src/zero/queries';
import {
  getRingingInvitees,
  resolveCallTitle,
  type RingingInvitee,
  type RosterParticipantLike,
} from '../callRoster.utils';
import { isAiAgentIdentity } from '../callIdentity';

export interface CallPresence {
  title: string;
  /** The single other person on a 1:1 call (used for the hero avatar while connecting). */
  heroUserId: string | null;
  otherUserIds: string[];
  /** People being rung right now (INVITED, not joined). Only ever non-empty in a 1:1 DM call. */
  ringing: RingingInvitee[];
  /** Anyone besides you (and the AI agent) is on the call's roster. */
  hasOtherInvitees: boolean;
  /** Backend row for the call; undefined until Zero has synced it. */
  isKnownToZero: boolean;
  /** The DM / channel the call belongs to, when you can open it; null for link and instant calls. */
  chatChannelId: string | null;
}

const EMPTY_RINGING: RingingInvitee[] = [];
const EMPTY_IDS: string[] = [];
const ACTIVE_RESPONSES = new Set(['INVITED', 'ACCEPTED']);
const FALLBACK_TITLE = 'Call';

interface UseCallPresenceParams {
  /** LiveKit / backend external call id, when known. */
  externalId: string | null | undefined;
  /** Channel the call belongs to (from the room machine or route). */
  channelId: string | null | undefined;
  /** People targeted by an outgoing call that has no backend row yet. */
  targetUserIds: readonly string[] | undefined;
  /** Identities currently in the LiveKit room. */
  presentIdentities: ReadonlySet<string>;
}

export function useCallPresence({
  externalId,
  channelId,
  targetUserIds,
  presentIdentities,
}: UseCallPresenceParams): CallPresence {
  const { user } = useAuth();
  const me = user?.user_id ?? null;
  const users = useUsers();
  const channels = useAllChannels();
  const [activeCalls] = useQuery(queries.userActiveCalls());

  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const call = useMemo(
    () => (externalId ? activeCalls?.find(c => c.externalId === externalId) : undefined),
    [activeCalls, externalId],
  );

  const presence = useMemo<CallPresence>(() => {
    const roster = ((call?.participants as unknown as RosterParticipantLike[] | undefined) ??
      []) as RosterParticipantLike[];

    const resolveName = (userId: string, fallback: string | null | undefined): string => {
      const u = usersById.get(userId);
      return u?.name || fallback || u?.email || 'Guest';
    };

    // Everyone else on the call, active invitees first.
    const others = roster.filter(p => p.userId && p.userId !== me && !isAiAgentIdentity(p.userId));
    const activeOthers = others.filter(p => p.response && ACTIVE_RESPONSES.has(p.response));
    let otherUserIds = (activeOthers.length > 0 ? activeOthers : others).map(p => p.userId);
    if (otherUserIds.length === 0 && targetUserIds) {
      otherUserIds = targetUserIds.filter(id => id !== me);
    }

    const effectiveChannelId = call?.channelId ?? channelId ?? null;
    const channel = effectiveChannelId
      ? channels.find(c => c.id === effectiveChannelId)
      : undefined;

    let channelTitle: string | null = null;
    let dmPartnerId: string | null = null;
    if (channel && me) {
      if (channel.scopeType === ChannelScopeType.DEFAULT) {
        channelTitle = `# ${channel.name}`;
      } else {
        channelTitle = getChannelDisplayName(channel, me, users);
        if (channel.scopeType === ChannelScopeType.DM) {
          dmPartnerId = getOtherParticipantIds(channel, me)[0] ?? null;
        }
      }
    }

    if (otherUserIds.length === 0 && dmPartnerId) otherUserIds = [dmPartnerId];

    const otherNames = otherUserIds.map(id => resolveName(id, null));
    const title = resolveCallTitle({
      callTitle: (call as { title?: string | null } | undefined)?.title,
      channelTitle,
      otherNames,
      fallback: FALLBACK_TITLE,
    });

    const isChannelCall = channel?.scopeType === ChannelScopeType.DEFAULT;
    const heroUserId =
      dmPartnerId ?? (!isChannelCall && otherUserIds.length === 1 ? otherUserIds[0]! : null);

    // Ring tiles are DM-only; elsewhere ring status lives in the people list (dashboard rule).
    // Once the call is known to Zero, defer entirely to the authoritative roster — even if the row
    // has already moved past INVITED (declined, missed, answered) — never keep a stale tile up.
    const isDmCall = channel?.scopeType === ChannelScopeType.DM;
    let ringing: RingingInvitee[] = EMPTY_RINGING;
    if (call) {
      if (isDmCall) {
        ringing = getRingingInvitees({
          participants: roster,
          connectedIdentities: presentIdentities,
          currentUserId: me,
          resolveName,
        });
      }
    } else if (heroUserId && !presentIdentities.has(heroUserId) && !isAiAgentIdentity(heroUserId)) {
      // Zero hasn't synced the call row yet, but who we're calling is already known synchronously
      // (heroUserId covers both the DM-partner and single-target-outgoing-call cases) — show them
      // ringing immediately instead of a flash of your own tile alone while the row catches up.
      // `getRingingInvitees` takes over, unchanged, the moment the real row arrives.
      ringing = [
        { userId: heroUserId, name: resolveName(heroUserId, null), ringStatus: 'calling' },
      ];
    }

    return {
      title,
      heroUserId,
      otherUserIds: otherUserIds.length > 0 ? otherUserIds : EMPTY_IDS,
      ringing: ringing.length > 0 ? ringing : EMPTY_RINGING,
      hasOtherInvitees: others.length > 0,
      isKnownToZero: !!call,
      chatChannelId: channel?.id ?? null,
    };
  }, [call, channels, channelId, me, presentIdentities, targetUserIds, users, usersById]);

  // The roster leaves Zero once the call ends; keep showing who it was with instead of "Call".
  const lastRealTitle = useRef<string | null>(null);
  if (presence.title !== FALLBACK_TITLE) lastRealTitle.current = presence.title;
  const title = lastRealTitle.current ?? presence.title;
  return useMemo(
    () => (title === presence.title ? presence : { ...presence, title }),
    [presence, title],
  );
}
