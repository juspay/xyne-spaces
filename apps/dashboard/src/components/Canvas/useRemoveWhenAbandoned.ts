import { useEffect, useRef, type RefObject } from 'react';

/**
 * Holds a callback so an effect can call the latest one without listing it as a
 * dependency. A block spec rebuilds its callbacks on every render, and an
 * effect keyed on their identity would tear down and re-add its document
 * listener for every keystroke anywhere in the canvas.
 */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * A block inserted from the slash menu and then abandoned should not be left
 * behind as an empty shell. Clicking away from one whose source is still empty
 * removes it, the way an untouched list item disappears.
 *
 * Guarded on emptiness so a block with content is never removed by a stray
 * click, and it listens on mousedown so the removal happens before the editor
 * moves the selection into whatever was clicked.
 */
export function useRemoveWhenAbandoned(
  root: RefObject<HTMLElement | null>,
  isEmpty: boolean,
  remove: () => void,
): void {
  const latestRemove = useLatest(remove);

  useEffect(() => {
    if (!isEmpty) return;

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && root.current?.contains(target)) return;
      latestRemove.current();
    };

    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [root, isEmpty, latestRemove]);
}

/**
 * Closes the source panel once the caret leaves the block, so a diagram or
 * equation goes back to being an object as soon as you move on. Without it a
 * block stayed open for the rest of the session unless its tick was clicked —
 * and an open block takes the caret instead of being selected, so it never
 * highlighted again.
 */
export function useCollapseWhenLeft(
  root: RefObject<HTMLElement | null>,
  editing: boolean,
  collapse: () => void,
): void {
  const latestCollapse = useLatest(collapse);

  useEffect(() => {
    if (!editing) return;

    const onSelectionChange = (): void => {
      const anchor = document.getSelection()?.anchorNode;
      // No selection at all means focus went somewhere that is not the editor;
      // leave the block open rather than closing it behind the reader's back.
      if (!anchor || root.current?.contains(anchor)) return;
      // A re-render (a diagram re-parsing as it is typed) briefly detaches the
      // node the selection points at. That is not the caret leaving.
      if (!anchor.isConnected) return;
      latestCollapse.current();
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [root, editing, latestCollapse]);
}
