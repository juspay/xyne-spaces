import { Avatar, AvatarOnlinePosition, AvatarShape, AvatarSize } from '@juspay/blend-design-system';
import { ReactElement } from 'react';
import { useUser } from '../../hooks/useUsers';
import { useUserPresence } from '../../hooks/usePresence';
import { useProfilePictureUrl } from '../../hooks/useProfilePicture';
import { getUserDisplayName } from '../../utils/userDisplayName';

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

  // Use the same avatar loading logic as the Avatar component
  const { url: pictureUrl } = useProfilePictureUrl(targetUserId, user?.picture);

  return (
    // do not add DIV or SPAN here, it breaks the Avatar component's layout
    <Avatar
      className='visual-regression-hide'
      src={pictureUrl || ''}
      alt={getUserDisplayName(user) || 'User avatar'}
      online={showActiveStatus ? isOnline : false}
      shape={shape || AvatarShape.ROUNDED}
      onlinePosition={AvatarOnlinePosition.BOTTOM}
      size={size || AvatarSize.SM}
      fallback={getUserDisplayName(user)
        ?.split(' ')
        .map(n => n[0])
        .join('')}
    />
  );
};

export default UserAvatar;
