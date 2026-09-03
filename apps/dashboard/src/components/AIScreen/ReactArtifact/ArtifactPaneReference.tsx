/**
 * What an artifact card becomes while App Creation mode has the app open in the
 * pane: a marker of the build this turn produced, a way to jump the pane back to
 * it, and the place you roll the app back to it.
 *
 * The transcript must still say truthfully that a build happened here — that is
 * why the version is stated plainly rather than hinted at — but mounting a
 * second Sandpack for an app already on screen would double every iframe, data
 * bridge and agent stream, and make writes ambiguous about which copy sent them.
 *
 * ONE surface, not three. A bordered card holding a tiled icon and an outlined
 * button was three nested rectangles competing with the app they point at; a
 * borderless row with no fill blended into the answer text above it and stopped
 * reading as an object at all. What works is a single soft fill with no border
 * and no inner tile — clearly a thing, obviously not the app itself.
 *
 * The row IS the click target for viewing, so "View" needs no control of its
 * own, and Restore is the only button because it is the only verb that changes
 * anything.
 *
 * Restore stays a real sibling button rather than living inside the row's button
 * — nesting would be invalid markup, and would put a durable, server-side verb
 * under a stray click meant to preview.
 */

import type { ReactElement } from 'react';
import { DiamondComponent, RotateLeft } from '@xyne/icons';
import type { ReactArtifactRef } from './ReactArtifact.types';
import { useAppCreationModeSignal } from './appCreationModeContext';

export const ArtifactPaneReference = ({
  artifact,
}: {
  artifact: ReactArtifactRef;
}): ReactElement => {
  const { viewingVersionId, headVersionId, viewVersion, restoreVersion, restoring } =
    useAppCreationModeSignal();
  const version = artifact.manifest.versionNumber;
  const isViewing = Boolean(artifact.versionId) && artifact.versionId === viewingVersionId;
  const isCurrent = Boolean(artifact.versionId) && artifact.versionId === headVersionId;
  // Only an older build can be restored. Head knows what it is, so this needs no
  // confirmation step: restoring is a pointer move and every version stays in
  // the list, including the one you are leaving.
  const canRestore = Boolean(artifact.versionId) && Boolean(headVersionId) && !isCurrent;

  return (
    <div
      // Filled, not outlined: the fill is what separates it from the answer
      // text without adding another edge to a column that already has plenty.
      // Vertical spacing comes from the parent's `gap-2` — no margin of its own.
      className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors ${
        isViewing ? 'bg-primary/[0.07]' : 'bg-muted/50 hover:bg-muted'
      }`}
    >
      <button
        type='button'
        onClick={() => viewVersion(artifact.versionId ?? null)}
        disabled={!artifact.versionId}
        aria-current={isViewing ? 'true' : undefined}
        className='flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:pointer-events-none'
        title={isViewing ? 'This version is open in the pane' : 'Show this version in the pane'}
        data-track-category='AskAI'
        data-track-name='ArtifactPaneReferenceSelect'
      >
        <DiamondComponent
          size={17}
          className={`shrink-0 ${isViewing ? 'text-primary' : 'text-muted-foreground'}`}
          aria-hidden='true'
        />
        <span className='truncate text-sm font-medium text-foreground'>
          {artifact.manifest.title}
        </span>
        <span className='shrink-0 text-[13px] text-muted-foreground'>
          {version !== undefined ? `Version ${version}` : 'App'}
        </span>
        {isCurrent && (
          <span className='shrink-0 text-[13px] text-muted-foreground/70'>· Current</span>
        )}
        {isViewing && <span className='shrink-0 text-[13px] text-primary/80'>· Showing</span>}
      </button>

      {canRestore && (
        <button
          type='button'
          onClick={() => restoreVersion(artifact.versionId as string)}
          disabled={restoring}
          // Always rendered, never hidden behind hover: surfacing restore in the
          // transcript is the whole point — it was already buried in the pane's
          // version menu. Quiet until pointed at, not absent.
          className='flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
          title={
            version !== undefined
              ? `Make version ${version} current — the agent's next update builds on it`
              : 'Make this version current'
          }
          data-track-category='AskAI'
          data-track-name='ArtifactPaneReferenceRestore'
        >
          <RotateLeft size={14} aria-hidden='true' />
          Restore
        </button>
      )}
    </div>
  );
};
