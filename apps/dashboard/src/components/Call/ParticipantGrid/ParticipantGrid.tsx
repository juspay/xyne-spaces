import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { useGridLayout } from './useGridLayout';
import { usePagination } from './usePagination';
import { sortParticipants } from './sortParticipants';
import { PaginationIndicator } from './PaginationIndicator';
import { PaginationControls } from './PaginationControls';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import { isTranscriptionAgentIdentity } from '../../../utils/livekitAgent';
import { SpotlightView } from '../SpotlightView';

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
  // Grid gap in px, matched to the container's Tailwind gap classes below
  // (compact: gap-1.5 = 6px, full: gap-2..gap-4 responsive, 16px used as the
  // solver's target since it only needs to be a close approximation).
  const gridGap = compact ? 6 : 16;

  // Host kill-switch: when transcription is off the agent stays in the room but
  // its tile is hidden (mirrors the participants-sidebar filter) so the call looks
  // agent-free while capture is paused.
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );
  const visibleParticipants = useMemo(
    () =>
      isTranscriptionEnabled
        ? participants
        : participants.filter(p => !isTranscriptionAgentIdentity(p.identity)),
    [participants, isTranscriptionEnabled],
  );

  // Compute layout first using raw participant count — layout.maxTiles is the true
  // per-page capacity determined by container size, not just the cap.
  const { containerRef, layout } = useGridLayout(visibleParticipants.length, maxTiles, gridGap);

  // Pagination is active when participants spill onto a second page.
  // This is the canonical signal that sorting matters (so users can find
  // the most-engaged participants on page 0).
  const isPaginating = visibleParticipants.length > layout.maxTiles;
  const displayParticipants = useMemo(() => {
    if (!isPaginating) return visibleParticipants;
    return sortParticipants(visibleParticipants, isAIAssistantEnabled);
  }, [visibleParticipants, isPaginating, isAIAssistantEnabled]);

  const pagination = usePagination(layout.maxTiles, displayParticipants);

  // Two-stage expand, matching how the screen-share view already behaves:
  // clicking a tile's expand button "spotlights" it (big main tile + scrollable
  // sidebar of everyone else) via the shared `SpotlightView` component — the
  // same one `ScreenShareView` uses. From there, a separate expand button
  // (owned by `SpotlightView`) opens the true hide-everything fullscreen.
  const [spotlightIdentity, setSpotlightIdentity] = useState<string | null>(null);
  const spotlightParticipant = useMemo(
    () => visibleParticipants.find(p => p.identity === spotlightIdentity) ?? null,
    [visibleParticipants, spotlightIdentity],
  );
  // Auto-exit spotlight if that participant leaves the call.
  useEffect(() => {
    if (spotlightIdentity && !spotlightParticipant) {
      setSpotlightIdentity(null);
    }
  }, [spotlightIdentity, spotlightParticipant]);

  // Note: `layout.tileWidth`/`tileHeight` (used to pick the best columns/rows
  // count for the participant count) are deliberately NOT used for the actual
  // CSS cell size here. Using them as literal px box sizes centers a strictly
  // 16:9-locked grid, which leaves large empty top/bottom (or left/right) gaps
  // whenever the container's aspect ratio doesn't match 16:9 — that's the
  // "why is there so much padding" regression. Cells instead stretch to fill
  // the container fully via `1fr` (matches the previous, correct behavior);
  // `ParticipantTile`'s camera video uses `object-cover` so it still fills
  // each (possibly non-16:9) cell without letterboxing.
  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full relative overflow-hidden flex flex-col',
        compact ? 'p-1' : 'p-2 sm:p-4',
        className,
      )}
    >
      {spotlightParticipant ? (
        <SpotlightView
          participants={visibleParticipants}
          mainIdentity={spotlightParticipant.identity}
          mainMode='camera'
          onSelect={identity => setSpotlightIdentity(identity)}
          onExit={() => setSpotlightIdentity(null)}
          allowFullScreen
          className='flex-1 min-h-0'
          aiController={aiController ?? null}
          requestedAiController={requestedAiController ?? false}
          raisedHands={raisedHands}
          onToggleHandRaise={onToggleHandRaise}
        />
      ) : (
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
              onExpand={() => setSpotlightIdentity(participant.identity)}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {!spotlightParticipant && displayParticipants.length > layout.maxTiles && (
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
