import { MESSAGE_BAR_ACTION_IDS, type MessageBarActionId } from '../constants/messageBar';

export type BarDragIntent =
  | { kind: 'none' }
  | { kind: 'bar'; index: number }
  | { kind: 'hide'; via: 'button' | 'panel' }
  | { kind: 'full' };

export interface ValueStore<T> {
  get: () => T | null;
  set: (value: T | null) => void;
  subscribe: (listener: () => void) => () => void;
}

const ACTION_IDS = new Set<string>(MESSAGE_BAR_ACTION_IDS);

export const isMessageBarActionId = (id: string): id is MessageBarActionId => ACTION_IDS.has(id);

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

export const socketOf = (element: HTMLElement): HTMLElement | null =>
  element.querySelector<HTMLElement>(':scope > [data-bar-socket]');

export const contentOf = (element: HTMLElement): HTMLElement[] =>
  Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.hasAttribute('data-bar-socket'),
  );

export const setTranslateX = (element: HTMLElement | null, x: number): void => {
  if (element) element.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
};

export const sameIntent = (a: BarDragIntent, b: BarDragIntent): boolean => {
  if (a.kind === 'bar' && b.kind === 'bar') return a.index === b.index;
  if (a.kind === 'hide' && b.kind === 'hide') return a.via === b.via;
  return a.kind === b.kind;
};
