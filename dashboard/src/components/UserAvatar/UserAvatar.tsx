import { Avatar, AvatarOnlinePosition, AvatarShape, AvatarSize } from '@juspay/blend-design-system';
import { ReactElement } from 'react';
import { useUser } from '../../hooks/useUsers';
import { useUserPresence } from '../../hooks/usePresence';

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

  // Get online status from Socket.IO presence (not Zero/DB)
  const { status } = useUserPresence(targetUserId);
  const isOnline = status === 'ONLINE';

  return (
    // do not add DIV or SPAN here, it breaks the Avatar component's layout
    <Avatar
      className='visual-regression-hide'
      src={user?.picture || ''}
      alt={user?.name || 'User avatar'}
      online={showActiveStatus ? isOnline : false}
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
