import type { User } from '@xyne/shared';

type UserProfileRow = {
  readonly id: string;
  readonly userId: string;
  readonly dob: number | null;
  readonly phoneNumber: string | null;
  readonly displayName: string | null;
  readonly team: string | null;
  readonly pronunciation: string | null;
  readonly manager: string | null;
  readonly role: string | null;
  readonly joinedOn: number | null;
  readonly hasVoiceSignature: boolean | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

type PresenceStatus = 'ONLINE' | 'AWAY' | 'OFFLINE';

type UserProfileContextValue = {
  userId: string;
  user: User | undefined;
  profile: UserProfileRow | undefined;
  isOwnProfile: boolean;
  isOnline: boolean;
  presenceStatus: PresenceStatus;
};

export type { UserProfileRow, PresenceStatus, UserProfileContextValue };
