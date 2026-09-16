import type { ReactNode } from 'react';
import { Hash, Lock, Users } from 'lucide-react';
import { ChannelVisibility } from '@xyne/shared';
import type { UserGroupLike, VisibleChannel } from '@xyne/shared/hooks';
import type { User } from '../../machines/stateMachine';
import { getUserDisplayName, isUserDeactivated } from '../../utils/userDisplayName';
import Avatar from '../ui/Avatar/Avatar';
import { ParticipantOptionContent } from './ParticipantOptionContent';

/**
 * Row builders shared by the call participant pickers (Instant / Schedule).
 *
 * These allocate React elements, so they must only ever be mapped over a BOUNDED
 * list — the ranked slice from `useParticipantCandidates`, or the current
 * selection. Mapping them over the full workspace roster is what made the call
 * modals slow in the first place.
 */

export interface ParticipantOption {
  value: string;
  label: string;
  subtitle?: string | null;
  icon: ReactNode;
  children?: ReactNode;
  isDeactivated?: boolean;
  type: 'user' | 'channel' | 'user_group';
}

/** Minimal shape the user row needs — channel-member payloads omit most fields. */
export type UserLikeForOption = Pick<User, 'id' | 'name'> &
  Partial<Pick<User, 'email' | 'displayName' | 'status'>>;

const userAvatar = (userId: string): ReactNode => (
  <Avatar
    userId={userId}
    size='sm'
    showActiveStatus={false}
    className='rounded-md size-[18px] flex items-center justify-center bg-background'
  />
);

export function buildUserParticipantOption(user: UserLikeForOption): ParticipantOption {
  const label = getUserDisplayName(user);
  return {
    ...user,
    value: `user:${user.id}`,
    label,
    // The dropdown row comes from `children`, so this only surfaces in the
    // channel-member checklist — whose payload is `{ id, name }` with no email.
    // Falling back to `name` keeps that list rendering exactly as it did.
    subtitle: user.email ?? user.name,
    icon: userAvatar(user.id),
    children: (
      <ParticipantOptionContent
        icon={userAvatar(user.id)}
        label={label}
        subtitle={user.email}
        isDeactivated={isUserDeactivated(user)}
      />
    ),
    type: 'user',
  };
}

export function buildChannelParticipantOption(
  channel: Pick<VisibleChannel, 'id' | 'name' | 'visibility'>,
): ParticipantOption {
  return {
    ...channel,
    value: `channel:${channel.id}`,
    label: channel.name,
    icon:
      channel.visibility === ChannelVisibility.PRIVATE ? (
        <Lock className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />
      ) : (
        <Hash className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />
      ),
    type: 'channel',
  };
}

export function buildUserGroupParticipantOption(group: UserGroupLike): ParticipantOption {
  const icon = <Users className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />;
  const subtitle = group.alias || group.description;
  return {
    ...group,
    value: `user_group:${group.id}`,
    label: group.name,
    subtitle,
    icon,
    children: <ParticipantOptionContent icon={icon} label={group.name} subtitle={subtitle} />,
    type: 'user_group',
  };
}
