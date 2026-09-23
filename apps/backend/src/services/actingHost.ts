import type { ParticipantInfo } from 'livekit-server-sdk';
import { isHumanParticipant, livekitService } from '@/services/liveKitService';
import { logger } from '@/utils/logger';

/**
 * Resolves the acting host (longest-present human) standing in for an absent host —
 * gets every host-only in-call action while the real host isn't in the room.
 * Two-way import with liveKitService is safe here (ES2020, function-scoped use only).
 */

/** Human (via isHumanParticipant) and not an external guest — guests get no admin rights. */
function isEligibleForActingHost(participant: ParticipantInfo): boolean {
  if (!isHumanParticipant(participant)) return false;

  if (participant.metadata) {
    try {
      const parsed = JSON.parse(participant.metadata) as unknown;
      if (parsed && typeof parsed === 'object' && (parsed as { isExternal?: unknown }).isExternal === true) {
        return false;
      }
    } catch {
      // Malformed metadata — treat as ineligible.
      return false;
    }
  }

  return true;
}

/** Prefers precise `joinedAtMs`; falls back to `joinedAt` (seconds); untimed sorts last. */
function joinTimeMs(participant: ParticipantInfo): number {
  if (participant.joinedAtMs && participant.joinedAtMs > 0n) return Number(participant.joinedAtMs);
  if (participant.joinedAt && participant.joinedAt > 0n) return Number(participant.joinedAt) * 1000;
  return Number.POSITIVE_INFINITY;
}

export interface ResolveActingHostParams {
  /** Room-metadata `createdBy` / `call.createdByUserId` — the call host's identity. */
  hostId: string | null | undefined;
  /** Current LiveKit room participants (e.g. from `listParticipantsOrThrow`). */
  participants: ParticipantInfo[];
  /** Identity to exclude even if still in `participants` (e.g. a just-left leaver). */
  excludeIdentity?: string;
}

/**
 * Identity of the acting host, or null when the host is present or nobody's
 * eligible. Ties broken by identity for determinism.
 */
export function resolveActingHost(params: ResolveActingHostParams): string | null {
  const { hostId, participants, excludeIdentity } = params;

  const hostPresent = !!hostId && participants.some(p => p.identity === hostId);
  if (hostPresent) return null;

  const eligible = participants.filter(
    p => p.identity !== excludeIdentity && p.identity !== hostId && isEligibleForActingHost(p),
  );
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    const diff = joinTimeMs(a) - joinTimeMs(b);
    if (diff !== 0) return diff;
    return a.identity.localeCompare(b.identity);
  });

  return eligible[0].identity;
}

/**
 * Authorizes a REST call: true iff `userId` is the real host, or is live-resolved
 * as the acting host. Fails closed (false) on any LiveKit lookup error — every
 * host-only endpoint should gate on this instead of a bare `createdByUserId` check.
 */
export async function isHostOrActingHost(params: {
  hostId: string;
  userId: string;
  roomName: string;
}): Promise<boolean> {
  const { hostId, userId, roomName } = params;
  if (userId === hostId) return true;
  try {
    const participants = await livekitService.listParticipantsOrThrow(roomName);
    return resolveActingHost({ hostId, participants }) === userId;
  } catch (error) {
    logger.warn(`[ActingHost] lookup failed, failing closed | room=${roomName}, userId=${userId}, error=${error}`);
    return false;
  }
}
