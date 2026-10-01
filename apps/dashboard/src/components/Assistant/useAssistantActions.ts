import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrganisationsAccess } from '../../routes/OrganisationsModule/organisationsSections';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type { ActionDefinition } from './actions/action';
import { AREAS } from './catalog';
import { runPlan } from './operations';
import { visibleActions } from './pages';
import { routeText } from './router';
import { exchange, markOpened, starterActions, toChatMessages, type AssistantTurn } from './turns';

export interface AssistantActions {
  actions: readonly ActionDefinition[];
  starters: readonly ActionDefinition[];
  turns: readonly AssistantTurn[];
  messages: Message[];
  isRouting: boolean;
  choose: (action: ActionDefinition) => void;
  open: (action: ActionDefinition, messageId?: string) => void;
  reset: () => void;
  cancel: () => void;
  ask: (text: string) => Promise<AskOutcome>;
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
    () => (enabled ? visibleActions(AREAS, { organisations }) : []),
    [enabled, organisations],
  );
  const isAdmin = role === WorkspaceRole.ADMIN || role === WorkspaceRole.OWNER;
  const starters = useMemo(() => starterActions(actions, isAdmin), [actions, isAdmin]);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const messages = useMemo(() => toChatMessages(turns), [turns]);
  const [isRouting, setIsRouting] = useState(false);
  const routingRef = useRef<AbortController | null>(null);

  const run = useCallback(
    (action: ActionDefinition): void =>
      runPlan(action, {
        navigate: path => void navigate(path),
        workspaceBase: workspaceId ? `/${workspaceId}` : '',
      }),
    [navigate, workspaceId],
  );

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

  const open = useCallback(
    (action: ActionDefinition, messageId?: string): void => {
      run(action);
      if (messageId) setTurns(prev => markOpened(prev, messageId, action.id));
    },
    [run],
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
      } finally {
        if (routingRef.current === controller) {
          routingRef.current = null;
          setIsRouting(false);
        }
      }
    },
    [actions, append],
  );

  return { actions, starters, turns, messages, isRouting, choose, open, reset, cancel, ask };
};
