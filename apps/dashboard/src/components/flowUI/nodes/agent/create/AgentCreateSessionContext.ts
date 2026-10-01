import { createContext, useContext } from 'react';
import type { AgentCreateChatPatch } from './types';

export interface AgentCreateSessionValue {
  applyChatDraft: (sourceId: string, patch: AgentCreateChatPatch) => void;
}

export const AgentCreateSessionContext = createContext<AgentCreateSessionValue | null>(null);

export function useAgentCreateSession(): AgentCreateSessionValue | null {
  return useContext(AgentCreateSessionContext);
}
