import {
  RoomCurationCadence,
  RoomMemberStatus,
  RoomRole,
  type RoomMember,
  type RoomMembershipState,
  type RoomWithMembers,
  type RoomWithMembership,
  type RoomChecklistItemDraft,
} from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';

export const CHECKLIST_ITEMS_MAX = 30;

export function createEmptyChecklistItem(): RoomChecklistItemDraft {
  return { id: uuidv4(), point: '', condition: '' };
}

function cleanChecklistField(value: string): string {
  return value
    .trim()
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s+[—–]\s+/g, ' - ');
}

function isChecklistFieldFilled(value: string): boolean {
  return cleanChecklistField(value).length > 0;
}

export function serializeChecklistItems(items: readonly RoomChecklistItemDraft[]): string {
  return items
    .filter(item => isChecklistFieldFilled(item.point) && isChecklistFieldFilled(item.condition))
    .map(
      item => `- **${cleanChecklistField(item.point)}** — ${cleanChecklistField(item.condition)}`,
    )
    .join('\n');
}

export function hasIncompleteChecklistRows(items: readonly RoomChecklistItemDraft[]): boolean {
  return items.some(
    item => isChecklistFieldFilled(item.point) !== isChecklistFieldFilled(item.condition),
  );
}

export function parseChecklistItems(markdown: string): RoomChecklistItemDraft[] {
  return (markdown ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const body = line
        .replace(/^[-*]\s+/, '')
        .replace(/^(?:✅|🚧|⬜|⛔)\s*/, '')
        .trim();
      const bold = body.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*(.*))?$/);
      if (bold) {
        return { id: uuidv4(), point: (bold[1] ?? '').trim(), condition: (bold[2] ?? '').trim() };
      }
      const parts = body.split(/\s+[—–]\s+/);
      if (parts.length >= 2) {
        return {
          id: uuidv4(),
          point: (parts[0] ?? '').replace(/\*\*/g, '').trim(),
          condition: parts.slice(1).join(' — ').trim(),
        };
      }
      return { id: uuidv4(), point: body.replace(/\*\*/g, '').trim(), condition: '' };
    });
}

export const CADENCE_OPTIONS: { value: RoomCurationCadence; label: string; detail: string }[] = [
  { value: RoomCurationCadence.MANUAL, label: 'Manual', detail: 'Curate on demand' },
  { value: RoomCurationCadence.DAILY, label: 'Daily', detail: 'One summary per day' },
  { value: RoomCurationCadence.HOURLY, label: 'Hourly', detail: 'For fast-moving rooms' },
];

function getMembershipState(membership: RoomMember | undefined): RoomMembershipState {
  if (!membership) return 'none';
  return membership.status === RoomMemberStatus.APPROVED ? 'joined' : 'pending';
}

export function getRoomOwnerId(members: readonly RoomMember[]): string | undefined {
  return members.find(
    member => member.role === RoomRole.OWNER && member.status === RoomMemberStatus.APPROVED,
  )?.userId;
}

export function isRoomOwner(members: readonly RoomMember[], userId: string | undefined): boolean {
  return !!userId && getRoomOwnerId(members) === userId;
}

export function partitionRooms(
  rooms: readonly RoomWithMembers[],
  userId: string | undefined,
): { joined: RoomWithMembership[]; suggested: RoomWithMembership[] } {
  const joined: RoomWithMembership[] = [];
  const suggested: RoomWithMembership[] = [];
  for (const room of rooms) {
    const membership = userId ? room.members.find(member => member.userId === userId) : undefined;
    const membershipState = getMembershipState(membership);
    const entry = { room, membership, membershipState };
    if (membershipState === 'joined') {
      joined.push(entry);
    } else {
      suggested.push(entry);
    }
  }
  return { joined, suggested };
}

export function formatUpdatedAt(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
