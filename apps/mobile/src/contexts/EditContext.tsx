import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface EditingMessage {
  messageId: string;
  conversationId: string;
  content: string;
  channelId: string;
}

interface EditContextType {
  editingMessage: EditingMessage | null;
  startEditing: (message: EditingMessage) => void;
  stopEditing: () => void;
  isEditing: boolean;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

export const EditProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);

  const startEditing = useCallback((message: EditingMessage) => {
    setEditingMessage(message);
  }, []);

  const stopEditing = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const value: EditContextType = {
    editingMessage,
    startEditing,
    stopEditing,
    isEditing: editingMessage !== null,
  };

  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
};

export const useEditContext = (): EditContextType => {
  const context = useContext(EditContext);
  if (!context) {
    throw new Error('useEditContext must be used within EditProvider');
  }
  return context;
};

export const useEditContextOptional = (): EditContextType | null => {
  return useContext(EditContext) ?? null;
};
