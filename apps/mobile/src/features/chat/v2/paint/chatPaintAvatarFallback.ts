import type { AvatarFallbackUser } from '@/src/components/ui/avatar/avatar.types';

import type { SenderPaintModel } from './chatPaint.types';

export function getSenderAvatarFallbackUser(
  sender: SenderPaintModel | null | undefined,
): AvatarFallbackUser | undefined {
  if (!sender?.senderId) return undefined;

  return {
    id: sender.senderId,
    name: sender.displayName,
    displayName: sender.displayName,
    picture: sender.avatarUri,
  };
}

export function getSenderAvatarFallbackUsers(
  sender: SenderPaintModel | null | undefined,
): readonly AvatarFallbackUser[] {
  const fallbackUser = getSenderAvatarFallbackUser(sender);
  return fallbackUser ? [fallbackUser] : [];
}
