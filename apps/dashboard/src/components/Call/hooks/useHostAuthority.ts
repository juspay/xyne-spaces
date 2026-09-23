import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';

export interface HostAuthority {
  /** True iff local participant currently holds host powers now (real host or acting host). UI hint only. */
  isHost: boolean;
  /** True iff isHost is true because I'm standing in, not because I'm the real host. */
  isActingHost: boolean;
  /** True iff the real host is currently present in the room. */
  hostPresent: boolean;
  /** Name of whoever currently holds host powers, for "only X can…" copy. */
  activeHostName: string | null;
}

/**
 * Resolves who holds host powers for every in-call host-only action: room-metadata
 * `createdBy` if present, else `actingHostId` (backend-computed stand-in). Single
 * source of truth — every host-only gate should read from here.
 */
export function useHostAuthority(): HostAuthority {
  const room = useSelector(roomActor, state => state.context.room);
  const participants = useSelector(roomActor, state => state.context.participants);
  const actingHostId = useSelector(roomActor, state => state.context.actingHostId);

  const hostIdentity = useMemo(() => {
    if (!room?.metadata) return null;
    try {
      return (JSON.parse(room.metadata) as { createdBy?: string }).createdBy ?? null;
    } catch {
      return null;
    }
  }, [room?.metadata]);

  const localIdentity = room?.localParticipant.identity ?? null;
  const hostPresent = !!hostIdentity && participants.some(p => p.identity === hostIdentity);
  const isRealHost = !!hostIdentity && hostIdentity === localIdentity;
  const isActingHost = !hostPresent && !!actingHostId && actingHostId === localIdentity;
  const isHost = isRealHost || isActingHost;

  const activeIdentity = hostPresent ? hostIdentity : actingHostId;
  const activeHostName = useMemo(() => {
    if (!activeIdentity) return null;
    return participants.find(p => p.identity === activeIdentity)?.name ?? null;
  }, [activeIdentity, participants]);

  return { isHost, isActingHost, hostPresent, activeHostName };
}
