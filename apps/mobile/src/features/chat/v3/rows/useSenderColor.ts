import { useChatRenderTokens } from '../theme/ChatRenderProvider';

export const useSenderColor = (colorIndex: number): string => {
  const { usernamePalette } = useChatRenderTokens();
  return usernamePalette[colorIndex] ?? usernamePalette[0] ?? '';
};
