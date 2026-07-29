import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AI_ACTIVE_SESSION_KEY, AI_SHOW_CHAT_VIEW_KEY } from './aiSessionStorage';

export function useAIChatHandoff(): {
  onCreateChat: () => void;
  onSelectSession: (sessionId: string) => void;
} {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const chatPath = workspaceId ? `/${workspaceId}/ai/chat/new` : '/ai/chat/new';

  const onCreateChat = useCallback((): void => {
    sessionStorage.removeItem(AI_ACTIVE_SESSION_KEY);
    sessionStorage.setItem(AI_SHOW_CHAT_VIEW_KEY, '0');
    void navigate(chatPath);
  }, [navigate, chatPath]);

  const onSelectSession = useCallback(
    (sessionId: string): void => {
      sessionStorage.setItem(AI_ACTIVE_SESSION_KEY, sessionId);
      sessionStorage.setItem(AI_SHOW_CHAT_VIEW_KEY, '1');
      void navigate(chatPath);
    },
    [navigate, chatPath],
  );

  return { onCreateChat, onSelectSession };
}
