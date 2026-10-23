import { DRAG_CURSOR_CSS } from '../constants/drag';

export type DragAxis = 'x' | 'y';

export interface ValueStore<T> {
  get: () => T | null;
  set: (value: T | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export const createValueStore = <T>(): ValueStore<T> => {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): T | null => value,
    set: (next): void => {
      value = next;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
};

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export const within = (rect: DOMRect, x: number, y: number, pad: number): boolean =>
  x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;

export const startOf = (rect: DOMRect, axis: DragAxis): number =>
  axis === 'x' ? rect.left : rect.top;

export const endOf = (rect: DOMRect, axis: DragAxis): number =>
  axis === 'x' ? rect.right : rect.bottom;

export const sizeOf = (rect: DOMRect, axis: DragAxis): number =>
  axis === 'x' ? rect.width : rect.height;

export const setTranslate = (element: HTMLElement | null, axis: DragAxis, offset: number): void => {
  if (!element) return;
  if (!offset) element.style.transform = '';
  else
    element.style.transform =
      axis === 'x' ? `translate3d(${offset}px, 0, 0)` : `translate3d(0, ${offset}px, 0)`;
};

export const socketOf = (element: HTMLElement, attr: string): HTMLElement | null =>
  element.querySelector<HTMLElement>(`:scope > [${attr}]`);

export const contentOf = (element: HTMLElement, attr: string): HTMLElement[] =>
  Array.from(element.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.hasAttribute(attr),
  );

export const cloneChildren = (host: Element | null): Node[] =>
  host ? Array.from(host.childNodes).map(node => node.cloneNode(true)) : [];

export const lockDragCursor = (): (() => void) => {
  const style = document.createElement('style');
  style.textContent = DRAG_CURSOR_CSS;
  document.head.appendChild(style);
  window.getSelection()?.removeAllRanges();
  return (): void => style.remove();
};

export const swallowNextClicks = (): (() => void) => {
  const swallow = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('click', swallow, { capture: true });
  return (): void => document.removeEventListener('click', swallow, { capture: true });
};

export const edgeScroll = (
  scroller: HTMLElement,
  axis: DragAxis,
  pointer: number,
  rect: DOMRect,
  zone: number,
  speed: number,
): void => {
  const step = (distance: number): number =>
    speed * Math.pow((zone - Math.max(distance, 0)) / zone, 2);
  const fromStart = pointer - startOf(rect, axis);
  const fromEnd = endOf(rect, axis) - pointer;
  const delta = fromStart < zone ? -step(fromStart) : fromEnd < zone ? step(fromEnd) : 0;
  if (!delta) return;
  if (axis === 'x') scroller.scrollLeft += delta;
  else scroller.scrollTop += delta;
};

export const scrollOf = (scroller: HTMLElement | null, axis: DragAxis): number =>
  scroller ? (axis === 'x' ? scroller.scrollLeft : scroller.scrollTop) : 0;
