import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useActorRef, useSelector } from '@xstate/react';
import { vscodeWorkspaceMachine, LastWorkspace } from '../machines/vscodeWorkspaceMachine';

interface IframeConfig {
  url: string;
}

interface VSCodeContextType {
  activeVSCodeSessions: string[];
  registerSession: (
    workspacePath: string,
    url?: string,
    branchName?: string,
    repoName?: string,
    ticketId?: string,
  ) => void;
  unregisterSession: (workspacePath: string) => void;
  hasActiveSessions: () => boolean;
  lastWorkspace: LastWorkspace | null;
  getLastWorkspace: () => LastWorkspace | null;

  // Persistent Iframe Support
  activeContainer: HTMLElement | null;
  activeConfig: IframeConfig | null;
  attachIframe: (container: HTMLElement, config: IframeConfig) => void;
  detachIframe: () => void;
}

const VSCodeContext = createContext<VSCodeContextType | undefined>(undefined);

interface VSCodeProviderProps {
  children: ReactNode;
}

export const VSCodeProvider: React.FC<VSCodeProviderProps> = ({ children }) => {
  const actorRef = useActorRef(vscodeWorkspaceMachine);

  const activeVSCodeSessions = useSelector(actorRef, state => state.context.activeVSCodeSessions);
  const lastWorkspace = useSelector(actorRef, state => state.context.lastWorkspace);

  // Persistent Iframe State (DOM elements cannot always be in XState safely)
  const [activeContainer, setActiveContainer] = useState<HTMLElement | null>(null);
  const [activeConfig, setActiveConfig] = useState<IframeConfig | null>(null);

  const attachIframe = useCallback((container: HTMLElement, config: IframeConfig) => {
    setActiveContainer(container);
    setActiveConfig(config);
  }, []);

  const detachIframe = useCallback(() => {
    setActiveContainer(null);
  }, []);

  const registerSession = useCallback(
    (
      workspacePath: string,
      url?: string,
      branchName?: string,
      repoName?: string,
      ticketId?: string,
    ) => {
      actorRef.send({ type: 'REGISTER_SESSION', workspacePath });

      if (url) {
        actorRef.send({
          type: 'SET_LAST_WORKSPACE',
          workspace: { path: workspacePath, url, branchName, repoName, ticketId },
        });
      }
    },
    [actorRef],
  );

  const unregisterSession = useCallback(
    (workspacePath: string) => {
      actorRef.send({ type: 'UNREGISTER_SESSION', workspacePath });
    },
    [actorRef],
  );

  const hasActiveSessions = useCallback(() => {
    return activeVSCodeSessions.length > 0;
  }, [activeVSCodeSessions]);

  const getLastWorkspace = useCallback(() => {
    return lastWorkspace;
  }, [lastWorkspace]);

  const value: VSCodeContextType = {
    activeVSCodeSessions,
    registerSession,
    unregisterSession,
    hasActiveSessions,
    lastWorkspace,
    getLastWorkspace,
    activeContainer,
    activeConfig,
    attachIframe,
    detachIframe,
  };

  return <VSCodeContext.Provider value={value}>{children}</VSCodeContext.Provider>;
};

export const useVSCode = (): VSCodeContextType => {
  const context = useContext(VSCodeContext);
  if (context === undefined) {
    throw new Error('useVSCode must be used within a VSCodeProvider');
  }
  return context;
};
