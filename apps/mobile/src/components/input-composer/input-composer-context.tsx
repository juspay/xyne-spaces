import { createContext, useContext } from 'react';

import type {
  ChatInputActions,
  ChatInputConversation,
  ChatInputComposerState,
  ChatInputHandlers,
  ChatInputMentionState,
  ChatInputPanelState,
  ChatInputRichState,
  ChatInputText,
} from './input-composer.types';

const ChatInputConversationContext = createContext<ChatInputConversation | null>(null);
const ChatInputPanelStateContext = createContext<ChatInputPanelState | null>(null);
const ChatInputComposerStateContext = createContext<ChatInputComposerState | null>(null);
const ChatInputTextContext = createContext<ChatInputText | null>(null);
const ChatInputRichStateContext = createContext<ChatInputRichState | null>(null);
const ChatInputMentionStateContext = createContext<ChatInputMentionState | null>(null);
const ChatInputActionsContext = createContext<ChatInputActions | null>(null);
const ChatInputHandlersContext = createContext<ChatInputHandlers | null>(null);

const useChatInputConversation = (): ChatInputConversation => {
  const ctx = useContext(ChatInputConversationContext);
  if (!ctx) {
    throw new Error('useChatInputConversation must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputPanelState = (): ChatInputPanelState => {
  const ctx = useContext(ChatInputPanelStateContext);
  if (!ctx) {
    throw new Error('useChatInputPanelState must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputComposerState = (): ChatInputComposerState => {
  const ctx = useContext(ChatInputComposerStateContext);
  if (!ctx) {
    throw new Error('useChatInputComposerState must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputText = (): ChatInputText => {
  const ctx = useContext(ChatInputTextContext);
  if (!ctx) {
    throw new Error('useChatInputText must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputRichState = (): ChatInputRichState => {
  const ctx = useContext(ChatInputRichStateContext);
  if (!ctx) {
    throw new Error('useChatInputRichState must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputMentionState = (): ChatInputMentionState => {
  const ctx = useContext(ChatInputMentionStateContext);
  if (!ctx) {
    throw new Error('useChatInputMentionState must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputActions = (): ChatInputActions => {
  const ctx = useContext(ChatInputActionsContext);
  if (!ctx) {
    throw new Error('useChatInputActions must be used within <ChatInput.Provider>');
  }
  return ctx;
};

const useChatInputHandlers = (): ChatInputHandlers => {
  const ctx = useContext(ChatInputHandlersContext);
  if (!ctx) {
    throw new Error('useChatInputHandlers must be used within <ChatInput.Provider>');
  }
  return ctx;
};

export {
  ChatInputActionsContext,
  ChatInputConversationContext,
  ChatInputComposerStateContext,
  ChatInputHandlersContext,
  ChatInputMentionStateContext,
  ChatInputPanelStateContext,
  ChatInputRichStateContext,
  ChatInputTextContext,
  useChatInputActions,
  useChatInputConversation,
  useChatInputComposerState,
  useChatInputHandlers,
  useChatInputMentionState,
  useChatInputPanelState,
  useChatInputRichState,
  useChatInputText,
};
