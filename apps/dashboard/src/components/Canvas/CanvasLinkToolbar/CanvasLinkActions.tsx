import { formatKeyboardShortcut } from '@blocknote/core';
import {
  EditLinkMenuItems,
  type LinkToolbarProps,
  useBlockNoteEditor,
  useComponentsContext,
} from '@blocknote/react';
import { ExternalLink, LayoutTemplate, Pencil, Unlink } from 'lucide-react';
import { type FC, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { editorView } from '../canvasEditorView';
import { findLinkRange, insertEmbedBlock, replaceLinkWithEmbed } from '../canvasEmbedActions';
import { CANVAS_LINK_ACTION_EVENT, LINK_SHORTCUTS, linkUnderMenu } from '../canvasLinkShortcuts';

/** Every button in the menu, in the order they are rendered. */
const ROW_SELECTOR = '.canvas-link-menu button';

const Row = ({
  icon,
  label,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  shortcut: string | null;
}): ReactElement => (
  <span className='canvas-link-menu-item'>
    {icon}
    {label}
    {shortcut !== null && (
      <kbd className='canvas-link-menu-key'>{formatKeyboardShortcut(shortcut)}</kbd>
    )}
  </span>
);

/**
 * The actions offered for a link, shared by the toolbar that opens on hover and
 * the one offered on paste so the two cannot drift apart.
 *
 * Each row carries its own shortcut, which works without the menu ever being
 * focused. Up and Down walk the rows and Enter picks one, the way the slash menu
 * behaves; Escape leaves the menu and gives the arrows back to the text. This
 * only renders while a menu is open, so its key handling is scoped to that.
 */
export const CanvasLinkActions: FC<LinkToolbarProps> = (props): ReactElement | null => {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const [activeRow, setActiveRow] = useState(-1);

  // The keys act on the link at the caret. Opened by hover the caret is usually
  // somewhere else entirely, so there is nothing for them to act on and showing
  // them would be a lie.
  const view = editorView(editor);
  const atCaret = view ? linkUnderMenu(view.state)?.url === props.url : false;
  const keyFor = (shortcut: string): string | null => (atCaret ? shortcut : null);

  useEffect(() => {
    const dom = editorView(editor)?.dom;
    if (!dom || !atCaret) return undefined;

    const rows = (): HTMLButtonElement[] =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));

    const onKeyDown = (event: KeyboardEvent): void => {
      const count = rows().length;
      if (!count) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveRow(current =>
          current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count,
        );
        return;
      }

      if (event.key === 'Enter' && activeRow >= 0) {
        event.preventDefault();
        event.stopPropagation();
        rows()[activeRow]?.click();
        return;
      }

      if (event.key === 'Escape') setActiveRow(-1);
    };

    const runRow = (event: Event): void => {
      const row = (event as CustomEvent<{ row: number }>).detail?.row;
      if (typeof row === 'number') rows()[row]?.click();
    };

    dom.addEventListener('keydown', onKeyDown, true);
    dom.addEventListener(CANVAS_LINK_ACTION_EVENT, runRow);
    return () => {
      dom.removeEventListener('keydown', onKeyDown, true);
      dom.removeEventListener(CANVAS_LINK_ACTION_EVENT, runRow);
    };
  }, [editor, activeRow, atCaret]);

  if (!Components) return null;

  const Button = Components.LinkToolbar.Button;
  const close = (): void => props.setToolbarOpen?.(false);
  const openState = {
    ...(props.setToolbarOpen ? { setToolbarOpen: props.setToolbarOpen } : {}),
    ...(props.setToolbarPositionFrozen
      ? { setToolbarPositionFrozen: props.setToolbarPositionFrozen }
      : {}),
  };

  const embedLink = (): void => {
    const view = editorView(editor);
    if (!view || !props.url) return;
    const { from, to } = props.range;
    const link = to > from ? { url: props.url, from, to } : findLinkRange(view, props.url);
    if (link) replaceLinkWithEmbed(view, link);
    else insertEmbedBlock(view, props.url);
    close();
  };

  return (
    <>
      <Components.Generic.Popover.Root
        {...(props.setToolbarPositionFrozen
          ? { onOpenChange: props.setToolbarPositionFrozen }
          : {})}
      >
        <Components.Generic.Popover.Trigger>
          <Button className='bn-button' isSelected={activeRow === 0}>
            <Row
              icon={<Pencil size={14} />}
              label='Edit link'
              shortcut={keyFor(LINK_SHORTCUTS.edit)}
            />
          </Button>
        </Components.Generic.Popover.Trigger>
        <Components.Generic.Popover.Content
          className='bn-popover-content bn-form-popover'
          variant='form-popover'
        >
          <EditLinkMenuItems url={props.url} text={props.text} range={props.range} {...openState} />
        </Components.Generic.Popover.Content>
      </Components.Generic.Popover.Root>

      <Button
        className='bn-button'
        isSelected={activeRow === 1}
        onClick={(): void => {
          window.open(props.url, '_blank', 'noopener,noreferrer');
          close();
        }}
      >
        <Row
          icon={<ExternalLink size={14} />}
          label='Open in new tab'
          shortcut={keyFor(LINK_SHORTCUTS.open)}
        />
      </Button>

      <Button className='bn-button' isSelected={activeRow === 2} onClick={embedLink}>
        <Row
          icon={<LayoutTemplate size={14} />}
          label='Embed'
          shortcut={keyFor(LINK_SHORTCUTS.embed)}
        />
      </Button>

      <Button
        className='bn-button'
        isSelected={activeRow === 3}
        onClick={(): void => {
          editor?.deleteLink(props.range.from);
          close();
        }}
      >
        <Row
          icon={<Unlink size={14} />}
          label='Remove link'
          shortcut={keyFor(LINK_SHORTCUTS.remove)}
        />
      </Button>
    </>
  );
};
