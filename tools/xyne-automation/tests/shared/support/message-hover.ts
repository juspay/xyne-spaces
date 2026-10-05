/**
 * Browser-side payload for `Locator.evaluate(...)`. Dispatches real pointer
 * events on a message row so the dashboard's shared MessageHoverToolbar
 * (a delegated listener on the chat-message-list container with a
 * `pointer` modality guard) resolves the row and renders its action buttons.
 *
 * Function body runs in the page context; DOM globals exist at runtime even
 * though the project tsconfig excludes the `dom` lib — hence the inline typing
 * on `el` instead of `HTMLElement`.
 */
export type HoverTarget = {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  getAttribute(name: string): string | null;
  dispatchEvent(event: unknown): boolean;
};

export function dispatchHoverEvents(el: HoverTarget): unknown {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
  const g = globalThis as unknown as {
    PointerEvent: new (t: string, i: unknown) => unknown;
    MouseEvent: new (t: string, i: unknown) => unknown;
  };
  el.dispatchEvent(new g.PointerEvent('pointermove', { ...base, pointerType: 'mouse' }));
  el.dispatchEvent(new g.PointerEvent('pointerover', { ...base, pointerType: 'mouse' }));
  el.dispatchEvent(new g.MouseEvent('mousemove', base));
  el.dispatchEvent(new g.MouseEvent('mouseover', base));
  return {
    testid: el.getAttribute('data-testid'),
    messageId: el.getAttribute('data-message-id'),
    hoverKey: el.getAttribute('data-hover-key'),
    rect: { x: r.left, y: r.top, w: r.width, h: r.height },
  };
}
