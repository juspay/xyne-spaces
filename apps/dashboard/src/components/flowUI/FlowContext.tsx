import { createContext, useContext } from 'react';
import type { FlowState, FlowAction, AppActionResponse } from '@xyne/shared';

export interface FlowMessageContext {
  channelId?: string;
  senderId?: string;
  createdAt?: number;
  surface?: 'channel' | 'thread';
}

export interface FlowContextValue {
  state: FlowState;
  data: Record<string, unknown>;
  isSubmitting: boolean;
  /** true when rendered inside the action-response popup */
  compact: boolean;
  updateFieldValue: (name: string, value: unknown) => void;
  validateField: (name: string, value: unknown) => string | null;
  validateAllFields: () => boolean;
  executeAction: (action: FlowAction) => Promise<void>;
  onAppAction: (response: AppActionResponse) => void;
  messageId: string;
  conversationId: string;
  messageContext?: FlowMessageContext;
}

export const FlowContext = createContext<FlowContextValue | null>(null);

export const useFlow = (): FlowContextValue => {
  const ctx = useContext(FlowContext);
  if (!ctx) {
    throw new Error('useFlow must be used within FlowContext.Provider');
  }
  return ctx;
};
