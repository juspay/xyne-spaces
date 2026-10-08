import { useMemo } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useAllVisibleChannels, useUserChannelStatuses } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useClawAuthAgents } from '../../../hooks/useClawAuthAgents';
import { useUsers } from '../../../hooks/useUsers';
import { queries } from '../../../zero/queries';
import {
  groupChannelsByScope,
  isDMChannel,
  resolveChannelLabel,
} from '../../Chat/ChatDirectory/ChatDirectory.utils';
import type { ItemKind } from './destinations';

export interface NavigatorItem {
  label: string;
  /** Extra words Jev can match on, e.g. an agent's description. */
  detail?: string;
  path: string;
}

export type NavigatorItems = Record<ItemKind, readonly NavigatorItem[]>;

// Most recently updated first; enough for "open my X canvas" without paging.
const CANVAS_LIMIT = 300;

/**
 * The user's own canvases, DMs, channels and agents, each with the path that opens it. Mounted
 * only while the navigator is open, so these subscriptions cost nothing the rest of the time.
 */
export function useNavigatorItems(): NavigatorItems {
  const { userID } = useAuthContextValues();
  const users = useUsers();
  const visibleChannels = useAllVisibleChannels();
  const statuses = useUserChannelStatuses();
  const [canvasPage] = useCachedQuery(
    queries.userCanvasesPaginated({ limit: CANVAS_LIMIT, start: null }) as never,
    { cursorEnabled: true },
  );
  const { data: agents } = useClawAuthAgents();

  return useMemo(() => {
    const { starred, channels, directMessages } = groupChannelsByScope(visibleChannels, statuses);
    const dm: NavigatorItem[] = [];
    const channel: NavigatorItem[] = [];
    for (const c of [...starred, ...directMessages, ...channels]) {
      if (isDMChannel(c.scopeType)) {
        dm.push({
          label: resolveChannelLabel(c, userID, users),
          path: `/chat/dm/${c.id}?fromDM=true`,
        });
      } else {
        channel.push({ label: `#${c.name}`, path: `/chat/dir/${c.id}` });
      }
    }

    const canvasRows = (canvasPage as unknown as { id: string; title: string | null }[]) ?? [];
    const canvas = canvasRows.map(row => ({
      label: row.title?.trim() || 'Untitled',
      path: `/chat/canvas/${row.id}`,
    }));

    const agent = (agents ?? []).map(a => ({
      label: a.name,
      ...(a.description ? { detail: a.description } : {}),
      path: `/ai/library/agent/${encodeURIComponent(a.slug)}`,
    }));

    return { canvas, dm, channel, agent };
  }, [agents, canvasPage, statuses, userID, users, visibleChannels]);
}
