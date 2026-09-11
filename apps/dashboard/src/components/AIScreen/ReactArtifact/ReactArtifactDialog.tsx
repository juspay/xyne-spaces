import type { ReactElement } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ReactArtifactView } from './ReactArtifactView';
import type { ReactArtifactRef } from './ReactArtifact.types';

/**
 * Full-screen surface for an artifact, matching how FileViewerModal presents a
 * file: a centred 95vw/95vh dialog rather than a docked side panel, so the app
 * gets the whole viewport instead of a column.
 *
 * The view is rendered with `fill`, which makes the Sandpack frame take all the
 * remaining height under the header.
 */
export function ReactArtifactDialog({
  artifact,
  onClose,
}: {
  artifact: ReactArtifactRef | null;
  onClose: () => void;
}): ReactElement | null {
  if (!artifact) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-[56] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0' />
        <Dialog.Content
          className='fixed left-1/2 top-1/2 z-[56] flex h-[95vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card focus:outline-none data-[state=open]:fade-in data-[state=closed]:fade-out'
          aria-describedby={undefined}
        >
          {/* Radix requires a title for accessibility; the visible one lives in
              the view's own header, so this is screen-reader only. */}
          <Dialog.Title className='sr-only'>{artifact.manifest.title}</Dialog.Title>
          <ReactArtifactView artifact={artifact} fill onClose={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
