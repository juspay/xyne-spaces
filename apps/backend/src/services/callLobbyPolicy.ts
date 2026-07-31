import { CallStatus } from '@prisma/client';

// Shared by the guest lobby and unified invite detector so routing cannot
// silently drift from the statuses the lobby itself accepts.
const JOINABLE_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

export function isCallLobbyJoinable(status: CallStatus): boolean {
  return JOINABLE_STATUSES.has(status);
}
