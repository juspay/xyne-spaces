import { ReactElement, useMemo, useState } from 'react';
import { ChannelCanvasList } from '../Canvas/ChannelCanvasList';
import type { Canvas, CanvasFolder } from '../Canvas/Canvas.types';
import {
  filterExcludedCallGeneratedCanvases,
  filterExcludedRecordingGeneratedCanvases,
} from '../Canvas/canvasFilters';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';

interface DeskCanvasListProps {
  channelId: string;
  onSelect: (canvasId: string) => void;
  selectedCanvasId?: string | undefined;
}

/**
 * Channel canvases inside Desk. Same queries and list component the chat canvas
 * tab uses; only the selection stays on the Desk route instead of navigating to
 * /chat. Mounted only while the canvases view is open, so the queries idle.
 */
export const DeskCanvasList = ({
  channelId,
  onSelect,
  selectedCanvasId,
}: DeskCanvasListProps): ReactElement => {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState<'all' | 'created_by_me' | 'shared'>('all');

  const [canvasList, canvasListDetails] = useCachedQuery(
    queries.hierarchyCanvases({ scope: 'channel', channelId, onlyArchived: false }),
  );
  const [zeroFolders] = useCachedQuery(queries.channelCanvasFolders({ channelId }));

  // Same exclusions as CanvasTab, so call/recording canvases stay out of Desk.
  const canvases = useMemo(
    () =>
      filterExcludedRecordingGeneratedCanvases(
        filterExcludedCallGeneratedCanvases((canvasList as Canvas[] | undefined) ?? [], true),
        true,
      ),
    [canvasList],
  );
  const folders = useMemo(() => (zeroFolders as CanvasFolder[] | undefined) ?? [], [zeroFolders]);

  return (
    <ChannelCanvasList
      canvases={canvases}
      folders={folders}
      loading={canvasListDetails.type !== 'complete' && canvases.length === 0}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
      onSelect={(_event, canvas) => onSelect(canvas.id)}
      currentUserId={user?.id}
      selectedCanvasId={selectedCanvasId}
    />
  );
};

export default DeskCanvasList;
