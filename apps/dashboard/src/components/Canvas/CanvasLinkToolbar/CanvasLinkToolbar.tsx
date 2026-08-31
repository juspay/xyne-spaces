import { type LinkToolbarProps, useComponentsContext } from '@blocknote/react';
import type { FC, ReactElement } from 'react';
import { CanvasLinkActions } from './CanvasLinkActions';

/** The link menu shown when the reader returns to a link. */
export const CanvasLinkToolbar: FC<LinkToolbarProps> = (props): ReactElement | null => {
  const Components = useComponentsContext();
  if (!Components) return null;

  return (
    <Components.LinkToolbar.Root className='bn-toolbar bn-link-toolbar canvas-link-menu'>
      <CanvasLinkActions {...props} />
    </Components.LinkToolbar.Root>
  );
};
