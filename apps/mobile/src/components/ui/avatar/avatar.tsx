import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { AvatarFace } from './avatar-face';
import { AvatarGroupFace } from './avatar-group-face';
import { type AvatarProps } from './avatar.types';

const Avatar = memo(function Avatar({
  userIds,
  fallbackUsers = [],
  size = 48,
  style,
  rounded = true,
}: AvatarProps) {
  const validUserIds = useMemo(
    () => userIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    [userIds],
  );

  if (validUserIds.length === 0) {
    return null;
  }

  if (validUserIds.length === 1) {
    const fallbackUser = fallbackUsers.find(user => user.id === validUserIds[0]!);
    return (
      <View style={style}>
        <AvatarFace
          key={validUserIds[0]!}
          userId={validUserIds[0]!}
          size={size}
          rounded={rounded}
          {...(fallbackUser ? { fallbackUser } : {})}
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <AvatarGroupFace
        key={`${validUserIds[0]!}:${validUserIds[1]!}`}
        userIds={[validUserIds[0]!, validUserIds[1]!]}
        fallbackUsers={fallbackUsers}
        size={size}
      />
    </View>
  );
});

export default Avatar;
