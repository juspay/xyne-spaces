import { useMemo } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

// A dev ticket can be picked up by a release (and a later hotfix), so it may map
// to several application-release-ticket rows. This resolves that reverse lookup
// once — shared by the thread panel (which only needs the gate) and the Release
// tab (which needs the ids) so the two can't derive it differently.
export function useReleaseForDevTicket(ticketId: string) {
  const [artRows] = useCachedQuery(queries.applicationReleaseTicketsByDevTicketId({ ticketId }), {
    enabled: !!ticketId,
  });
  // Distinct releases, most recent first (query is ordered createdAt desc).
  const releaseIds = useMemo(() => [...new Set((artRows ?? []).map(r => r.releaseId))], [artRows]);
  const isHotfix = useMemo(() => (artRows ?? []).some(r => r.isHotfix), [artRows]);

  return {
    artRows: artRows ?? [],
    releaseIds,
    primaryReleaseId: releaseIds[0] ?? '',
    isHotfix,
    isReleaseDevTicket: (artRows?.length ?? 0) > 0,
  };
}
