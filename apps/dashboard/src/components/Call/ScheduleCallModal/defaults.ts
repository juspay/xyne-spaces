import { getUserDisplayName } from '../../../utils/userDisplayName';

type DisplayUser = Parameters<typeof getUserDisplayName>[0];

export const getDefaultScheduledCallTitle = (user: DisplayUser): string => {
  const displayName = getUserDisplayName(user);
  return displayName !== 'Unknown' ? `${displayName.split(' ')[0]}'s Call` : '';
};
