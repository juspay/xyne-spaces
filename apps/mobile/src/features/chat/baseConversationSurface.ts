import type { Href } from 'expo-router';

import { ChannelScopeType } from '@xyne/shared';
import { tabRoute } from '@/src/navigation/routes';

export type BaseConversationSurface = 'channels' | 'dms';

export const getBaseConversationSurfacePath = (surface: BaseConversationSurface): Href =>
  surface === 'dms' ? tabRoute('dms') : tabRoute('channels');

export const resolveBaseConversationSurface = (
  scopeType: string | undefined,
  explicitSurface?: BaseConversationSurface,
): BaseConversationSurface => {
  if (explicitSurface) return explicitSurface;
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM
    ? 'dms'
    : 'channels';
};
