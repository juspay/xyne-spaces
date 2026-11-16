import { useSyncExternalStore } from 'react';

// The pages a folder's browsing tabs show. A <webview> reloads when it moves in the
// DOM, so SdlcEmbeddedWebview holds them all in one place, over the holes the
// folder page leaves for them: a tab switched away keeps its page as it was.

export interface SdlcEmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a tab wants its page, as the folder page last said. */
export interface SdlcEmbedPlacement {
  key: string;
  /** Where it starts; afterwards it goes where its reader takes it. */
  url: string;
  rect: SdlcEmbedRect;
  /** On screen: the folder is showing its tab, with nothing of its own over it. */
  visible: boolean;
  /** Put aside: its tab isn't open. Hidden, muted, and in time let go. */
  parked: boolean;
}

/** Why a page didn't load: Chromium's own net error, and the address it was for. */
export interface SdlcEmbedLoadError {
  /** A net error code: -105 is a name that didn't resolve, -106 no connection. */
  code: number;
  description: string;
  url: string;
}

/** A held page as its tab's strip and bar show it. */
export interface SdlcEmbedPageState {
  key: string;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The last load's failure, until the next load starts. */
  error: SdlcEmbedLoadError | null;
  /** Find in the page, while it runs: which match is shown, of how many. */
  find: { active: number; matches: number } | null;
}

/** What a page can ask of the folder's chrome from the keyboard or its menu. */
export type SdlcEmbedCommand =
  | 'find'
  | 'newTab'
  | 'tabs'
  | 'focusAddress'
  | 'back'
  | 'forward'
  | 'save'
  | 'nextTab'
  | 'previousTab';

export type SdlcEmbedAction = 'back' | 'forward' | 'reload' | 'stop' | 'goto' | 'find' | 'stopFind';

export interface SdlcEmbedActionPayload {
  /** For 'goto'. */
  url?: string;
  /** For 'find'. */
  text?: string;
  forward?: boolean;
  findNext?: boolean;
}

let placements: readonly SdlcEmbedPlacement[] = [];
const placementListeners = new Set<() => void>();

function setPlacements(next: readonly SdlcEmbedPlacement[]): void {
  placements = next;
  placementListeners.forEach(listener => listener());
}

function subscribeToPlacements(listener: () => void): () => void {
  placementListeners.add(listener);
  return () => placementListeners.delete(listener);
}

/** Every page the folder wants held, for SdlcEmbeddedWebview. */
export function useEmbedPlacements(): readonly SdlcEmbedPlacement[] {
  return useSyncExternalStore(subscribeToPlacements, () => placements);
}

/** Lets pages go: the ones named, or every one when the folder page closes. */
export function dropEmbedPlacements(keys?: readonly string[]): void {
  setPlacements(keys ? placements.filter(page => !keys.includes(page.key)) : []);
  if (!keys) publishEmbeddedPages([]);
}

/** Lets the holder throw a tab's page away: the tab was closed, so it won't be back. */
export function discardEmbeddedPage(key: string): void {
  if (placements.some(page => page.key === key)) dropEmbedPlacements([key]);
}

function placePage(key: string, url: string, rect: SdlcEmbedRect, visible: boolean): void {
  const existing = placements.find(page => page.key === key);
  // A page goes where its reader takes it; the folder's url only starts it.
  setPlacements(
    existing
      ? placements.map(page =>
          page.key === key ? { ...page, rect, visible, parked: false } : page,
        )
      : [...placements, { key, url, rect, visible, parked: false }],
  );
}

function parkPage(key: string): void {
  if (!placements.some(page => page.key === key)) return;
  setPlacements(
    placements.map(page => (page.key === key ? { ...page, visible: false, parked: true } : page)),
  );
}

let pageStates: ReadonlyMap<string, SdlcEmbedPageState> = new Map();
const pageStateListeners = new Set<() => void>();

/** Said by the holder whenever a page loads, moves on, or is let go. */
export function publishEmbeddedPages(states: readonly SdlcEmbedPageState[]): void {
  pageStates = new Map(states.map(state => [state.key, state]));
  pageStateListeners.forEach(listener => listener());
}

function subscribeToPageStates(listener: () => void): () => void {
  pageStateListeners.add(listener);
  return () => pageStateListeners.delete(listener);
}

/** Every held page's state, by key: every tab's title, icon and loading, for the strip. */
export function useEmbeddedPages(): ReadonlyMap<string, SdlcEmbedPageState> {
  return useSyncExternalStore(subscribeToPageStates, () => pageStates);
}

type EmbedController = (
  key: string,
  action: SdlcEmbedAction,
  payload: SdlcEmbedActionPayload,
) => void;

let controller: EmbedController | null = null;

/** The holder drives its pages; the folder has the buttons. */
export function registerEmbedController(control: EmbedController): () => void {
  controller = control;
  return () => {
    if (controller === control) controller = null;
  };
}

export function controlEmbeddedPage(
  key: string,
  action: SdlcEmbedAction,
  payload: SdlcEmbedActionPayload = {},
): void {
  controller?.(key, action, payload);
}

const commandListeners = new Set<(key: string, command: SdlcEmbedCommand) => void>();

/** Said by the holder when a page asks for what the folder's chrome does. */
export function emitEmbeddedCommand(key: string, command: SdlcEmbedCommand): void {
  commandListeners.forEach(listener => listener(key, command));
}

/**
 * Hears a page asking for something the folder's chrome does — ⌘F, ⌘T, ⌘L
 * pressed while the page had the keyboard, "Save" from its menu.
 */
export function subscribeToEmbeddedCommand(
  onCommand: (key: string, command: SdlcEmbedCommand) => void,
): () => void {
  commandListeners.add(onCommand);
  return () => commandListeners.delete(onCommand);
}

const openListeners = new Set<(url: string, from: string) => void>();

/** Said by the holder when a page asks for a new window. */
export function emitEmbeddedOpen(url: string, from: string): void {
  openListeners.forEach(listener => listener(url, from));
}

/**
 * Hears a page asking for a new window — a link to open in a new tab, a popup —
 * which the folder opens as a tab of its own.
 */
export function subscribeToEmbeddedOpen(onOpen: (url: string, from: string) => void): () => void {
  openListeners.add(onOpen);
  return () => openListeners.delete(onOpen);
}

/**
 * Takes focus back from an embedded page.
 *
 * The page is a separate web contents; while it holds focus, the first click
 * anywhere on the app's own chrome is spent returning focus and never reaches
 * the DOM. Calling this as the pointer arrives means the click that follows is
 * the one that acts, rather than the second.
 */
export function reclaimHostFocus(): void {
  void window.electronAPI?.focusHostWebContents?.();
}

/**
 * Holds the tab's page over `element`, and keeps it there as the page resizes or
 * scrolls. Returns a cleanup that puts the page aside — the reader went to another
 * tab — so it comes back as it was; only discardEmbeddedPage lets it go.
 */
export function embedPageOverElement(url: string, element: HTMLElement, key: string): () => void {
  /**
   * The page is drawn above the folder, so anything opened over it — a dialog, a
   * menu, a popover — would be hidden behind it. These are the portalled overlays;
   * while one is up the page steps aside.
   */
  const overlayOpen = (): boolean => {
    const overlays = document.querySelectorAll(
      // Ours too: an address bar's suggestions, drawn over the page below it.
      '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-xyne-overlay]',
    );
    const hole = element.getBoundingClientRect();
    return Array.from(overlays).some(overlay => {
      // An overlay holding the hole is not in the way — it is the thing asking
      // for the page, as the dialog that browses for a link to save does.
      if (overlay.contains(element)) return false;
      // A tooltip is not either: it is a label for the button under the
      // pointer, and blanking the whole page to show one reads as the page
      // vanishing when the mouse merely passes a toolbar icon.
      if (overlay.matches('[role="tooltip"]') || overlay.querySelector('[role="tooltip"]')) {
        return false;
      }
      // Nor is one that opens somewhere else entirely — a menu in the chat
      // panel beside the page never covers it, so the page can stay.
      const box = overlay.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      return (
        box.left < hole.right &&
        box.right > hole.left &&
        box.top < hole.bottom &&
        box.bottom > hole.top
      );
    });
  };

  // What was last said, so a resize or a toast elsewhere that moves nothing says
  // nothing: each placement re-renders the held pages.
  let last = '';
  const sync = (): void => {
    const box = element.getBoundingClientRect();
    const rect = { x: box.x, y: box.y, width: box.width, height: box.height };
    const visible = !overlayOpen();
    const said = JSON.stringify({ url, rect, visible });
    if (said === last) return;
    last = said;
    placePage(key, url, rect, visible);
  };
  sync();

  const resize = new ResizeObserver(sync);
  resize.observe(element);
  resize.observe(document.documentElement);
  // Overlays are portalled to the body, so their arrival is a body mutation.
  const overlays = new MutationObserver(sync);
  overlays.observe(document.body, { childList: true });
  window.addEventListener('scroll', sync, true);

  return () => {
    resize.disconnect();
    overlays.disconnect();
    window.removeEventListener('scroll', sync, true);
    parkPage(key);
  };
}

/** The open folder's browsing tab, as a search; null without an open folder or when already there. */
export function browserTabSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get('folder')) return null;
  if (params.get('browse') === '1') return null;
  params.delete('canvas');
  params.delete('file');
  params.delete('link');
  params.set('browse', '1');
  return `?${params.toString()}`;
}
