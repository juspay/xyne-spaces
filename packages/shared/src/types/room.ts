import type { Room, RoomMember } from '../zero/schema';

export type RoomMembershipState = 'joined' | 'pending' | 'none';

/** A room row loaded with its `members` relationship inlined. */
export type RoomWithMembers = Room & { members: readonly RoomMember[] };

export interface RoomWithMembership {
  room: RoomWithMembers;
  membership: RoomMember | undefined;
  membershipState: RoomMembershipState;
}

export interface RoomChecklistItemDraft {
  id: string;
  point: string;
  condition: string;
}
