/**
 * The transcript's record that the app was rolled back here.
 *
 * A restore moves a pointer and nothing else, so without this line a thread
 * reads as a straight march forward — five generations, newest on top — while
 * the pane shows the second one, and nothing on the page explains the gap. The
 * line sits at the point in time the rollback happened, which is the only place
 * it makes the thread make sense.
 *
 * A log entry, not a control: it states what happened and does nothing when
 * clicked. Every version in this thread already has a card that selects it, so
 * making the event selectable too would add a second, weaker route to the same
 * place and invite it to be read as an action rather than a fact.
 */

import type { ReactElement } from 'react';
import { RotateLeft } from '@xyne/icons';
import type { ArtifactAppRestoreEvent } from '../../../services/claw/artifactAppsService';

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const ArtifactRestoreNotice = ({
  event,
}: {
  event: ArtifactAppRestoreEvent;
}): ReactElement => {
  const when = formatWhen(event.createdAt);

  return (
    <div className='my-3 flex items-center gap-3'>
      <span className='h-px flex-1 bg-border/60' aria-hidden='true' />
      <span className='flex shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground'>
        <RotateLeft size={13} aria-hidden='true' />
        <span>
          Restored to <span className='font-medium'>Version {event.versionNumber}</span>
          {event.fromVersionNumber !== null && <> from Version {event.fromVersionNumber}</>}
        </span>
        {when && <span className='opacity-70'>· {when}</span>}
      </span>
      <span className='h-px flex-1 bg-border/60' aria-hidden='true' />
    </div>
  );
};
