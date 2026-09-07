import { useBlockNoteEditor } from '@blocknote/react';
import { posToDOMRect } from '@tiptap/core';
import { editorView } from '../canvasEditorView';
import { type FC, type ReactElement, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearPastedLink,
  type PastedLink,
  type PastedLinkHost,
  subscribeToPastedLink,
} from '../canvasPastedLink';
import { CanvasLinkToolbar } from './CanvasLinkToolbar';

/**
 * Offers the link menu where a link was just pasted.
 *
 * BlockNote's own toolbar only opens once the caret is inside a link, and the
 * caret a paste leaves behind sits just after it, so the menu would never appear
 * without a hover. This renders the same menu at the pasted link, through the
 * portal BlockNote's own popovers use: the toolbar's styling is scoped to the
 * editor container, so anywhere else it renders unstyled.
 */
export const CanvasPastedLinkToolbar: FC = (): ReactElement | null => {
  const editor = useBlockNoteEditor();
  const host = editor?._tiptapEditor as PastedLinkHost | undefined;
  const [link, setLink] = useState<PastedLink | null>(null);

  useEffect(() => (host ? subscribeToPastedLink(host, setLink) : undefined), [host]);

  useEffect(() => {
    if (!link || !host || !editorView(host)) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clearPastedLink(host);
    };
    // Hovering a link opens BlockNote's toolbar for it, which is this same menu;
    // standing down leaves one on screen rather than two.
    const onMouseOver = (event: MouseEvent): void => {
      if (event.target instanceof HTMLElement && event.target.closest('a')) {
        clearPastedLink(host);
      }
    };
    const dom = editorView(host)?.dom;
    if (!dom) return undefined;
    window.addEventListener('keydown', onKeyDown);
    dom.addEventListener('mouseover', onMouseOver);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      dom.removeEventListener('mouseover', onMouseOver);
    };
  }, [link, host]);

  const view = editorView(host);
  if (!link || !host || !view) return null;

  const portal = editor?.portalElement ?? document.body;
  const rect = posToDOMRect(view, link.from, link.to);
  return createPortal(
    <div
      className='canvas-pasted-link-toolbar'
      style={{ top: `${rect.bottom + 6}px`, left: `${rect.left}px` }}
    >
      <CanvasLinkToolbar
        url={link.url}
        text={view.state.doc.textBetween(link.from, link.to)}
        range={{ from: link.from, to: link.to }}
        setToolbarOpen={(open: boolean): void => {
          if (!open) clearPastedLink(host);
        }}
      />
    </div>,
    portal,
  );
};
