import { designVersions } from './designDocument';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Message } from '../../../Chat/XyneAISidebar/utils/XyneAITypes';
import type { DesignEditScope, DesignNodeSelection } from './designDocument';

export interface DesignSelectionPayload {
  scope: DesignEditScope;
  selector: string;
  tagName: string;
  label?: string;
  classes?: string[];
  text?: string;
  ancestors?: string[];
  styles?: Record<string, string>;
}

export interface PendingDesignEdit {
  html?: string;
  fileName: string;
  selection?: DesignSelectionPayload;
  clear: () => void;
}

export interface DesignModeState {
  active: boolean;
  available: boolean;
  exit: () => void;
  resume: () => void;
}

export interface PendingDesignSelection {
  label: string;
  tagName: string;
  scope: DesignEditScope;
}

interface DesignStudioContextValue {
  messages: Message[];
  designMode: DesignModeState;
  pendingSelection: PendingDesignSelection | null;
  clearPendingSelection: () => void;
  publishMessages: (messages: Message[]) => void;
  setPendingEdit: (edit: PendingDesignEdit | null) => void;
  readPendingEdit: () => PendingDesignEdit | null;
}

const DesignStudioContext = createContext<DesignStudioContextValue | null>(null);

export function useDesignStudio(): DesignStudioContextValue | null {
  return useContext(DesignStudioContext);
}

export function designSelectionPayload(
  selection: DesignNodeSelection,
  scope: DesignEditScope,
): DesignSelectionPayload {
  return {
    scope,
    selector: selection.selector,
    tagName: selection.tagName,
    label: selection.label,
    classes: selection.classes,
    text: selection.text,
    ancestors: selection.ancestors,
    styles: selection.styles,
  };
}

export function DesignStudioProvider({ children }: { children: ReactNode }): ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const pendingEditRef = useRef<PendingDesignEdit | null>(null);

  const publishMessages = useCallback((next: Message[]): void => {
    setMessages(prev => (prev === next ? prev : next));
  }, []);

  const [pendingSelection, setPendingSelection] = useState<PendingDesignSelection | null>(null);

  const setPendingEdit = useCallback((edit: PendingDesignEdit | null): void => {
    pendingEditRef.current = edit;
    const next = edit?.selection
      ? {
          label: edit.selection.label ?? edit.selection.tagName,
          tagName: edit.selection.tagName,
          scope: edit.selection.scope,
        }
      : null;
    setPendingSelection(prev =>
      prev?.label === next?.label && prev?.tagName === next?.tagName && prev?.scope === next?.scope
        ? prev
        : next,
    );
  }, []);

  const clearPendingSelection = useCallback((): void => {
    pendingEditRef.current?.clear();
    pendingEditRef.current = null;
    setPendingSelection(null);
  }, []);

  const readPendingEdit = useCallback((): PendingDesignEdit | null => pendingEditRef.current, []);

  const designAvailable = useMemo(() => {
    if (designVersions(messages).length > 0) return true;
    const lastUser = [...messages].reverse().find(m => m.type === 'user');
    return /^\s*\/design(?:\s|$)/i.test(lastUser?.content ?? '');
  }, [messages]);
  const conversationKey = messages[0]?.id ?? '';
  const [exitedFor, setExitedFor] = useState<string | null>(null);
  const designMode = useMemo<DesignModeState>(
    () => ({
      available: designAvailable,
      active: designAvailable && exitedFor !== conversationKey,
      exit: () => setExitedFor(conversationKey),
      resume: () => setExitedFor(null),
    }),
    [designAvailable, exitedFor, conversationKey],
  );

  const value = useMemo(
    () => ({
      messages,
      designMode,
      pendingSelection,
      clearPendingSelection,
      publishMessages,
      setPendingEdit,
      readPendingEdit,
    }),
    [
      messages,
      designMode,
      pendingSelection,
      clearPendingSelection,
      publishMessages,
      setPendingEdit,
      readPendingEdit,
    ],
  );

  return <DesignStudioContext.Provider value={value}>{children}</DesignStudioContext.Provider>;
}
