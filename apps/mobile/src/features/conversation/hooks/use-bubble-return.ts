import { useEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import { setBubblesReturning } from '../model/bubble-return-store';

/**
 * For the thread card: when it was opened from a bubble, the bubbles reappear
 * as soon as it starts to leave (a swap for another screen does not count).
 */
export function useBubbleReturn(): void {
  const navigation = useNavigation();
  const { bubble } = useLocalSearchParams<{ bubble?: string }>();
  const fromBubble = bubble === '1';

  useEffect(() => {
    if (!fromBubble) return undefined;
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (event.data.action.type !== 'REPLACE') setBubblesReturning(true);
    });
    return (): void => {
      unsubscribe();
      setBubblesReturning(false);
    };
  }, [fromBubble, navigation]);
}
