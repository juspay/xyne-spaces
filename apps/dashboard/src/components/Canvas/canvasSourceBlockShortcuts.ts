import { Extension } from '@tiptap/core';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** Blocks whose content is source text behind a rendered preview. */
const SOURCE_BLOCK_TYPES = new Set(['mathBlock', 'diagram']);

/**
 * Blocks the reader treats as one thing: the source blocks above, embeds, code
 * blocks — which includes the mermaid one, a code block showing a diagram — and
 * dividers.
 *
 * Wider than SOURCE_BLOCK_TYPES because being *selected* as a whole and being
 * *edited* as one are different questions. An embed holds no source to type
 * into and ProseMirror already steps over and deletes it correctly as an atom;
 * a code block is typed in constantly and must keep every key it has. Both need
 * the click and the outline, neither needs the keymap.
 *
 * A divider is here for the outline alone. BlockNote draws nothing at all for a
 * selected one, so there was no way to see what the next Backspace would take.
 * It still gets no actions — see CanvasObjectToolbar — since a line holds
 * nothing to quote or ask about.
 */
const OBJECT_BLOCK_TYPES = new Set([...SOURCE_BLOCK_TYPES, 'embed', 'codeBlock', 'divider']);

/** The rendered previews a click may land on, per block kind. */
const OBJECT_SELECTOR = '[data-canvas-math],[data-canvas-mermaid],[data-canvas-embed]';
const SOURCE_SELECTOR = '[data-canvas-math],[data-canvas-mermaid]';

type Dispatch = ((tr: Transaction) => void) | undefined;
type Direction = 'up' | 'down' | 'left' | 'right';
type Handler = (props: { editor: { state: EditorState; view: EditorView } }) => boolean;

/** Which way a direction travels through the document. */
const FORWARD: Record<Direction, boolean> = {
  down: true,
  right: true,
  up: false,
  left: false,
};

interface SourceBlock {
  pos: number;
  node: ProseMirrorNode;
}

/**
 * Whether a block is one of the objects the arrows, Backspace and the letter
 * shortcuts act on as a single thing.
 *
 * A code block joins them only while it is showing a preview instead of its
 * source — which is what a mermaid code block is: a diagram whose source
 * happens to be kept in a code block. A code block anyone types in never shows
 * a preview, so every key it has stays its own; and a mermaid one with its
 * source open is being edited, exactly as a diagram is while its source is up.
 */
function isSourceBlock(node: ProseMirrorNode, pos: number, view: EditorView): boolean {
  if (SOURCE_BLOCK_TYPES.has(node.type.name)) return true;
  return node.type.name === 'codeBlock' && isPreviewing(view, pos);
}

/** The diagram, equation or previewing code block containing a position. */
function sourceBlockAround($pos: ResolvedPos, view: EditorView): SourceBlock | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const pos = $pos.before(depth);
    if (isSourceBlock(node, pos, view)) {
      return { pos, node };
    }
  }
  return null;
}

/** The object block containing a position, if any. */
function objectBlockAround($pos: ResolvedPos): SourceBlock | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (OBJECT_BLOCK_TYPES.has(node.type.name)) {
      return { pos: $pos.before(depth), node };
    }
  }
  return null;
}

/**
 * The object block a rendered element belongs to.
 *
 * An atom holds no positions inside itself, so a click on an embed resolves to
 * the position beside it rather than within — which is why this looks at the
 * node beside the resolved position as well as at the ancestors of it.
 */
function objectBlockAtDOM(view: EditorView, dom: Element): SourceBlock | null {
  const pos = view.posAtDOM(dom, 0);
  const inside = objectBlockAround(view.state.doc.resolve(pos));
  if (inside) return inside;

  for (const candidate of [pos, pos - 1]) {
    if (candidate < 0) continue;
    const node = view.state.doc.nodeAt(candidate);
    if (node && OBJECT_BLOCK_TYPES.has(node.type.name)) return { pos: candidate, node };
  }
  return null;
}

/**
 * The block whose source is being edited at a position.
 *
 * Wider than sourceBlockAround, which only counts a code block while it is
 * showing its preview — and a source being edited is by definition not. Without
 * this, Escape and Mod-a worked inside a diagram's source and did nothing
 * inside the identical source of a mermaid code block.
 */
function openSourceBlockAround($pos: ResolvedPos, view: EditorView): SourceBlock | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    const pos = $pos.before(depth);
    if (SOURCE_BLOCK_TYPES.has(node.type.name)) return { pos, node };
    const rendered = elementAt(view, pos);
    if (
      node.type.name === 'codeBlock' &&
      rendered?.matches('[data-canvas-mermaid],[data-canvas-math]')
    ) {
      return { pos, node };
    }
  }
  return null;
}

/** The code block containing a position — the mermaid one included. */
function codeBlockAround($pos: ResolvedPos): SourceBlock | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'codeBlock') return { pos: $pos.before(depth), node };
  }
  return null;
}

/** The selected node, when it is one of those objects. */
function selectedSourceBlock(state: EditorState, view: EditorView): SourceBlock | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  if (!isSourceBlock(selection.node, selection.from, view)) return null;
  return { pos: selection.from, node: selection.node };
}

/** The rendered element of the block at a position. */
function elementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  const el = dom instanceof HTMLElement ? dom : ((dom as ChildNode | null)?.parentElement ?? null);
  return el?.querySelector<HTMLElement>('[data-canvas-math],[data-canvas-mermaid]') ?? el;
}

/**
 * Whether the block is showing its preview rather than its source. The source
 * panel stays in the document while the preview is up — it is only clipped —
 * so its class is what says which of the two the reader is looking at.
 */
function isPreviewing(view: EditorView, pos: number): boolean {
  return Boolean(elementAt(view, pos)?.querySelector('.canvas-source-collapsed'));
}

/**
 * The document position the caret would leave the current selection from,
 * or null when the caret still has somewhere to go inside its own block.
 *
 * `endOfTextblock` is the editor's own answer to "is the caret against this
 * edge", including the wrapped-line case that no amount of position arithmetic
 * gets right — so a press only becomes navigation once the caret really is
 * leaving.
 */
function exitPosition(state: EditorState, view: EditorView, direction: Direction): number | null {
  const { selection } = state;
  const forward = FORWARD[direction];

  if (selection instanceof NodeSelection) {
    return forward ? selection.to : selection.from;
  }
  if (!selection.empty || !view.endOfTextblock(direction)) return null;

  const $from = selection.$from;
  if ($from.depth === 0) return null;
  return forward ? $from.after($from.depth) : $from.before($from.depth);
}

/** Inserts an empty line at a position and puts the caret in it. */
function insertLineAt(state: EditorState, dispatch: Dispatch, at: number): boolean {
  const container = state.doc.resolve(at).parent.type;
  const paragraph =
    container.contentMatch.defaultType?.createAndFill() ??
    state.schema.nodes['paragraph']?.createAndFill();
  if (!paragraph) return false;

  if (dispatch) {
    const tr = state.tr.insert(at, paragraph);
    tr.setSelection(Selection.near(tr.doc.resolve(at), 1)).scrollIntoView();
    dispatch(tr);
  }
  return true;
}

/**
 * Arrow keys treat a diagram or equation as one object.
 *
 * Their source is only clipped while the preview shows, so stepping into it
 * with a text cursor put the caret somewhere invisible. Moving onto one selects
 * the whole block instead; moving off a selected block continues to wherever
 * the editor would normally go. Anything that is not a move onto or off one of
 * these blocks is left alone, so ordinary caret motion is untouched.
 */
function moveByArrow(direction: Direction) {
  return (state: EditorState, dispatch: Dispatch, view: EditorView): boolean => {
    const from = exitPosition(state, view, direction);
    if (from === null) return false;

    const clamped = Math.max(0, Math.min(from, state.doc.content.size));
    const next = Selection.near(state.doc.resolve(clamped), FORWARD[direction] ? 1 : -1);

    // The block being left, so arrowing out of one never lands back on it.
    const leaving =
      selectedSourceBlock(state, view)?.pos ?? sourceBlockAround(state.selection.$from, view)?.pos;

    const target = sourceBlockAround(next.$from, view);
    if (target && target.pos !== leaving) {
      // Selecting is the whole action. A block left open closes itself once the
      // caret is no longer inside it; clicking its button from here re-rendered
      // React in the middle of the keypress and made the next arrow unreliable.
      dispatch?.(
        state.tr.setSelection(NodeSelection.create(state.doc, target.pos)).scrollIntoView(),
      );
      return true;
    }

    // A caret cannot leave a code block upwards on its own: the press does
    // nothing at all, while downwards it leaves normally. `endOfTextblock` has
    // already decided the caret is against the edge, so all that is left is to
    // put it where the move lands — and only when that is outside the block, so
    // a code block with nothing above it does not swallow its own caret.
    const inCode = codeBlockAround(state.selection.$from);
    if (inCode) {
      const outside = next.from < inCode.pos || next.from > inCode.pos + inCode.node.nodeSize;
      if (outside) {
        dispatch?.(state.tr.setSelection(next).scrollIntoView());
        return true;
      }
    }

    const selected = selectedSourceBlock(state, view);
    if (!selected) return false;

    // Nowhere to go means the object is the first or last thing in the
    // document, and there would be no way to write above or below it.
    const $selected = state.doc.resolve(selected.pos);
    const edge = FORWARD[direction]
      ? $selected.after($selected.depth)
      : $selected.before($selected.depth);
    const stuck = next.from >= selected.pos && next.to <= selected.pos + selected.node.nodeSize;
    if (stuck) {
      return insertLineAt(state, dispatch, edge);
    }

    // Leaving a selected block: place the caret where the move lands, since a
    // node selection has no caret for the editor to carry forward itself.
    dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };
}

/**
 * Shift+arrow extends across a whole diagram or equation in one press.
 *
 * Their source is clipped, so the default extension crawls through characters
 * nobody can see — one press per character, with nothing appearing to happen.
 * Taking the block whole matches how the plain arrows treat it as an object.
 *
 * Only the boundary is intercepted: inside a paragraph, or inside a source that
 * is open for editing, shift+arrow selects text exactly as it always did.
 */
function extendByArrow(direction: Direction) {
  return (state: EditorState, dispatch: Dispatch, view: EditorView): boolean => {
    const forward = FORWARD[direction];
    const { selection } = state;

    // The end that moves, and the end that stays put.
    const $head =
      selection instanceof NodeSelection
        ? state.doc.resolve(forward ? selection.to : selection.from)
        : selection.$head;
    const $anchor =
      selection instanceof NodeSelection
        ? state.doc.resolve(forward ? selection.from : selection.to)
        : selection.$anchor;

    // Inside a textblock the caret still has room, so leave it alone.
    if (!(selection instanceof NodeSelection) && !view.endOfTextblock(direction)) {
      return false;
    }
    if ($head.depth === 0) return false;

    const edge = forward ? $head.after($head.depth) : $head.before($head.depth);
    const clamped = Math.max(0, Math.min(edge, state.doc.content.size));
    const next = Selection.near(state.doc.resolve(clamped), forward ? 1 : -1);

    const target = sourceBlockAround(next.$from, view);
    if (!target) return false;

    // Past the block's *container*, not its content node. The content sits one
    // position inside its wrapper, so stopping at the content's edge left the
    // range one short of covering the block — and the outline, which asks
    // whether the block is fully inside the selection, stayed off.
    const $target = state.doc.resolve(target.pos);
    const beyond = forward ? $target.after($target.depth) : $target.before($target.depth);
    dispatch?.(
      state.tr
        .setSelection(TextSelection.between($anchor, state.doc.resolve(beyond)))
        .scrollIntoView(),
    );
    return true;
  };
}

/**
 * Backspace inside a diagram or equation.
 *
 * BlockNote's default turns a non-paragraph block into a paragraph at its start
 * and merges it upward, so an equation became its own raw LaTeX as plain text
 * and further presses ate the block above. And while the preview is showing the
 * source is only clipped, so Backspace silently chewed through characters the
 * reader could not see. While the preview is up the block is one object and one
 * press removes it; with the source open it edits normally.
 */
function backspace(state: EditorState, dispatch: Dispatch, view: EditorView): boolean {
  const selected = selectedSourceBlock(state, view);
  if (selected) {
    dispatch?.(
      state.tr.delete(selected.pos, selected.pos + selected.node.nodeSize).scrollIntoView(),
    );
    return true;
  }

  if (!state.selection.empty) return false;

  const $from = state.selection.$from;
  const block = sourceBlockAround($from, view);
  if (!block) return false;

  if (isPreviewing(view, block.pos) || block.node.textContent.length === 0) {
    dispatch?.(state.tr.delete(block.pos, block.pos + block.node.nodeSize).scrollIntoView());
    return true;
  }

  // Only the start boundary would convert the block; elsewhere delete normally.
  return $from.parentOffset === 0;
}

/**
 * Delete inside a diagram or equation.
 *
 * The mirror of backspace rather than the same handler: bound to it, Delete
 * swallowed the key at the start of an open source — where backspace has a
 * block conversion to prevent and Delete has nothing to prevent — and left the
 * end alone, where BlockNote's default pulls the next block's text into the
 * source. Only the boundary it can damage is claimed.
 */
function forwardDelete(state: EditorState, dispatch: Dispatch, view: EditorView): boolean {
  const selected = selectedSourceBlock(state, view);
  if (selected) {
    dispatch?.(
      state.tr.delete(selected.pos, selected.pos + selected.node.nodeSize).scrollIntoView(),
    );
    return true;
  }

  if (!state.selection.empty) return false;

  const $from = state.selection.$from;
  const block = sourceBlockAround($from, view);
  if (!block) return false;

  if (isPreviewing(view, block.pos) || block.node.textContent.length === 0) {
    dispatch?.(state.tr.delete(block.pos, block.pos + block.node.nodeSize).scrollIntoView());
    return true;
  }

  // Only the end boundary would pull the block below into this source;
  // elsewhere the character to the right is deleted normally.
  return $from.parentOffset === $from.parent.content.size;
}

/**
 * Outlines every diagram or equation the selection covers.
 *
 * Keyed off what the selection *overlaps* rather than off one selection type:
 * a node selection, a shift-extended range and select-all all have to light the
 * same blocks. Keying it to NodeSelection alone was why a range covering a
 * diagram showed nothing.
 *
 * It is a decoration rather than ProseMirror's own `ProseMirror-selectednode`
 * class because that class is applied by the node view's selectNode(), which
 * only runs when the selection changes — so an edit elsewhere in the document
 * rebuilt the node view and silently dropped the outline while the block was
 * still selected. Decorations are recomputed from state on every update.
 */
const selectionDecoration = new Plugin({
  key: new PluginKey('canvasSourceBlockSelection'),
  props: {
    decorations(state: EditorState): DecorationSet | null {
      const { from, to } = state.selection;
      if (from === to) return null;

      const decorations: Decoration[] = [];
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!OBJECT_BLOCK_TYPES.has(node.type.name)) return true;
        const end = pos + node.nodeSize;
        // Measured against the block's *content* span, not its node boundaries.
        // A text selection cannot sit outside a textblock: its ends normalise to
        // the nearest text position, which is inside the last block it reaches —
        // so asking for the node to be covered could never be true for the block
        // at the end of a range, and that block alone stayed unlit.
        //
        // A selection that stops short of both edges is someone editing the
        // source, which must not outline the object around their cursor.
        if (from <= pos + 1 && to >= end - 1) {
          decorations.push(Decoration.node(pos, end, { class: 'canvas-object-selected' }));
        }
        return false;
      });

      return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
    },

    /**
     * Clicking a diagram or equation selects it, the way clicking an image
     * does. That is what puts the block toolbar and its comment action on
     * screen — those follow the selection, so a block that cannot be selected
     * by clicking cannot be commented on either.
     *
     * On mousedown rather than ProseMirror's handleClickOn: the preview is a
     * contenteditable=false subtree, and a click landing on (say) an SVG path
     * inside a rendered diagram gives ProseMirror no document position to
     * resolve, so handleClickOn never fires there.
     */
    handleDOMEvents: {
      mousedown(view: EditorView, event: MouseEvent): boolean {
        if (event.button !== 0) return false;

        const target = event.target;
        const el = target instanceof Element ? target : null;
        // The block's own controls, and its open source, keep their clicks.
        if (!el || el.closest('button')) return false;

        const block = el.closest(OBJECT_SELECTOR);
        if (!block) return false;
        // A source block only takes the click while its preview is up; with the
        // source open the caret belongs in it.
        if (block.matches(SOURCE_SELECTOR) && !block.querySelector('.canvas-source-collapsed')) {
          return false;
        }

        const around = objectBlockAtDOM(view, block);
        if (!around) return false;

        // Already selected means the reader is asking for the thing itself —
        // the link an embed shows, the frame it plays in — so the second click
        // is left to the block's own handlers.
        const { selection } = view.state;
        if (selection instanceof NodeSelection && selection.from === around.pos) return false;

        event.preventDefault();
        // Without this the card underneath opens the link on the same click:
        // React listens at the root of the app, above the editor, so its
        // handler would still run after this one.
        event.stopPropagation();
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, around.pos)));
        // The preview is contenteditable=false, so without focus the editor
        // re-syncs its selection from the browser's a moment later and the node
        // selection silently becomes a caret inside the clipped source — where
        // the arrow keys then move between invisible lines.
        view.focus();
        return true;
      },
    },
  },
});

/**
 * A diagram or equation showing its preview must never hold a bare text cursor.
 *
 * Its source is only clipped, so a caret can be left sitting in it invisibly —
 * deleting the line below one lands there, for instance. Nothing appears
 * selected, and the next Backspace looks like it deletes the block out of
 * nowhere. Turning that caret into a selection of the block makes what is about
 * to be acted on visible, and is what the reader means by "I'm on it".
 *
 * Only while the preview is up: with the source open the caret belongs there.
 */
const normaliseStrayCaret = new Plugin({
  key: new PluginKey('canvasSourceBlockCaret'),
  view() {
    return {
      update(view: EditorView) {
        const { state } = view;
        if (!state.selection.empty) return;

        const block = sourceBlockAround(state.selection.$from, view);
        if (!block || !isPreviewing(view, block.pos)) return;

        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, block.pos)));
      },
    };
  },
});

export const canvasSourceBlockShortcutsExtension = Extension.create({
  name: 'canvasSourceBlockShortcuts',
  // Above the defaults: with a block selected, `p` and `c` are claimed by the
  // editor's own typing behaviour unless these run first.
  priority: 1000,
  addProseMirrorPlugins() {
    return [selectionDecoration, normaliseStrayCaret];
  },
  addKeyboardShortcuts() {
    const run =
      (command: (state: EditorState, dispatch: Dispatch, view: EditorView) => boolean): Handler =>
      ({ editor }) =>
        command(editor.state, editor.view.dispatch.bind(editor.view), editor.view);

    return {
      Backspace: run(backspace),
      Delete: run(forwardDelete),
      ArrowDown: run(moveByArrow('down')),
      ArrowUp: run(moveByArrow('up')),
      ArrowRight: run(moveByArrow('right')),
      ArrowLeft: run(moveByArrow('left')),

      'Shift-ArrowDown': run(extendByArrow('down')),
      'Shift-ArrowUp': run(extendByArrow('up')),
      'Shift-ArrowRight': run(extendByArrow('right')),
      'Shift-ArrowLeft': run(extendByArrow('left')),

      // Enter leaves the object and starts a new line after it, as in any
      // document editor. Editing is the pencil on the block itself; binding
      // Enter to it would cost the key its normal meaning.
      Enter: ({ editor }) => {
        const { state } = editor;
        if (!selectedSourceBlock(state, editor.view)) return false;

        // After the block's *container*, not after its content node: the
        // content sits inside a wrapper, so inserting at the end of the content
        // put the new line inside the block instead of between it and the next.
        const $from = state.selection.$from;
        return insertLineAt(
          state,
          editor.view.dispatch.bind(editor.view),
          $from.after($from.depth),
        );
      },

      // The two keys the package's own preview extension would have given these
      // blocks. That extension is deliberately not enabled — with hasPreview set
      // it also installs a capture-phase handler that swallows every printable
      // character for a block whose popup is closed, and these blocks edit in
      // place rather than through that popup, so their source would take no
      // typing at all. Its Escape and Mod-a are gated on that same popup, so
      // they are bound here instead.
      Escape: ({ editor }) => {
        const block = openSourceBlockAround(editor.state.selection.$from, editor.view);
        if (!block || isPreviewing(editor.view, block.pos)) return false;
        editor.view.dispatch(
          editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)),
        );
        return true;
      },

      // Select this block's source, not the whole document.
      'Mod-a': ({ editor }) => {
        const { state } = editor;
        const block = openSourceBlockAround(state.selection.$from, editor.view);
        if (!block || isPreviewing(editor.view, block.pos)) return false;
        const $from = state.selection.$from;
        editor.view.dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())),
        );
        return true;
      },

      // Diagrams open their enlarged preview. Through the toolbar's own button
      // rather than the drawing: in a canvas a click on the diagram selects the
      // block instead of enlarging it, so the drawing has no handler to fire.
      p: ({ editor }) => {
        const selected = selectedSourceBlock(editor.state, editor.view);
        if (!selected) return false;
        const block = elementAt(editor.view, selected.pos);
        const open =
          block?.querySelector<HTMLElement>('[data-track-name="OPEN_PREVIEW"]') ??
          block?.querySelector<HTMLElement>('.mermaid-diagram');
        open?.click();
        return true;
      },

      c: ({ editor }) => {
        const selected = selectedSourceBlock(editor.state, editor.view);
        if (!selected) return false;
        void navigator.clipboard?.writeText(selected.node.textContent);
        return true;
      },
    };
  },
});
