import { createContext, useContext, useState, ReactNode, useEffect, ReactElement } from 'react';
import { useLocation } from 'react-router-dom';

interface EditContextType {
  editingMessageId: string | null;
  requestEdit: (id: string, onConfirm: () => void) => void;
  stopEditing: () => void;
  pendingAction: (() => void) | undefined;
  clearPendingAction: () => void;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

/** Provides editing state and controls for message editing */
export const EditProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | undefined>();

  const location = useLocation();

  const requestEdit = (id: string, onConfirm: () => void): void => {
    if (editingMessageId && editingMessageId !== id) {
      setPendingAction(() => (): void => {
        setEditingMessageId(id);
        onConfirm();
      });
    } else {
      setEditingMessageId(id);
      onConfirm();
    }
  };

  const stopEditing = (): void => {
    setEditingMessageId(null);
  };

  useEffect(() => {
    stopEditing();
    setPendingAction(undefined);
  }, [location.pathname]);

  return (
    <EditContext.Provider
      value={{
        editingMessageId,
        requestEdit,
        stopEditing,
        pendingAction,
        clearPendingAction: () => setPendingAction(undefined),
      }}
    >
      {children}
    </EditContext.Provider>
  );
};

export const useEditContext = (): EditContextType => {
  const ctx = useContext(EditContext);
  if (!ctx) {
    throw new Error('useEditContext must be used inside EditProvider');
  }
  return ctx;
};
