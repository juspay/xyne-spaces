import { useValue } from '@legendapp/state/react';
import { type ReactElement } from 'react';

import { useDmListSwipeActions } from '@/src/hooks/useDmListSwipeActions';
import { ContextMenu, useContextMenuState } from '@/src/ui/context-menu';

import { StarIcon, STAR_COLOR } from '../icons';
import { MENU_ICON_SIZE } from '@/src/ui/context-menu/constants';
import { dmRow$ } from '../state/rows-store';

/**
 * What a long press on a conversation offers.
 *
 * Rendered by the row, inside its `ContextMenu.Root`. `ContextMenu.Content`
 * returns null when closed, but that does not stop the hooks of whatever
 * renders it, so this gate keeps the actions — and the drafts query
 * `useDmListSwipeActions` runs — unmounted until something is actually held.
 */
export function DmRowMenu({ id }: { id: string }): ReactElement | null {
  const { isOpen } = useContextMenuState('DmRowMenu');
  if (!isOpen) return null;
  return <DmRowMenuContent id={id} />;
}

/**
 * Reads the row live rather than taking the values as props: the label has
 * to say Unstar once Star has been tapped, and the row is the only thing
 * that knows.
 */
function DmRowMenuContent({ id }: { id: string }): ReactElement {
  const { toggleStar, markAsRead, archive } = useDmListSwipeActions();

  const title = useValue(() => dmRow$(id).title.get());
  const isStarred = useValue(() => dmRow$(id).isStarred.get()) === true;
  const hasUnread = (useValue(() => dmRow$(id).unreadCount.get()) ?? 0) > 0;

  return (
    <ContextMenu.Content label={title ?? ''}>
      <ContextMenu.Item
        label={isStarred ? 'Unstar' : 'Star'}
        icon={<StarIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={STAR_COLOR} />}
        onSelect={() => toggleStar(id)}
      />
      {hasUnread ? <ContextMenu.Item label='Mark as read' onSelect={() => markAsRead(id)} /> : null}
      <ContextMenu.Separator />
      <ContextMenu.Item label='Archive' destructive onSelect={() => archive(id)} />
    </ContextMenu.Content>
  );
}
