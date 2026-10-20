import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AccessType } from '@xyne/shared';
import { useCanReadTicket, usePermissions } from '@xyne/shared/hooks';

import type {
  MentionChannelOption,
  MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';
import { DASHBOARD_ORIGIN, IS_COMMUNITY_APP, PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { useAuth } from '@/src/contexts/AuthContext';
import { useBetaFlags } from '@/src/features/beta-flags';
import { TICKET_ROUTE } from '@/src/features/chat/navigation/chatRoutePolicy';
import {
  MENTION_CHANNEL_SCHEME,
  MENTION_USER_SCHEME,
} from '@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD';
import { openQuickActionSheet } from '@/src/features/quick-actions/state/sheet-store';
import { useSelf, useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { useSetting } from '@/src/machines/settingsMachine';
import { activeShellSegment, SPACES_SHELL_SEGMENT } from '@/src/navigation/routes';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import { queries } from '@/src/zero/queries';

import { routeIntent } from '../api/xyneAIRoute';
import {
  availableActions,
  jevActions,
  webUrl,
  type EntityKind,
  type NavigationAccess,
  type NavigationAction,
} from '../navigation/catalog';
import { extractTarget, looksLikeCommand } from '../navigation/command';
import { findChannels, findPeople } from '../navigation/directory';
import { answerLinkTarget } from '../navigation/answerLink';
import { knownActions, resolve } from '../navigation/intent';

/** How long a command may take to open something before it is sent to Xyne AI instead. */
const COMMAND_DEADLINE_MS = 4000;

export interface ActionChoice {
  type: 'action';
  id: string;
  title: string;
}

/** The matches of a command that named more than one, with the message it came from. */
export interface NavigationChoices {
  text: string;
  items: (MentionUserOption | MentionChannelOption | ActionChoice)[];
}

export interface XyneAINavigation {
  /** The command being classified, while it is. */
  routing: string | undefined;
  choices: NavigationChoices | undefined;
  /** Whether a message should first be tried as a command to open a screen. */
  isCommand: (text: string) => boolean;
  /** Opens what a command asks for; false means it is not one and should be sent to Xyne AI. */
  route: (text: string) => Promise<boolean>;
  cancel: () => void;
  /** Opens the chosen match; false means it opened nothing and the message should go to Xyne AI. */
  pick: (id: string) => Promise<boolean>;
  dismiss: () => void;
  /** Opens a link in an answer, in the app when it points at a chat or ticket. */
  openLink: (url: string) => void;
}

function useNavigationAccess(): NavigationAccess {
  const permissions = usePermissions();
  const tickets = useCanReadTicket();
  const { flags } = useBetaFlags();
  const orgRole = useAuth().user?.orgRole;
  const hasBetaFlags = flags.length > 0;

  return useMemo(() => {
    const has = (resource: string, ...types: AccessType[]): boolean =>
      permissions.some(p => p.resourceName === resource && types.includes(p.accessType));
    const workspace = has('WORKSPACE', AccessType.ADMIN);
    return {
      spaces: activeShellSegment() === SPACES_SHELL_SEGMENT,
      tickets,
      beta: hasBetaFlags,
      joinRequests: IS_COMMUNITY_APP && (orgRole === 'OWNER' || orgRole === 'ADMIN'),
      workspace,
      members: workspace || has('USERS', AccessType.ADMIN),
      userGroups: has('USER-GROUPS', AccessType.ADMIN, AccessType.WRITE),
      roles: has('ROLES', AccessType.ADMIN),
    };
  }, [permissions, tickets, hasBetaFlags, orgRole]);
}

export function useXyneAINavigation(openUrl: (url: string) => Promise<void>): XyneAINavigation {
  const enabled = useSetting('ai.navigation');
  const router = useRouter();
  const users = useUsers();
  const zero = useZero();
  const selfId = useSelf()?.id;
  const access = useNavigationAccess();
  const actions = useMemo(() => availableActions(access), [access]);
  const known = useMemo(() => new Map(actions.map(action => [action.id, action])), [actions]);
  const jev = useMemo(() => jevActions(actions), [actions]);
  const [routing, setRouting] = useState<string>();
  const [choices, setChoices] = useState<NavigationChoices>();
  const opener = useRef<(id: string) => Promise<boolean>>(undefined);
  const request = useRef<AbortController>(null);

  useEffect(() => () => request.current?.abort(), []);

  const openTicket = (ticketId: string): void =>
    router.push({ pathname: TICKET_ROUTE, params: { ticketId } });

  const choose = (
    items: (MentionUserOption | MentionChannelOption)[],
    target: string,
    text: string,
    open: (id: string) => void,
  ): boolean => {
    const found = resolve(target, items);
    if (found.kind === 'one') open(found.match.id);
    else if (found.kind === 'many') {
      opener.current = async id => {
        open(id);
        return true;
      };
      setChoices({ text, items: found.matches });
    }
    return found.kind !== 'none';
  };

  const openEntity = async (
    entity: EntityKind,
    text: string,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const target = extractTarget(entity, text);
    if (!target) return false;
    switch (entity) {
      case 'ticket': {
        const ticket = await zero.run(
          queries.ticketByXyneIdV3({ xyneId: target, workspaceId: getActiveWorkspaceId() ?? '' }),
          { type: 'complete' },
        );
        if (!ticket) return false;
        if (!signal.aborted) openTicket(ticket.id);
        return true;
      }
      case 'channel':
        return choose(
          findChannels(target),
          target,
          text,
          id => void openUrl(MENTION_CHANNEL_SCHEME + encodeURIComponent(id)),
        );
      case 'dm':
        return choose(
          findPeople(users, target, selfId),
          target,
          text,
          id => void openUrl(MENTION_USER_SCHEME + encodeURIComponent(id)),
        );
      case 'profile':
        return choose(findPeople(users, target), target, text, id =>
          router.push(id === selfId ? '/profile' : { pathname: '/profile/[id]', params: { id } }),
        );
    }
  };

  const cancel = (): void => {
    request.current?.abort();
    request.current = null;
    setRouting(undefined);
  };

  const run = (action: NavigationAction, text: string, signal: AbortSignal): Promise<boolean> => {
    const { target } = action;
    switch (target.kind) {
      case 'screen':
        router.push(typeof target.href === 'function' ? target.href() : target.href);
        break;
      case 'sheet':
        openQuickActionSheet(target.sheet);
        break;
      case 'web':
        void WebBrowser.openBrowserAsync(
          webUrl(DASHBOARD_ORIGIN, getActiveWorkspaceId(), target.path),
        ).catch(() => {});
        break;
      case 'entity':
        return openEntity(target.entity, text, signal);
    }
    return Promise.resolve(true);
  };

  const attempt = async (
    text: string,
    work: (signal: AbortSignal) => Promise<boolean>,
  ): Promise<boolean> => {
    request.current?.abort();
    const mine = new AbortController();
    request.current = mine;
    setChoices(undefined);
    setRouting(text);
    // Settles on cancel (true) or after the deadline (false, so the message goes to Xyne AI).
    const settled = new Promise<boolean>(done => {
      const timer = setTimeout(() => {
        done(false);
        mine.abort();
      }, COMMAND_DEADLINE_MS);
      mine.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        done(true);
      });
    });
    try {
      return await Promise.race([
        work(mine.signal).then(handled => handled || mine.signal.aborted),
        settled,
      ]);
    } catch {
      return mine.signal.aborted;
    } finally {
      if (request.current === mine) cancel();
    }
  };

  const route = (text: string): Promise<boolean> =>
    attempt(text, async signal => {
      const response = await routeIntent(text, jev, signal);
      if (signal.aborted) return true;
      const matches = knownActions(response, known);
      if (matches.length > 1) {
        opener.current = id => {
          const action = known.get(id);
          return action ? attempt(text, s => run(action, text, s)) : Promise.resolve(false);
        };
        setChoices({
          text,
          items: matches.map(({ id, title }) => ({ type: 'action', id, title })),
        });
        return true;
      }
      return matches[0] !== undefined && run(matches[0], text, signal);
    });

  const dismiss = (): void => setChoices(undefined);

  return {
    routing,
    choices,
    isCommand: text => enabled && looksLikeCommand(text),
    route,
    cancel,
    pick: async id => {
      dismiss();
      return (await opener.current?.(id)) ?? true;
    },
    dismiss,
    openLink: url => {
      const target = answerLinkTarget(url, PUBLIC_DEEP_LINK_ORIGIN, getActiveWorkspaceId());
      void openUrl(target ? MENTION_CHANNEL_SCHEME + target.channelId : url);
    },
  };
}
