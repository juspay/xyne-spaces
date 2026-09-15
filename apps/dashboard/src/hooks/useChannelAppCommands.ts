import { useQuery } from '@tanstack/react-query';
import { CommandAccessibility } from '@xyne/shared';
import {
  appsService,
  type AppCommand,
  type AppShortcutWithApp,
  type ShortcutType,
} from '../services/Apps/appsService';

const EMPTY_COMMANDS: AppCommand[] = [];
const EMPTY_SHORTCUTS: AppShortcutWithApp[] = [];

/**
 * Channel commands/shortcuts are read from components that mount constantly —
 * every message row in the virtualized chat list, every composer in a
 * virtualized thread-card list. Fetching them in a `useEffect` meant one request
 * per mount, so scrolling flooded `/apps/channel/:id/commands`. Going through
 * react-query dedupes concurrent mounts onto a single request and keeps the
 * result cached across unmount/remount (staleTime is 5min by default).
 */
export function useChannelCommands(
  channelId: string | undefined,
  commandAccessibility: CommandAccessibility,
): AppCommand[] {
  const { data } = useQuery({
    queryKey: ['channel-commands', channelId, commandAccessibility],
    queryFn: () => appsService.getChannelCommands(channelId ?? '', { commandAccessibility }),
    enabled: !!channelId,
  });
  return data ?? EMPTY_COMMANDS;
}

export function useChannelShortcuts(
  channelId: string | undefined,
  type: ShortcutType,
): AppShortcutWithApp[] {
  const { data } = useQuery({
    queryKey: ['channel-shortcuts', channelId, type],
    queryFn: () => appsService.getChannelShortcuts(channelId ?? '', { type }),
    enabled: !!channelId,
  });
  return data ?? EMPTY_SHORTCUTS;
}
