import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { CommandAccessibility } from '@xyne/shared';
import {
  appsService,
  type AppCommand,
  type AppShortcutWithApp,
} from '../services/Apps/appsService';
import type { ShortcutType } from '../services/Apps/appsTypes';

/**
 * App slash-commands available in a channel, scoped by accessibility
 * (THREAD vs CHAT). Keyed on (channelId, accessibility) — NOT on the specific
 * conversation — so every thread opened inside the same channel shares one
 * cache entry instead of re-hitting `GET /apps/channel/:id/commands` on each
 * open. React Query also dedups the concurrent requests that the several
 * ChatInput instances (main composer, thread panel, edit box) would otherwise
 * each fire on mount.
 */
export const useChannelCommands = (
  channelId: string,
  accessibility: CommandAccessibility.THREAD | CommandAccessibility.CHAT,
): UseQueryResult<AppCommand[], Error> =>
  useQuery({
    queryKey: ['channel-commands', channelId, accessibility],
    queryFn: () =>
      appsService.getChannelCommands(channelId, { commandAccessibility: accessibility }),
    enabled: !!channelId,
  });

/**
 * Global app shortcuts available in a channel. Same caching rationale as
 * useChannelCommands — shortcuts are per-channel, not per-conversation.
 */
export const useChannelShortcuts = (
  channelId: string,
  type: ShortcutType = 'GLOBAL',
): UseQueryResult<AppShortcutWithApp[], Error> =>
  useQuery({
    queryKey: ['channel-shortcuts', channelId, type],
    queryFn: () => appsService.getChannelShortcuts(channelId, { type }),
    enabled: !!channelId,
  });
