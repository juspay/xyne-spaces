import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { FloatingSelfView } from './FloatingSelfView';
import { useGridLayout } from './useGridLayout';
import { usePagination } from './usePagination';
import { sortParticipants } from './sortParticipants';
import { PaginationIndicator } from './PaginationIndicator';
import { PaginationControls } from './PaginationControls';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import { filterAgentTiles } from '../../../utils/livekitAgent';
import { SpotlightView } from '../SpotlightView';
import { RingingParticipantTile } from '../RingingParticipantTile/RingingParticipantTile';
import type { RingingInvitee } from '../ringStatus.utils';

interface ParticipantGridProps {
  participants: ParticipantInfo[];
  className?: string | undefined;
  compact?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  raisedHands?: string[];
  onToggleHandRaise?: (() => void) | undefined;
  /** Invitees who haven't joined yet — rendered as faded tiles after the real ones */
  ringingInvitees?: RingingInvitee[] | undefined;
}

export function ParticipantGrid({
  participants,
  className,
  compact = false,
  aiController,
  requestedAiController,
  raisedHands = [],
  onToggleHandRaise,
  ringingInvitees = [],
}: ParticipantGridProps): React.ReactElement {
  // Derive AI enablement from aiController presence — same pattern as Lotus ParticipantsGrid
  const isAIAssistantEnabled = !!aiController;
  // Max 4 tiles (2x2) for compact view, 16 tiles (4x4) for full view
  const maxTiles = compact ? 4 : 16;
  // Grid gap in px, matched to the container's Tailwind gap classes below
  // (compact: gap-1.5 = 6px, full: gap-2..gap-3 responsive, 12px used as the
  // solver's target since it only needs to be a close approximation).
  const gridGap = compact ? 6 : 12;

  // The agent tile is hidden until someone invokes it via the AI button, and always
  // while the host kill-switch has transcription off.
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );
  const visibleParticipants = useMemo(
    () => filterAgentTiles(participants, isTranscriptionEnabled && isAIAssistantEnabled),
    [participants, isTranscriptionEnabled, isAIAssistantEnabled],
  );

  // One-on-one call (full view): like Meet, the other person fills the stage and
  // your own camera floats as a small picture-in-picture in the corner, instead
  // of splitting the screen into two equal halves.
  // A still-ringing invitee occupies the stage exactly as a joined one does.
  const stageOccupantCount = visibleParticipants.length + ringingInvitees.length;
  const floatingSelf = useMemo(() => {
    if (compact || stageOccupantCount !== 2) return null;
    return visibleParticipants.find(p => p.isLocal) ?? null;
  }, [compact, stageOccupantCount, visibleParticipants]);
  const gridParticipants = useMemo(
    () =>
      floatingSelf ? visibleParticipants.filter(p => p !== floatingSelf) : visibleParticipants,
    [floatingSelf, visibleParticipants],
  );

  // Compute layout first using raw participant count — layout.maxTiles is the true
  // per-page capacity determined by container size, not just the cap.
  // Ringing tiles share the grid but never push a real participant onto another page:
  // they only take cells left over on a single page.
  const { containerRef, layout } = useGridLayout(
    Math.min(gridParticipants.length + ringingInvitees.length, maxTiles),
    maxTiles,
    gridGap,
  );

  // Pagination is active when participants spill onto a second page.
  // This is the canonical signal that sorting matters (so users can find
  // the most-engaged participants on page 0).
  const isPaginating = gridParticipants.length > layout.maxTiles;
  const displayParticipants = useMemo(() => {
    if (!isPaginating) return gridParticipants;
    return sortParticipants(gridParticipants, isAIAssistantEnabled);
  }, [gridParticipants, isPaginating, isAIAssistantEnabled]);

  const pagination = usePagination(layout.maxTiles, displayParticipants);
  const visibleRingingInvitees = isPaginating
    ? []
    : ringingInvitees.slice(0, Math.max(0, layout.maxTiles - gridParticipants.length));

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
          className={cn('grid flex-1 w-full min-h-0', compact ? 'gap-1.5' : 'gap-2 sm:gap-3')}
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridAutoRows: 'minmax(0, 1fr)',
          }}
        >
          {pagination.tracks.map(participant => (
            <ParticipantTile
              key={participant.identity}
              participant={participant}
              avatarSize={compact ? 'small' : 'large'}
              compact={compact}
              aiController={aiController ?? null}
              requestedAiController={requestedAiController ?? false}
              isHandRaised={raisedHands.includes(participant.identity)}
              onToggleHandRaise={onToggleHandRaise}
              onExpand={() => setSpotlightIdentity(participant.identity)}
            />
          ))}
          {visibleRingingInvitees.map(invitee => (
            <RingingParticipantTile
              key={`ringing-${invitee.userId}`}
              userId={invitee.userId}
              ringStatus={invitee.ringStatus}
              avatarSize={compact ? 'medium' : 'large'}
              compact={compact}
            />
          ))}
        </div>
      )}

      {floatingSelf && !spotlightParticipant && (
        <FloatingSelfView
          key={floatingSelf.identity}
          participant={floatingSelf}
          containerRef={containerRef}
          aiController={aiController ?? null}
          requestedAiController={requestedAiController ?? false}
          isHandRaised={raisedHands.includes(floatingSelf.identity)}
          onToggleHandRaise={onToggleHandRaise}
          onPin={() => setSpotlightIdentity(floatingSelf.identity)}
        />
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
