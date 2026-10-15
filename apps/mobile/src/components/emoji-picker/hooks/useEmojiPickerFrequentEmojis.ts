import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FREQUENT_EMOJI_MAX_ITEMS, FREQUENT_EMOJI_STORAGE_KEY } from '../emoji-picker.constants';

type UseEmojiPickerFrequentEmojisResult = {
  frequentEmojis: string[];
  recordFrequentEmoji: (emoji: string) => void;
};

export function useEmojiPickerFrequentEmojis(): UseEmojiPickerFrequentEmojisResult {
  const [frequentEmojiCounts, setFrequentEmojiCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    const loadFrequentEmojis = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(FREQUENT_EMOJI_STORAGE_KEY);
        if (!active || !raw) return;
        const parsed = JSON.parse(raw);
        if (!active || typeof parsed !== 'object' || parsed === null) return;
        const normalized = Object.entries(parsed).reduce<Record<string, number>>((acc, [k, v]) => {
          if (typeof k !== 'string' || typeof v !== 'number' || Number.isNaN(v) || v <= 0)
            return acc;
          acc[k] = v;
          return acc;
        }, {});
        setFrequentEmojiCounts(normalized);
      } catch {
        if (active) {
          setFrequentEmojiCounts({});
        }
      }
    };
    void loadFrequentEmojis();
    return (): void => {
      active = false;
    };
  }, []);

  const frequentEmojis = useMemo(() => {
    return Object.entries(frequentEmojiCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, FREQUENT_EMOJI_MAX_ITEMS)
      .map(([emoji]) => emoji);
  }, [frequentEmojiCounts]);

  const recordFrequentEmoji = useCallback((emoji: string): void => {
    setFrequentEmojiCounts(prev => {
      const next = { ...prev, [emoji]: (prev[emoji] ?? 0) + 1 };
      void AsyncStorage.setItem(FREQUENT_EMOJI_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { frequentEmojis, recordFrequentEmoji };
}
