import { useCallback, useState } from 'react';

import { getBoolean, setBoolean } from '@/src/services/localStorage';

const INTRO_SEEN_KEY = 'lotus.morning-brief.intro-seen';

/**
 * Device-local "seen the intro banner" flag — the web keeps this in
 * localStorage; here it lives in MMKV (synchronous, safe at first render).
 */
export function useBriefIntroSeen(): { introSeen: boolean; markIntroSeen: () => void } {
  const [introSeen, setIntroSeen] = useState<boolean>(() => getBoolean(INTRO_SEEN_KEY) ?? false);

  const markIntroSeen = useCallback(() => {
    setBoolean(INTRO_SEEN_KEY, true);
    setIntroSeen(true);
  }, []);

  return { introSeen, markIntroSeen };
}
