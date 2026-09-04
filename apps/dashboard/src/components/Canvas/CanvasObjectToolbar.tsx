import { NodeSelection, type Selection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useBlockNoteEditor, useEditorSelectionChange } from '@blocknote/react';
import { posToDOMRect } from '@tiptap/core';
import { type FC, type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CanvasToolbarAttachedActions } from './CanvasFormattingToolbar/CanvasFormattingToolbar';

/**
 * Whether BlockNote's own formatting toolbar will show for this selection.
 *
 * A copy of its rule (FormattingToolbar.ts), because the two toolbars carry the
 * same two actions and must never be on screen together. It hides for a whole
 * block with no text — an embed — and for anything touching a block whose
 * content is plain text rather than rich text: a code block, a diagram, an
 * equation. Those are exactly the blocks that could not be commented on or
 * asked about, which is what this toolbar is for.
 */
function blockNoteToolbarShows(selection: Selection, doc: ProseMirrorNode): boolean {
  if (selection.empty) return false;
  if (
    selection instanceof NodeSelection &&
    doc.textBetween(selection.from, selection.to).length === 0
  ) {
    return false;
  }

  let holdsPlainText = false;
  selection.content().content.descendants(node => {
    if (node.type.spec.content === 'text*') holdsPlainText = true;
    return !holdsPlainText;
  });
  return !holdsPlainText;
}

/**
 * Shut BlockNote's formatting toolbar. Its visibility is a store rather than a
 * render of the selection, so it can be left showing after the selection it was
 * opened for is gone. The same call is what the comment bridge uses.
 */
function closeFormattingToolbar(editor: { extensions: Map<string, unknown> } | null): void {
  const toolbar = editor?.extensions.get('formattingToolbar');
  const store = (toolbar as { store?: { setState?: (value: boolean) => void } } | undefined)?.store;
  store?.setState?.(false);
}

/**
 * What a selected block stands for: its own text, or what it points at.
 *
 * Empty when it stands for nothing — a divider is a line, with nothing in it to
 * quote, comment on or ask about, so it is given no actions at all.
 */
function nodeLabel(node: ProseMirrorNode): string {
  if (node.textContent.length > 0) return node.textContent;
  const url: unknown = node.attrs['url'];
  return typeof url === 'string' && url.length > 0 ? url : '';
}

/**
 * Comment and Ask AI for the blocks BlockNote's formatting toolbar leaves out.
 *
 * It deliberately hides for blocks whose content is plain — it treats them as
 * unformattable code — and for blocks with no text at all, so diagrams,
 * equations, code blocks and embeds could never be commented on or asked
 * about, the two actions that matter most on them. It also carries text
 * controls that mean nothing for a picture, which is why this is only the two
 * actions rather than the whole toolbar.
 */
export const CanvasObjectToolbar: FC<{
  onAddComment: () => void;
  canvasId?: string;
  canvasTitle?: string;
  canComment?: boolean;
}> = (props): ReactElement | null => {
  const editor = useBlockNoteEditor();
  const [selected, setSelected] = useState<{ from: number; to: number; text: string } | null>(null);
  // The rect is measured during render, so scrolling has to ask for one. A
  // counter rather than a clock: two scroll events in the same millisecond
  // would otherwise set identical state and skip the re-render.
  const [, setMeasured] = useState(0);
  const reposition = useCallback((): void => setMeasured(count => count + 1), []);
  // A drag is still choosing what to act on, so the toolbar would open under
  // the pointer and follow it across the text. BlockNote's own toolbar waits
  // for the release the same way.
  const choosing = useRef(false);

  const refresh = useCallback((): void => {
    const state = editor?._tiptapEditor?.view?.state;
    if (!state) {
      setSelected(null);
      return;
    }

    const { selection } = state;
    if (selection.empty || blockNoteToolbarShows(selection, state.doc)) {
      setSelected(null);
      return;
    }

    // The two toolbars carry the same actions, and BlockNote's own only
    // re-reads the selection on a pointer release — one swallowed by an
    // embedded player leaves it on screen beside this one. Closing it here
    // makes them exclusive whatever order the events arrive in.
    closeFormattingToolbar(editor);

    // A selected block is asked about whole, and an embed holds no text at all
    // so it goes as the link it shows. A range is left to the actions, which
    // read it back out of the document.
    if (selection instanceof NodeSelection) {
      const text = nodeLabel(selection.node);
      if (!text) {
        setSelected(null);
        return;
      }
      setSelected({ from: selection.from, to: selection.to, text });
      return;
    }

    setSelected({ from: selection.from, to: selection.to, text: '' });
  }, [editor]);

  useEditorSelectionChange(() => {
    // Only a *range* waits for the pointer: it is still growing under the
    // cursor. Selecting a whole block is finished the moment it happens — and
    // waiting for the release would lose it entirely, since a click that lands
    // on an embedded player hands the release to the frame, not to us.
    const isBlock = editor?._tiptapEditor?.view?.state.selection instanceof NodeSelection;
    if (choosing.current && !isBlock) {
      setSelected(null);
      return;
    }
    refresh();
  });

  useEffect(() => {
    const view = editor?._tiptapEditor?.view;
    if (!view) return;

    // Pointer down *in the document* starts a choice; the toolbar itself is
    // portalled outside it, so pressing one of its buttons never hides it
    // before the click lands.
    const start = (): void => {
      choosing.current = true;
      setSelected(null);
    };
    const finish = (): void => {
      choosing.current = false;
      refresh();
    };

    const root: Document | ShadowRoot = view.root;
    view.dom.addEventListener('pointerdown', start);
    root.addEventListener('pointerup', finish, true);
    // A button released over the browser's own chrome, or another window, never
    // reaches the release above — and without these the toolbar would stay
    // suppressed for every range selection from then on.
    root.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
    // The toolbar is positioned in viewport coordinates, so without this it
    // stayed where the block used to be and the reader scrolled away from it.
    // Capture, because what moves is the canvas's own scroller, not the window.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return (): void => {
      view.dom.removeEventListener('pointerdown', start);
      root.removeEventListener('pointerup', finish, true);
      root.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', finish);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [editor, refresh, reposition]);

  const view = editor?._tiptapEditor?.view;
  if (!selected || !view) return null;

  const rect = posToDOMRect(view, selected.from, selected.to);
  return createPortal(
    <div
      className='canvas-object-toolbar'
      style={{ top: `${rect.top - 8}px`, left: `${rect.left + rect.width / 2}px` }}
    >
      <CanvasToolbarAttachedActions
        onAddComment={props.onAddComment}
        {...(selected.text && { selectionText: selected.text })}
        {...(props.canvasId && { canvasId: props.canvasId })}
        {...(props.canvasTitle && { canvasTitle: props.canvasTitle })}
        {...(props.canComment !== undefined && { canComment: props.canComment })}
      />
    </div>,
    editor?.portalElement ?? document.body,
  );
};
