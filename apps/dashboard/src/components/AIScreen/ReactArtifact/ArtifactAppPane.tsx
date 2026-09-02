/**
 * The right-hand pane of App Creation mode: the thread's app, kept on screen
 * while you talk to the agent about it.
 *
 * There is ONE header row, not two. `ReactArtifactView` already renders a header
 * carrying the Preview/Code tabs and the saved state, so the pane hands it a
 * `titleSlot` — icon, app title, version dropdown — and a close handler instead
 * of stacking its own bar above it.
 *
 * The title here is the APP's, which can legitimately differ from
 * `payload.title`: an app keeps the title of its first build, while a later
 * generation may rename itself. Showing the app's own name keeps the pane
 * agreeing with the Library and the transcript cards.
 *
 * Mounted ONCE per app and kept. A new generation must change this pane's
 * `payload`, never its identity — re-creating it costs a full Sandpack iframe
 * boot and throws away whatever state the running app had. That is also why the
 * version dropdown swaps `versionId` on the same artifact ref.
 */

import type { ReactElement } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DiamondComponent, RotateLeft } from '@xyne/icons';
import { ReactArtifactView } from './ReactArtifactView';
import type { ReactArtifactRef } from './ReactArtifact.types';
import type { AppCreationMode } from './useAppCreationMode';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

interface ArtifactAppPaneProps {
  mode: AppCreationMode;
}

export const ArtifactAppPane = ({ mode }: ArtifactAppPaneProps): ReactElement | null => {
  const {
    appId,
    viewing,
    versions,
    headVersionId,
    title,
    viewVersion,
    restoreVersion,
    restoring,
    restoreError,
    exit,
  } = mode;

  if (!appId || !viewing) return null;

  const artifact: ReactArtifactRef = {
    attachmentId: '',
    manifest: viewing.manifest,
    savedAppId: appId,
    versionId: viewing.id,
  };

  const isHead = viewing.id === headVersionId;

  const titleSlot = (
    <div className='flex min-w-0 items-center gap-2'>
      <DiamondComponent size={16} className='shrink-0 text-muted-foreground' aria-hidden='true' />
      <span className='truncate text-sm font-medium text-foreground'>{title ?? 'App'}</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-accent ${
              isHead ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'
            }`}
            title={
              isHead
                ? 'Showing the current version'
                : 'Showing an earlier version — the app itself has not changed'
            }
            data-track-category='AskAI'
            data-track-name='ArtifactAppPaneVersionMenu'
          >
            v{viewing.versionNumber}
            <ChevronDown className='h-3 w-3' aria-hidden='true' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='max-h-80 overflow-y-auto'>
          {versions.map(v => (
            <DropdownMenuItem key={v.id} onSelect={() => viewVersion(v.id)}>
              <span className='flex w-full items-center gap-2'>
                <Check
                  className={`h-3.5 w-3.5 ${v.id === viewing.id ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden='true'
                />
                <span className='flex-1'>Version {v.versionNumber}</span>
                {v.id === headVersionId ? (
                  <span className='text-[11px] text-muted-foreground'>current</span>
                ) : (
                  // Restore MOVES HEAD on the server; selecting the row only
                  // previews. Two verbs, one row — hence the nested control and
                  // the stopPropagation, so restoring never reads as "view".
                  <button
                    type='button'
                    disabled={restoring}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      restoreVersion(v.id);
                    }}
                    className='flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
                    title={`Make version ${v.versionNumber} current — the agent's next update builds on it`}
                    data-track-category='AskAI'
                    data-track-name='ArtifactAppRestoreVersion'
                  >
                    <RotateLeft size={12} aria-hidden='true' />
                    Restore
                  </button>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {restoreError && (
        <p className='shrink-0 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive'>
          Could not restore that version. {restoreError}
        </p>
      )}
      <div className='min-h-0 flex-1'>
        <ReactArtifactView artifact={artifact} fill titleSlot={titleSlot} onClose={exit} />
      </div>
    </div>
  );
};
