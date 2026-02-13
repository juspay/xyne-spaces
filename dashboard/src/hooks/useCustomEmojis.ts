import { useQuery } from '@tanstack/react-query';
import { emojiService } from '../services/Emoji/emojiService';
import { API_BASE_URL } from '../config';

export interface EmojiPickerEmoji {
  id: string;
  names: string[];
  imgUrl: string;
}

export const useCustomEmojis = () => {
  return useQuery<EmojiPickerEmoji[]>({
    queryKey: ['custom-emojis'],
    queryFn: async () => {
      const response = await emojiService.getAllCustomEmojis();
      return response.emojis
        .filter(emoji => emoji?.id)
        .map(emoji => ({
          id: emoji.id,
          names: [emoji.name],
          imgUrl: `${API_BASE_URL}/emojis/${emoji.id}/stream`,
        }));
    },
    staleTime: 10 * 60 * 1000,
  });
};
