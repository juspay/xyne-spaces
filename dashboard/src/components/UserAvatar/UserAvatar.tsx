import { Avatar, AvatarOnlinePosition, AvatarShape, AvatarSize } from '@juspay/blend-design-system';
import { ReactElement } from 'react';
import { UserPresenceStatus } from '@xyne/shared';
import { useUser } from '../../hooks/useUsers';

const UserAvatar = ({
  userId,
  size,
  shape,
  showActiveStatus = true,
}: {
  userId?: string | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  showActiveStatus?: boolean;
}): ReactElement => {
  const targetUserId = userId || '';
  const user = useUser(targetUserId);

  return (
    // do not add DIV or SPAN here, it breaks the Avatar component's layout
    <Avatar
      src={user?.picture || ''}
      alt={user?.name || 'User avatar'}
      online={showActiveStatus ? user?.presenceStatus?.status === UserPresenceStatus.ONLINE : false}
      shape={shape || AvatarShape.ROUNDED}
      onlinePosition={AvatarOnlinePosition.BOTTOM}
      size={size || AvatarSize.SM}
      fallback={user?.name
        ?.split(' ')
        .map(n => n[0])
        .join('')}
    />
  );
};

export default UserAvatar;
