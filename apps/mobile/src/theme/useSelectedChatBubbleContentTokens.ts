import { useMemo } from 'react';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useSetting } from '@/src/machines/settingsMachine';
import { DEFAULT_CHAT_BUBBLE_OPTION, type ChatBubbleColorVar } from '@/src/theme/chatBubbleTheme';
import {
  deriveChatBubbleContentTokens,
  type ChatBubbleContentTokens,
} from '@/src/theme/chatBubbleContentTokens';

type SelectedChatBubbleContentTokens = {
  selectedBubbleBg: string;
  tokens: ChatBubbleContentTokens;
};

const isResolvedColor = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(');

const fallbackBubbleColor = (theme: string): string =>
  theme === 'dark' ? DEFAULT_CHAT_BUBBLE_OPTION.darkColor : DEFAULT_CHAT_BUBBLE_OPTION.lightColor;

export const useSelectedChatBubbleContentTokens = (): SelectedChatBubbleContentTokens => {
  const { theme } = useUniwind();
  const selectedBubbleColorVar = useSetting('chatTheme.bubbleColorVar') as ChatBubbleColorVar;
  const currentUserBubbleBg = useCSSVariable(selectedBubbleColorVar) as string;

  return useMemo(() => {
    const selectedBubbleBg = isResolvedColor(currentUserBubbleBg)
      ? currentUserBubbleBg
      : fallbackBubbleColor(theme);

    return {
      selectedBubbleBg,
      tokens: deriveChatBubbleContentTokens(selectedBubbleBg, theme),
    };
  }, [currentUserBubbleBg, theme]);
};
