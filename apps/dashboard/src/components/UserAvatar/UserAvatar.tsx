import { ReactElement } from 'react';
import Avatar, { AvatarSize as RadixAvatarSize } from '../ui/Avatar/Avatar';

// Drop-in replacements for the Blend enums.
// Values map directly to the radix Avatar's size strings.
export const AvatarSize = {
  SM: 'sm',
  REGULAR: 'rg',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
} as const;

export type AvatarSizeValue = (typeof AvatarSize)[keyof typeof AvatarSize];

export const AvatarShape = {
  CIRCULAR: 'circular',
  ROUNDED: 'rounded',
} as const;

export type AvatarShapeValue = (typeof AvatarShape)[keyof typeof AvatarShape];

const UserAvatar = ({
  userId,
  size,
  shape,
  showActiveStatus = true,
}: {
  userId?: string | null;
  size?: AvatarSizeValue;
  shape?: AvatarShapeValue;
  showActiveStatus?: boolean;
}): ReactElement => {
  const rounded = shape === AvatarShape.CIRCULAR;
  const radixSize = (size ?? AvatarSize.SM) as RadixAvatarSize;

  return (
    <Avatar
      userId={userId ?? null}
      size={radixSize}
      rounded={rounded}
      showActiveStatus={showActiveStatus}
    />
  );
};

export default UserAvatar;
