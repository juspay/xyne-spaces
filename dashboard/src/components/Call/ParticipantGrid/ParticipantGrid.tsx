import { useMemo } from 'react';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { useGridLayout } from './useGridLayout';
import { usePagination } from './usePagination';
import { sortParticipants } from './sortParticipants';
import { PaginationIndicator } from './PaginationIndicator';
import { PaginationControls } from './PaginationControls';
import type { ParticipantInfo } from '../../../machines/roomMachine';

interface ParticipantGridProps {
  participants: ParticipantInfo[];
  className?: string | undefined;
  compact?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  raisedHands?: string[];
  onToggleHandRaise?: (() => void) | undefined;
}

export function ParticipantGrid({
  participants,
  className,
  compact = false,
  aiController,
  requestedAiController,
  raisedHands = [],
  onToggleHandRaise,
}: ParticipantGridProps): React.ReactElement {
  // Derive AI enablement from aiController presence — same pattern as Lotus ParticipantsGrid
  const isAIAssistantEnabled = aiController !== null;
  // Max 4 tiles (2x2) for compact view, 16 tiles (4x4) for full view
  const maxTiles = compact ? 4 : 16;

  // Compute layout first using raw participant count — layout.maxTiles is the true
  // per-page capacity determined by container size, not just the cap.
  const { containerRef, layout } = useGridLayout(participants.length, maxTiles);

  // Pagination is active when participants spill onto a second page.
  // This is the canonical signal that sorting matters (so users can find
  // the most-engaged participants on page 0).
  const isPaginating = participants.length > layout.maxTiles;
  const displayParticipants = useMemo(() => {
    if (!isPaginating) return participants;
    return sortParticipants(participants, isAIAssistantEnabled);
  }, [participants, isPaginating, isAIAssistantEnabled]);

  const pagination = usePagination(layout.maxTiles, displayParticipants);

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
            isHandRaised={raisedHands.includes(participant.identity)}
            onToggleHandRaise={onToggleHandRaise}
          />
        ))}
      </div>

      {/* Pagination Controls */}
      {displayParticipants.length > layout.maxTiles && (
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
