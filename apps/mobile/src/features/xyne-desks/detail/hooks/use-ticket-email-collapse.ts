import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TicketDetailEmailSnapshot } from '../types';

export type EmailCollapseState = {
  sortedEmails: TicketDetailEmailSnapshot[];
  collapsedIds: ReadonlySet<string>;
  lastEmailId: string | undefined;
  firstEmailId: string | undefined;
  toggleOne: (id: string) => void;
  expandOne: (id: string) => void;
  isCollapsed: (id: string) => boolean;
  canCollapse: (id: string) => boolean;
};

function buildDefaultCollapsedIds(sorted: readonly TicketDetailEmailSnapshot[]): Set<string> {
  if (sorted.length <= 2) return new Set();
  const firstId = sorted[0]?.id;
  const lastId = sorted[sorted.length - 1]?.id;
  return new Set(
    sorted.filter(email => email.id !== firstId && email.id !== lastId).map(email => email.id),
  );
}

/**
 * Default: first and last emails start expanded; middle ones start collapsed.
 * Every email can be toggled by the user.
 */
export function useTicketEmailCollapse(
  emails: readonly TicketDetailEmailSnapshot[],
): EmailCollapseState {
  const sortedEmails = useMemo(
    () => [...emails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [emails],
  );

  const firstEmailId = sortedEmails[0]?.id;
  const lastEmailId = sortedEmails[sortedEmails.length - 1]?.id;
  const prevLastEmailIdRef = useRef<string | undefined>(lastEmailId);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    buildDefaultCollapsedIds(sortedEmails),
  );

  const emailIdsKey = useMemo(() => sortedEmails.map(e => e.id).join('|'), [sortedEmails]);
  const prevIdsRef = useRef<Set<string>>(new Set(sortedEmails.map(e => e.id)));

  useEffect(() => {
    setCollapsedIds(prev => {
      const currentIds = new Set(sortedEmails.map(e => e.id));
      const previousIds = prevIdsRef.current;
      const next = new Set(prev);

      for (const id of Array.from(next)) {
        if (!currentIds.has(id)) next.delete(id);
      }

      // Newly inserted emails that aren't first/last start collapsed.
      for (const email of sortedEmails) {
        if (!previousIds.has(email.id) && email.id !== firstEmailId && email.id !== lastEmailId) {
          next.add(email.id);
        }
      }

      // New latest message arrives → expand it (don't re-force after user collapses).
      if (lastEmailId && lastEmailId !== prevLastEmailIdRef.current) {
        next.delete(lastEmailId);
      }

      prevLastEmailIdRef.current = lastEmailId;
      prevIdsRef.current = currentIds;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by emailIdsKey
  }, [emailIdsKey, firstEmailId, lastEmailId]);

  const toggleOne = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandOne = useCallback((id: string) => {
    setCollapsedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isCollapsed = useCallback((id: string) => collapsedIds.has(id), [collapsedIds]);
  const canCollapse = useCallback(() => true, []);

  return {
    sortedEmails,
    collapsedIds,
    firstEmailId,
    lastEmailId,
    toggleOne,
    expandOne,
    isCollapsed,
    canCollapse,
  };
}
