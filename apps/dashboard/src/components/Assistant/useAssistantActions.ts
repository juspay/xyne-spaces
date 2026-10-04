import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrganisationsAccess } from '../../routes/OrganisationsModule/organisationsSections';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type { ActionDefinition } from './actions/action';
import { ACTIONS } from './catalog';
import { APP_PAGES, visibleActions } from './pages';
import { routeText } from './router';
import {
  exchange,
  markOpened,
  pillAction,
  starterActions,
  toChatMessages,
  type AssistantTurn,
} from './turns';

export interface AssistantActions {
  actions: readonly ActionDefinition[];
  starters: readonly ActionDefinition[];
  messages: Message[];
  isRouting: boolean;
  choose: (action: ActionDefinition) => void;
  openPill: (messageId: string, label: string) => void;
  reset: () => void;
  cancel: () => void;
  ask: (text: string) => Promise<AskOutcome>;
  // Voice: the reply to speak, '' when the text was handled with nothing to say, null to send it to Ask AI.
  answer: (text: string) => Promise<string | null>;
}

export type AskOutcome =
  | { outcome: 'replied'; reply: string }
  | { outcome: 'ask_ai' }
  | { outcome: 'cancelled' };

const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const useAssistantActions = ({ enabled }: { enabled: boolean }): AssistantActions => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const organisations = useOrganisationsAccess();
  const role = useAuth().user?.role;
  const actions = useMemo(
    () => (enabled ? visibleActions(ACTIONS, { organisations }) : []),
    [enabled, organisations],
  );
  const isAdmin = role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;
  const starters = useMemo(() => starterActions(actions, isAdmin), [actions, isAdmin]);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const messages = useMemo(() => toChatMessages(turns), [turns]);
  const [isRouting, setIsRouting] = useState(false);
  const routingRef = useRef<AbortController | null>(null);

  const append = useCallback((userText: string, chosen: readonly ActionDefinition[]): string => {
    const pair = exchange(userText, chosen, new Date(), newId);
    setTurns(prev => [...prev, ...pair]);
    return pair[1].text;
  }, []);

  const choose = useCallback(
    (action: ActionDefinition): void => {
      append(action.title, [action]);
    },
    [append],
  );

  const openPill = useCallback(
    (messageId: string, label: string): void => {
      const action = pillAction(turns, messageId, label);
      if (!action) return;
      const base = workspaceId ? `/${workspaceId}` : '';
      void navigate(`${base}/${APP_PAGES[action.page].path}`);
      setTurns(prev => markOpened(prev, messageId, action.id));
    },
    [turns, navigate, workspaceId],
  );

  const cancel = useCallback((): void => {
    routingRef.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    cancel();
    setTurns([]);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  const ask = useCallback(
    async (text: string): Promise<AskOutcome> => {
      if (routingRef.current) return { outcome: 'cancelled' };
      const controller = new AbortController();
      routingRef.current = controller;
      setIsRouting(true);
      try {
        const route = await routeText(text.trim(), actions, controller.signal);
        if (controller.signal.aborted) return { outcome: 'cancelled' };
        if (route.kind === 'ask_ai') return { outcome: 'ask_ai' };
        return { outcome: 'replied', reply: append(text.trim(), route.actions) };
      } catch {
        return { outcome: 'ask_ai' };
      } finally {
        if (routingRef.current === controller) {
          routingRef.current = null;
          setIsRouting(false);
        }
      }
    },
    [actions, append],
  );

  const answer = useCallback(
    async (text: string): Promise<string | null> => {
      const result = await ask(text);
      if (result.outcome === 'replied') return result.reply;
      return result.outcome === 'cancelled' ? '' : null;
    },
    [ask],
  );

  return { actions, starters, messages, isRouting, choose, openPill, reset, cancel, ask, answer };
};
