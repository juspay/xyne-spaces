import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  ReactNode,
  ReactElement,
} from 'react';
import { useLocation } from 'react-router-dom';

type EditSurface = string;

interface EditContextType {
  editingMessageId: string | null;
  editingSurface: EditSurface | null;
  requestEdit: (id: string, surface: EditSurface, onConfirm: () => void) => void;
  stopEditing: () => void;
  pendingAction: (() => void) | undefined;
  clearPendingAction: () => void;
}

const EditContext = createContext<EditContextType | undefined>(undefined);

const EditSurfaceContext = createContext<EditSurface>('root');

/** Provides editing state and controls for message editing */
export const EditProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [editing, setEditing] = useState<{ messageId: string; surface: EditSurface } | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | undefined>();

  const location = useLocation();

  const requestEdit = (id: string, surface: EditSurface, onConfirm: () => void): void => {
    if (editing && (editing.messageId !== id || editing.surface !== surface)) {
      setPendingAction(() => (): void => {
        setEditing({ messageId: id, surface });
        onConfirm();
      });
    } else {
      setEditing({ messageId: id, surface });
      onConfirm();
    }
  };

  const stopEditing = (): void => {
    setEditing(null);
  };

  useEffect(() => {
    stopEditing();
    setPendingAction(undefined);
  }, [location.pathname]);

  return (
    <EditContext.Provider
      value={{
        editingMessageId: editing?.messageId ?? null,
        editingSurface: editing?.surface ?? null,
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

export const EditSurfaceScope = ({ children }: { children: ReactNode }): ReactElement => {
  const surface = useId();
  return <EditSurfaceContext.Provider value={surface}>{children}</EditSurfaceContext.Provider>;
};

export const useEditContext = (): EditContextType => {
  const ctx = useContext(EditContext);
  if (!ctx) {
    throw new Error('useEditContext must be used inside EditProvider');
  }
  return ctx;
};

export const useMessageEdit = (): {
  isEditingMessage: (messageId: string) => boolean;
  requestEdit: (messageId: string, onConfirm: () => void) => void;
  stopEditing: () => void;
} => {
  const { editingMessageId, editingSurface, requestEdit, stopEditing } = useEditContext();
  const surface = useContext(EditSurfaceContext);

  const isEditingMessage = useCallback(
    (messageId: string): boolean => editingMessageId === messageId && editingSurface === surface,
    [editingMessageId, editingSurface, surface],
  );

  const requestEditHere = useCallback(
    (messageId: string, onConfirm: () => void): void => requestEdit(messageId, surface, onConfirm),
    [requestEdit, surface],
  );

  return { isEditingMessage, requestEdit: requestEditHere, stopEditing };
};
