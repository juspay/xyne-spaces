import { UserStatus } from '@xyne/shared';

type UserStatusFields = {
  statusEmoji?: string | null | undefined;
  statusExpiryAt?: number | null | undefined;
};

export type UserCustomStatusFields = UserStatusFields & {
  statusContent?: string | null | undefined;
};

type UserActivationFields = {
  status?: UserStatus | null | undefined;
};

export const isUserDeactivated = (user: UserActivationFields | null | undefined): boolean =>
  user?.status === UserStatus.INACTIVE;

export const isUserSelectable = (user: UserActivationFields | null | undefined): boolean =>
  !isUserDeactivated(user);

export const isStatusExpired = (expiryAt: number | null | undefined): boolean => {
  if (!expiryAt) return false;
  return Date.now() > expiryAt;
};

/** True when the user has a custom status that has not passed statusExpiryAt. */
export const hasActiveCustomStatus = (user: UserCustomStatusFields | null | undefined): boolean => {
  if (!user) return false;
  if (!(user.statusEmoji || user.statusContent)) return false;
  if (user.statusExpiryAt && isStatusExpired(user.statusExpiryAt)) return false;
  return true;
};

export const hasActiveUserStatus = (
  user: UserStatusFields | undefined,
): user is UserStatusFields & { statusEmoji: string } => {
  const emoji = user?.statusEmoji;
  if (!emoji) return false;
  const expiryAt = user?.statusExpiryAt;
  return !expiryAt || !isStatusExpired(expiryAt);
};

export const getActiveUserStatusEmoji = (
  user: UserCustomStatusFields | undefined,
): string | undefined => {
  if (!hasActiveCustomStatus(user)) return undefined;
  return user?.statusEmoji ?? undefined;
};

export const getActiveUserStatusContent = (
  user: UserCustomStatusFields | undefined,
): string | undefined => {
  if (!hasActiveCustomStatus(user)) return undefined;
  return user?.statusContent ?? undefined;
};
