/**
 * AttachmentViewer Context for Lotus
 *
 * Manages state for the full-screen attachment viewer.
 * Handles opening/closing, navigation between attachments, and media list.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { MessageAttachment } from '../message-attachments.utils';

interface AttachmentViewerState {
  isOpen: boolean;
  attachments: MessageAttachment[];
  currentIndex: number;
  isListOpen: boolean;
  listAttachments: MessageAttachment[];
}

interface AttachmentViewerActions {
  open: (attachments: MessageAttachment[], startIndex?: number) => void;
  close: () => void;
  goToIndex: (index: number) => void;
  openList: (attachments: MessageAttachment[]) => void;
  closeList: () => void;
  openFromList: (index: number) => void;
}

type AttachmentViewerContextType = AttachmentViewerState & AttachmentViewerActions;

const AttachmentViewerContext = createContext<AttachmentViewerContextType | null>(null);

export function useAttachmentViewer(): AttachmentViewerContextType {
  const context = useContext(AttachmentViewerContext);
  if (!context) {
    throw new Error('useAttachmentViewer must be used within AttachmentViewerProvider');
  }
  return context;
}

export function AttachmentViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AttachmentViewerState>({
    isOpen: false,
    attachments: [],
    currentIndex: 0,
    isListOpen: false,
    listAttachments: [],
  });

  const open = useCallback((attachments: MessageAttachment[], startIndex: number = 0) => {
    setState(prev => ({
      ...prev,
      isOpen: true,
      attachments,
      currentIndex: startIndex,
    }));
  }, []);

  const close = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: false,
      currentIndex: 0,
    }));
  }, []);

  const goToIndex = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      currentIndex: index,
    }));
  }, []);

  const openList = useCallback((attachments: MessageAttachment[]) => {
    setState(prev => ({
      ...prev,
      isListOpen: true,
      listAttachments: attachments,
    }));
  }, []);

  const closeList = useCallback(() => {
    setState(prev => ({
      ...prev,
      isListOpen: false,
    }));
  }, []);

  const openFromList = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      isListOpen: false,
      isOpen: true,
      attachments: prev.listAttachments,
      currentIndex: index,
    }));
  }, []);

  return (
    <AttachmentViewerContext.Provider
      value={{
        ...state,
        open,
        close,
        goToIndex,
        openList,
        closeList,
        openFromList,
      }}
    >
      {children}
    </AttachmentViewerContext.Provider>
  );
}
