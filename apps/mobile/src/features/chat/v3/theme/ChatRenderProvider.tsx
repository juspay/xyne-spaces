import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { DEFAULT_CHAT_RENDER_TOKENS, type ChatRenderTokens } from '@/src/theme/chatRenderTokens';

const ChatRenderContext = createContext<ChatRenderTokens>(DEFAULT_CHAT_RENDER_TOKENS);

export const ChatRenderProvider = ({
  value,
  children,
}: {
  value: ChatRenderTokens;
  children: ReactNode;
}): ReactElement => (
  <ChatRenderContext.Provider value={value}>{children}</ChatRenderContext.Provider>
);

/** Row consumer — tokens resolved once at the list. */
export const useChatRenderTokens = (): ChatRenderTokens => useContext(ChatRenderContext);
