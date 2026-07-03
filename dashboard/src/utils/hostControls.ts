import { DEFAULT_HOST_CONTROLS, type HostControls } from '@xyne/shared';

export type HostControlLockKey = keyof HostControls;

interface HostControlParticipantLike {
  identity: string;
  isLocal: boolean;
}

interface HostControlRoomLike {
  localParticipant: {
    identity: string;
    metadata?: string | undefined;
  };
  metadata?: string | undefined;
}

interface ActiveCallLike {
  externalId?: string | null;
  createdByUserId?: string | null;
}

interface HostControlContextLike {
  isNativeMode: boolean;
  participants: readonly HostControlParticipantLike[];
  room: HostControlRoomLike | null;
  externalId: string | null;
  callId: string | null;
  activeCalls: readonly ActiveCallLike[];
  hostControls: HostControls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeHostControls(value: unknown): HostControls | null {
  if (!isRecord(value)) return null;

  return {
    lockMic:
      typeof value['lockMic'] === 'boolean' ? value['lockMic'] : DEFAULT_HOST_CONTROLS.lockMic,
    lockCamera:
      typeof value['lockCamera'] === 'boolean'
        ? value['lockCamera']
        : DEFAULT_HOST_CONTROLS.lockCamera,
    lockScreenShare:
      typeof value['lockScreenShare'] === 'boolean'
        ? value['lockScreenShare']
        : DEFAULT_HOST_CONTROLS.lockScreenShare,
  };
}

export function parseHostControlsFromMetadata(metadata: string): HostControls | null {
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isRecord(parsed)) {
      console.warn('[hostControls] Ignoring non-object room metadata for host controls');
      return null;
    }

    const rawHostControls = parsed['hostControls'];
    const hostControls = normalizeHostControls(rawHostControls);
    if (!hostControls && rawHostControls !== undefined) {
      console.warn('[hostControls] Ignoring invalid hostControls metadata');
    }

    return hostControls;
  } catch (error) {
    console.warn('[hostControls] Failed to parse host controls metadata:', error);
    return null;
  }
}

function getLocalParticipantIdentity(context: HostControlContextLike): string | null {
  if (context.isNativeMode) {
    return context.participants.find(p => p.isLocal)?.identity ?? null;
  }

  return context.room?.localParticipant.identity ?? null;
}

function getActiveCallForContext(context: HostControlContextLike): ActiveCallLike | undefined {
  const externalId = context.externalId ?? context.callId;
  if (!externalId) return undefined;
  return context.activeCalls.find(call => call.externalId === externalId);
}

function getLocalParticipantMetadata(
  context: HostControlContextLike,
): Record<string, unknown> | null {
  if (context.isNativeMode) return null;

  const metadata = context.room?.localParticipant.metadata;
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(metadata) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isLocalExternalParticipant(context: HostControlContextLike): boolean {
  return getLocalParticipantMetadata(context)?.['isExternal'] === true;
}

export function isHostControlLockedForLocalWithControls(
  context: HostControlContextLike,
  hostControls: HostControls,
  lockKey: HostControlLockKey,
): boolean {
  if (!hostControls[lockKey]) return false;

  const localIdentity = getLocalParticipantIdentity(context);
  const currentCall = getActiveCallForContext(context);
  if (!localIdentity) return false;
  if (!currentCall?.createdByUserId) return isLocalExternalParticipant(context);

  return currentCall.createdByUserId !== localIdentity;
}

export function isHostControlLockedForLocal(
  context: HostControlContextLike,
  lockKey: HostControlLockKey,
): boolean {
  return isHostControlLockedForLocalWithControls(context, context.hostControls, lockKey);
}
