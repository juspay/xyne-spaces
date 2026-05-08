import React, { createContext, useContext, useState } from 'react';

/**
 * Provides a setter so child layouts (TreeLayout, FileViewerLayout) can slot
 * a ChatOverlay ReactNode into the KnowledgeBaseLayout's resizable right panel
 * without needing to own the PanelGroup themselves.
 */
export const KBChatSetterContext = createContext<(node: React.ReactNode) => void>(() => {});
export const KBChatNodeContext = createContext<React.ReactNode>(null);

interface KBChatProviderProps {
  children: React.ReactNode;
}

export const KBChatProvider: React.FC<KBChatProviderProps> = ({ children }) => {
  const [chatNode, setChatNode] = useState<React.ReactNode>(null);
  return (
    <KBChatSetterContext.Provider value={setChatNode}>
      <KBChatNodeContext.Provider value={chatNode}>{children}</KBChatNodeContext.Provider>
    </KBChatSetterContext.Provider>
  );
};

/** Returns the setter — use in TreeLayout / FileViewerLayout */
export const useSetKBChat = (): ((node: React.ReactNode) => void) =>
  useContext(KBChatSetterContext);

/** Returns the current chat node — use in KnowledgeBaseLayout */
export const useKBChatNode = (): React.ReactNode => useContext(KBChatNodeContext);
