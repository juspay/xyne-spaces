import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSelectedAgent } from './useSelectedAgent';
import { useDisabledToolbarPaths } from './useDisabledToolbarPaths';
import { AI_ACTIVE_SESSION_KEY, AI_SHOW_CHAT_VIEW_KEY } from '../routes/AIScreen/aiSessionStorage';

const AI_SECTION_PATH = '/ai';
const AI_NEW_CHAT_PATH = '/ai/chat/new';
const ACCESSIBLE_AGENTS_QUERY_KEY = ['accessible-claw-agents'];

export interface UseOpenAgentChatReturn {
  canOpenAgentChat: boolean;
  openAgentChat: (slug: string) => void;
}

export function useOpenAgentChat(): UseOpenAgentChatReturn {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setSelectedAgentSlug } = useSelectedAgent();
  const disabledToolbarPaths = useDisabledToolbarPaths();
  const canOpenAgentChat = !disabledToolbarPaths.has(AI_SECTION_PATH);

  const openAgentChat = useCallback(
    (slug: string): void => {
      if (!canOpenAgentChat || !slug) {
        return;
      }
      setSelectedAgentSlug(slug);
      sessionStorage.removeItem(AI_ACTIVE_SESSION_KEY);
      sessionStorage.setItem(AI_SHOW_CHAT_VIEW_KEY, '0');
      void queryClient.invalidateQueries({ queryKey: ACCESSIBLE_AGENTS_QUERY_KEY });
      void navigate(`${AI_NEW_CHAT_PATH}?agent=${encodeURIComponent(slug)}`);
    },
    [canOpenAgentChat, navigate, queryClient, setSelectedAgentSlug],
  );

  return { canOpenAgentChat, openAgentChat };
}
