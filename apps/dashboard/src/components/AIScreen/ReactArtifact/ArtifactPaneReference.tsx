/**
 * What an artifact card becomes while App Creation mode has the app open in the
 * pane: a marker of the build this turn produced, and a way to jump the pane
 * back to it.
 *
 * The transcript must still say truthfully that a build happened here — that is
 * why the version is stated plainly rather than hinted at — but mounting a
 * second Sandpack for an app already on screen would double every iframe, data
 * bridge and agent stream, and make writes ambiguous about which copy sent them.
 *
 * It is deliberately card-weight, not a footnote: scrolling a long thread is how
 * you navigate an app's history, so each turn's version has to be legible in
 * passing and clickable without hunting for a target.
 */

import type { ReactElement } from 'react';
import { Check } from 'lucide-react';
import { DiamondComponent } from '@xyne/icons';
import type { ReactArtifactRef } from './ReactArtifact.types';
import { useAppCreationModeSignal } from './appCreationModeContext';

export const ArtifactPaneReference = ({
  artifact,
}: {
  artifact: ReactArtifactRef;
}): ReactElement => {
  const { viewingVersionId, viewVersion } = useAppCreationModeSignal();
  const version = artifact.manifest.versionNumber;
  const isViewing = Boolean(artifact.versionId) && artifact.versionId === viewingVersionId;

  return (
    <button
      type='button'
      onClick={() => viewVersion(artifact.versionId ?? null)}
      disabled={!artifact.versionId}
      aria-current={isViewing ? 'true' : undefined}
      className={`mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none ${
        isViewing
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-card hover:border-primary/30 hover:bg-accent/50'
      }`}
      title={isViewing ? 'This version is open in the pane' : 'Show this version in the pane'}
      data-track-category='AskAI'
      data-track-name='ArtifactPaneReferenceSelect'
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isViewing ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <DiamondComponent size={16} aria-hidden='true' />
      </span>

      <span className='flex min-w-0 flex-col'>
        <span className='truncate text-sm font-medium text-foreground'>
          {artifact.manifest.title}
        </span>
        <span className='text-xs text-muted-foreground'>
          {version !== undefined ? `Version ${version}` : 'App'}
        </span>
      </span>

      <span
        className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
          isViewing ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
        }`}
      >
        {isViewing ? (
          <>
            <Check className='h-3 w-3' aria-hidden='true' />
            Showing
          </>
        ) : (
          'View'
        )}
      </span>
    </button>
  );
};
