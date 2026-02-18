import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { useGridLayout } from './useGridLayout';
import { usePagination } from './usePagination';
import { PaginationIndicator } from './PaginationIndicator';
import { PaginationControls } from './PaginationControls';
import type { ParticipantInfo } from '../../../machines/roomMachine';

interface ParticipantGridProps {
  participants: ParticipantInfo[];
  className?: string | undefined;
  compact?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
}

export function ParticipantGrid({
  participants,
  className,
  compact = false,
  aiController,
  requestedAiController,
}: ParticipantGridProps): React.ReactElement {
  // Max 4 tiles (2x2) for compact view, 16 tiles (4x4) for full view
  const maxTiles = compact ? 4 : 16;
  const { containerRef, layout } = useGridLayout(participants.length, maxTiles);
  const pagination = usePagination(layout.maxTiles, participants);

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full relative overflow-hidden flex flex-col',
        compact ? 'p-1' : 'p-2 sm:p-4',
        className,
      )}
    >
      <div
        className={cn('grid flex-1 w-full min-h-0', compact ? 'gap-1.5' : 'gap-2 sm:gap-4')}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {pagination.tracks.map(participant => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            avatarSize={compact ? 'medium' : 'large'}
            compact={compact}
            aiController={aiController ?? null}
            requestedAiController={requestedAiController ?? false}
          />
        ))}
      </div>

      {/* Pagination Controls */}
      {participants.length > layout.maxTiles && (
        <>
          <PaginationIndicator
            currentPage={pagination.currentPage}
            totalPageCount={pagination.totalPageCount}
            vertical={true}
          />
          <PaginationControls
            currentPage={pagination.currentPage}
            totalPageCount={pagination.totalPageCount}
            onNextPage={pagination.nextPage}
            onPrevPage={pagination.prevPage}
            compact={compact}
            vertical={true}
          />
        </>
      )}
    </div>
  );
}
