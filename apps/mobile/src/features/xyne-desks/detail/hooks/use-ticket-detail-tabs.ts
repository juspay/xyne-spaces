import { useCallback, useState } from 'react';

import type { TicketDetailTabId } from '../types';

export function useTicketDetailTabs(initial: TicketDetailTabId = 'email') {
  const [active, setActiveState] = useState<TicketDetailTabId>(initial);

  const setActive = useCallback((tab: TicketDetailTabId) => {
    setActiveState(tab);
  }, []);

  return { active, setActive };
}
