import { ReactElement, useMemo } from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import KanbanBoardScreen from '../KanbanBoardScreen/KanbanBoardScreen';
import { valuesToFilters } from '../../utils/savedViewSerialization';
import { useAuth } from '../../hooks/useAuth';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';

interface SeedConfig {
  name: string;
  filters: TicketFilters;
  groupBy?: string;
  columns?: string[];
}

// Decode the #cfg= share-link payload.
function decodeSharedConfig(hash: string): SeedConfig | null {
  const match = hash.match(/cfg=([^&]+)/);
  const encoded = match?.[1];
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(encoded))) as SeedConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.filters) return null;
    return parsed;
  } catch {
    return null;
  }
}

const ProjectViewBuilder = (): ReactElement => {
  const { viewId } = useParams<{ viewId?: string }>();
  const location = useLocation();
  const { user } = useAuth();

  const isExistingView = !!viewId && viewId !== 'new';

  const [configs] = useCachedQuery(queries.savedConfigsByUser({ userId: user?.id ?? '' }), {
    enabled: isExistingView && !!user?.id,
  });

  const sharedConfig = useMemo(
    () => (isExistingView ? null : decodeSharedConfig(location.hash)),
    [isExistingView, location.hash],
  );

  const ownView = useMemo(
    () => (isExistingView ? configs?.find(c => c.id === viewId) : undefined),
    [isExistingView, configs, viewId],
  );

  const seed = useMemo<SeedConfig | null>(() => {
    if (isExistingView) {
      if (!ownView) return null;
      const values = ownView.values ?? [];
      const groupBy = values.find(v => v.fieldName === '__groupBy')?.fieldValue;
      const columns = values
        .find(v => v.fieldName === '__columns')
        ?.fieldValue.split(',')
        .filter(Boolean);
      const filters = valuesToFilters(values);
      // Legacy per-board saved views store their board in contextId (no 'boards' value rows).
      if (!filters.boards?.length && ownView.contextId) {
        filters.boards = [ownView.contextId];
      }
      return {
        name: ownView.name,
        filters,
        ...(groupBy ? { groupBy } : {}),
        ...(columns ? { columns } : {}),
      };
    }
    return sharedConfig;
  }, [isExistingView, ownView, sharedConfig]);

  if (isExistingView && configs === undefined) {
    return (
      <div className='h-full flex items-center justify-center text-[13px] text-muted-foreground'>
        Loading view…
      </div>
    );
  }

  if (isExistingView && !ownView) {
    return (
      <div className='h-full flex flex-col items-center justify-center gap-2'>
        <p className='text-sm text-foreground'>This view doesn’t exist or isn’t available.</p>
        <Link to='/projects' className='text-[13px] text-primary hover:underline'>
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <KanbanBoardScreen
      key={viewId ?? 'new'}
      viewMode='workspace-view'
      {...(user?.workspaceId ? { workspaceId: user.workspaceId } : {})}
      {...(isExistingView && viewId ? { viewId } : {})}
      {...(sharedConfig ? { hasSharedSeed: true } : {})}
      {...(seed?.name ? { initialName: seed.name } : {})}
      {...(seed?.filters ? { initialFilters: seed.filters } : {})}
      {...(seed?.groupBy ? { initialGroupBy: seed.groupBy } : {})}
      {...(seed?.columns ? { initialColumns: seed.columns } : {})}
    />
  );
};

export default ProjectViewBuilder;
