import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { getMarkRange } from '@tiptap/core';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import Button from '../Button';
import { LinkDialog, useLinkDialog } from './LinkDialog';
import { usePlatform } from '../../../hooks/usePlatform';
import { useOverlayZIndex } from '../../../contexts/OverlayZIndexContext';
import { openLink } from '../../../utils/openLink';
import type { VirtualElement } from '../Selectors/Selectors.utils';
import type { LinkPopoverProps } from './EditorToolbar.types';

interface ActiveLink {
  from: number;
  to: number;
  href: string;
  text: string;
  anchor: VirtualElement;
}

export const LinkPopover: React.FC<LinkPopoverProps> = ({ editor }) => {
  const { isMobile } = usePlatform();
  const zIndexClass = useOverlayZIndex() ?? 'z-50';
  const [activeLink, setActiveLink] = useState<ActiveLink | null>(null);
  const linkDialog = useLinkDialog(editor);
  const { openDialog, removeLink } = linkDialog;

  useEffect(() => {
    if (!editor || isMobile) return;

    const handleClick = (event: MouseEvent): void => {
      if (event.button !== 0 || !editor.isInitialized || !(event.target instanceof Node)) return;
      if (!editor.view.dom.contains(event.target)) return;
      const linkType = editor.schema.marks['link'];
      if (!linkType) return;

      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!coords) return;
      const { doc } = editor.state;
      const range = getMarkRange(doc.resolve(coords.pos), linkType);
      if (!range) return;
      const mark = doc.nodeAt(range.from)?.marks.find(m => m.type === linkType);
      const href: unknown = mark?.attrs['href'];
      if (typeof href !== 'string') return;

      editor.commands.setTextSelection(range);
      setActiveLink({
        from: range.from,
        to: range.to,
        href,
        text: doc.textBetween(range.from, range.to),
        anchor: {
          getBoundingClientRect: (): ReturnType<VirtualElement['getBoundingClientRect']> => {
            const start = editor.view.coordsAtPos(range.from);
            const end = editor.view.coordsAtPos(range.to);
            const left = Math.min(start.left, end.left);
            const top = Math.min(start.top, end.top);
            const right = Math.max(start.right, end.right);
            const bottom = Math.max(start.bottom, end.bottom);
            return {
              x: left,
              y: top,
              left,
              top,
              right,
              bottom,
              width: right - left,
              height: bottom - top,
              toJSON: () => ({}),
            };
          },
        },
      });
    };

    document.addEventListener('click', handleClick);
    return (): void => document.removeEventListener('click', handleClick);
  }, [editor, isMobile]);

  useEffect(() => {
    if (!editor || !activeLink) return;
    const close = (): void => setActiveLink(null);
    const handleSelection = (): void => {
      const { from, to } = editor.state.selection;
      if (from < activeLink.from || to > activeLink.to) close();
    };
    editor.on('update', close);
    editor.on('selectionUpdate', handleSelection);
    return (): void => {
      editor.off('update', close);
      editor.off('selectionUpdate', handleSelection);
    };
  }, [editor, activeLink]);

  if (isMobile) return null;

  return (
    <>
      {activeLink && (
        <Popover.Root
          modal={false}
          open
          onOpenChange={open => {
            if (!open) setActiveLink(null);
          }}
        >
          <Popover.Anchor virtualRef={{ current: activeLink.anchor }} />
          <Popover.Portal>
            <Popover.Content
              side='top'
              align='start'
              sideOffset={8}
              avoidCollisions
              collisionPadding={10}
              onOpenAutoFocus={e => e.preventDefault()}
              onCloseAutoFocus={e => e.preventDefault()}
              className={`w-[min(400px,calc(100vw-24px))] rounded-lg border border-border bg-popover p-3 shadow-lg ${zIndexClass}`}
              data-testid='composer-link-popover'
            >
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-semibold text-foreground'>
                    {activeLink.text}
                  </div>
                  <a
                    href={activeLink.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={e => {
                      e.preventDefault();
                      openLink(activeLink.href, e);
                    }}
                    data-track-category='EDITOR_TOOLBAR'
                    data-track-name='OPEN_LINK_POPOVER'
                    className='mt-1 block break-all text-sm text-link-color hover:underline'
                  >
                    {activeLink.href}
                  </a>
                </div>
                <button
                  type='button'
                  onClick={() => setActiveLink(null)}
                  aria-label='Close'
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='CLOSE_LINK_POPOVER'
                  className='p-1 rounded text-muted-foreground hover:bg-accent'
                >
                  <MultipleCrossCancelDefault className='h-4 w-4' />
                </button>
              </div>
              <div className='mt-3 flex justify-end gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    setActiveLink(null);
                    openDialog();
                  }}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='EDIT_LINK_POPOVER'
                >
                  Edit
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => {
                    setActiveLink(null);
                    removeLink();
                  }}
                  data-track-category='EDITOR_TOOLBAR'
                  data-track-name='REMOVE_LINK_POPOVER'
                >
                  Remove
                </Button>
              </div>
              <Popover.Arrow className='fill-popover' width={12} height={6} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <LinkDialog {...linkDialog} />
    </>
  );
};
