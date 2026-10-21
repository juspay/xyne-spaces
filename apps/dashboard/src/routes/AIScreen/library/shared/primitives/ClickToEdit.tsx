import { useCallback, useRef, type ReactElement } from 'react';

/**
 * Editor twins of the read-mode boxes. The point of sharing them is that a
 * field must look identical focused and unfocused — same type, same padding,
 * same border — so clicking one never shifts the layout or reflows the text.
 * DESCRIPTION_EDITOR pairs with DetailCard, PROMPT_EDITOR with ProseBox.
 */
const EDITOR =
  'w-full rounded-2xl border-border p-4 text-sm leading-5 tracking-[-0.28px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring';

export const DESCRIPTION_EDITOR = `${EDITOR} border bg-card resize-none overflow-hidden`;

export const PROMPT_EDITOR = `${EDITOR} border-[0.8px] bg-muted/30 resize-y`;

export interface CaretHint {
  offset: number;
  scrollTop: number;
}

/** Collapse a textarea onto its content. Needs rows={1} — `height:auto` floors
 *  at the rows attribute, which defaults to 2. */
export function fitToContent(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
}

function caretNodeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  return null;
}

function scrollTopOf(node: Node, root: HTMLElement): number {
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el && root.contains(el)) {
    if (el.scrollHeight > el.clientHeight) return el.scrollTop;
    el = el.parentElement;
  }
  return 0;
}

/** Character offset under a click, so the caret lands where the user pointed
 *  instead of jumping to the end of the text. */
export function caretFromClick(root: HTMLElement, x: number, y: number): CaretHint | null {
  const hit = caretNodeFromPoint(x, y);
  if (!hit || !root.contains(hit.node)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let before = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === hit.node) {
      return { offset: before + hit.offset, scrollTop: scrollTopOf(hit.node, root) };
    }
    before += (walker.currentNode.textContent ?? '').length;
  }
  return null;
}

export function placeCaret(el: HTMLTextAreaElement, hint: CaretHint | null): void {
  if (!hint) return;
  el.focus();
  const at = Math.min(Math.max(hint.offset, 0), el.value.length);
  el.setSelectionRange(at, at);
  el.scrollTop = hint.scrollTop;
}

/**
 * Hands a click's caret to the field that was actually clicked.
 *
 * Entering edit mode mounts EVERY field at once, and a single shared ref is
 * claimed by whichever textarea mounts first — so clicking the system prompt
 * used to focus the description and clamp the caret to its end. Tagging the
 * pending caret with its field is what keeps them apart.
 */
export function useCaretHandoff(): {
  arm: (field: string, hint: CaretHint | null) => void;
  claim: (field: string, el: HTMLTextAreaElement) => void;
} {
  const pending = useRef<{ field: string; hint: CaretHint | null } | null>(null);

  const arm = useCallback((field: string, hint: CaretHint | null): void => {
    pending.current = { field, hint };
  }, []);

  const claim = useCallback((field: string, el: HTMLTextAreaElement): void => {
    if (pending.current?.field !== field) return;
    placeCaret(el, pending.current.hint);
    pending.current = null;
  }, []);

  return { arm, claim };
}

export function ClickToEdit({
  enabled,
  label,
  trackName,
  onEdit,
  children,
}: {
  enabled: boolean;
  label: string;
  trackName: string;
  onEdit: (caret: CaretHint | null) => void;
  children: ReactElement;
}): ReactElement {
  if (!enabled) return children;
  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={label}
      onClick={event => onEdit(caretFromClick(event.currentTarget, event.clientX, event.clientY))}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(null);
        }
      }}
      data-track-category='Claw Agents'
      data-track-name={trackName}
      className='w-full cursor-text rounded-2xl focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
    >
      {children}
    </div>
  );
}
