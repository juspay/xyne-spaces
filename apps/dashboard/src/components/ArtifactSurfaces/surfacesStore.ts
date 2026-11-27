import { useSyncExternalStore } from 'react';
import {
  WIDGET_COMPACT_HEIGHT,
  WIDGET_COMPACT_WIDTH,
  clampWidgetSize,
  clampWidgetTop,
  defaultWidgetLayout,
  isExpandedSize,
} from './widgetSizing';

/**
 * Which artifact apps the viewer runs as an overlay or as widgets, and how the
 * widgets sit on screen.
 *
 * Per device, in localStorage, like the customizable bars: it is a choice about
 * this window, with nothing to sync. The confirm preview, the session toggle
 * and failure counts live in memory only — a reload starts them fresh.
 */

/** Widgets on screen at once. */
export const MAX_WIDGETS = 3;

/** Consecutive failures before an overlay or widget is switched off. */
export const MAX_SURFACE_FAILURES = 3;

/** How long a newly chosen overlay runs before it reverts unless kept. */
export const OVERLAY_CONFIRM_SECONDS = 10;

/** How long "Pause for an hour" pauses. */
export const OVERLAY_PAUSE_MS = 60 * 60 * 1000;

export type WidgetSide = 'left' | 'right';

export interface WidgetLayout {
  side: WidgetSide;
  /** Distance from the top of the window, in CSS pixels. */
  top: number;
  width: number;
  height: number;
  collapsed: boolean;
}

interface OverlayPrefs {
  appId: string | null;
  /** Epoch ms; the overlay is hidden until then. */
  pausedUntil: number | null;
}

interface PendingOverlay {
  appId: string;
  /** The overlay to go back to if this one is not kept. */
  previousAppId: string | null;
}

export interface SurfacesSnapshot {
  overlay: OverlayPrefs;
  /** A newly chosen overlay, shown for the viewer to keep or revert. */
  pending: PendingOverlay | null;
  /** Hidden with the keyboard shortcut for this session. */
  suppressed: boolean;
  widgets: readonly string[];
  layouts: Readonly<Record<string, WidgetLayout>>;
}

const OVERLAY_KEY = 'xyne:artifact-overlay-v1';
const WIDGETS_KEY = 'xyne:artifact-widgets-v1';
const LAYOUTS_KEY = 'xyne:artifact-widget-layouts-v1';

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the in-memory snapshot still holds the change
    // for this session.
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readOverlay = (): OverlayPrefs => {
  const raw = readJson(OVERLAY_KEY);
  if (!isRecord(raw)) return { appId: null, pausedUntil: null };
  return {
    appId: typeof raw['appId'] === 'string' ? raw['appId'] : null,
    pausedUntil: typeof raw['pausedUntil'] === 'number' ? raw['pausedUntil'] : null,
  };
};

const readWidgets = (): string[] => {
  const raw = readJson(WIDGETS_KEY);
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((id): id is string => typeof id === 'string'))).slice(
    0,
    MAX_WIDGETS,
  );
};

const readLayouts = (): Record<string, WidgetLayout> => {
  const raw = readJson(LAYOUTS_KEY);
  if (!isRecord(raw)) return {};
  const out: Record<string, WidgetLayout> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { side, top, width, height, collapsed } = value;
    if (
      (side === 'left' || side === 'right') &&
      typeof top === 'number' &&
      typeof width === 'number' &&
      typeof height === 'number'
    ) {
      out[id] = { side, top, width, height, collapsed: collapsed === true };
    }
  }
  return out;
};

let snapshot: SurfacesSnapshot | null = null;
const listeners = new Set<() => void>();
const failures = new Map<string, number>();

const current = (): SurfacesSnapshot => {
  if (!snapshot) {
    snapshot = {
      overlay: readOverlay(),
      pending: null,
      suppressed: false,
      widgets: readWidgets(),
      layouts: readLayouts(),
    };
  }
  return snapshot;
};

const update = (next: Partial<SurfacesSnapshot>): void => {
  const prev = current();
  snapshot = { ...prev, ...next };
  if (next.overlay && next.overlay !== prev.overlay) writeJson(OVERLAY_KEY, next.overlay);
  if (next.widgets && next.widgets !== prev.widgets) writeJson(WIDGETS_KEY, next.widgets);
  if (next.layouts && next.layouts !== prev.layouts) writeJson(LAYOUTS_KEY, next.layouts);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSurfaces = (): SurfacesSnapshot =>
  useSyncExternalStore(subscribe, current, current);

export const getSurfaces = (): SurfacesSnapshot => current();

/** The overlay on screen right now: a pending preview wins over the kept one. */
export const shownOverlayAppId = (s: SurfacesSnapshot, now: number): string | null => {
  if (s.pending) return s.pending.appId;
  if (s.suppressed || !s.overlay.appId) return null;
  if (s.overlay.pausedUntil !== null && now < s.overlay.pausedUntil) return null;
  return s.overlay.appId;
};

// ─── Overlay ────────────────────────────────────────────────────────────────

/**
 * Show `appId` as the overlay, as a preview the viewer must keep. Not stored
 * until `keepOverlay`: if the overlay hides the screen and nobody can answer,
 * the countdown reverts it.
 */
export const previewOverlay = (appId: string): void => {
  const s = current();
  if (s.pending?.appId === appId) return;
  if (!s.pending && s.overlay.appId === appId && shownOverlayAppId(s, Date.now()) === appId) {
    return;
  }
  failures.delete(failureKey('overlay', appId));
  update({
    pending: { appId, previousAppId: s.pending ? s.pending.previousAppId : s.overlay.appId },
    suppressed: false,
  });
};

export const keepOverlay = (): void => {
  const { pending } = current();
  if (!pending) return;
  update({ pending: null, overlay: { appId: pending.appId, pausedUntil: null } });
};

/** Drops the preview; whatever was kept before comes back. */
export const revertOverlay = (): void => {
  if (!current().pending) return;
  update({ pending: null });
};

export const turnOffOverlay = (): void => {
  update({ pending: null, overlay: { appId: null, pausedUntil: null } });
};

/** Off only if `appId` is the one shown — an app may switch off its own overlay, nobody else's. */
export const turnOffOverlayFor = (appId: string): void => {
  const s = current();
  if (s.pending?.appId === appId) {
    update({ pending: null });
    return;
  }
  if (s.overlay.appId === appId) turnOffOverlay();
};

export const pauseOverlay = (ms: number): void => {
  const s = current();
  if (!s.overlay.appId) return;
  update({ overlay: { ...s.overlay, pausedUntil: Date.now() + ms } });
};

export const resumeOverlay = (): void => {
  const s = current();
  update({ suppressed: false, overlay: { ...s.overlay, pausedUntil: null } });
};

/** The keyboard shortcut: hide for this session, or bring back. */
export const toggleOverlaySuppressed = (): void => {
  const s = current();
  if (s.pending) {
    revertOverlay();
    return;
  }
  update({ suppressed: !s.suppressed });
};

// ─── Widgets ────────────────────────────────────────────────────────────────

export const addWidget = (appId: string): boolean => {
  const s = current();
  if (s.widgets.includes(appId)) return true;
  if (s.widgets.length >= MAX_WIDGETS) return false;
  failures.delete(failureKey('widget', appId));
  update({ widgets: [...s.widgets, appId] });
  return true;
};

export const removeWidget = (appId: string): void => {
  const s = current();
  if (!s.widgets.includes(appId)) return;
  update({ widgets: s.widgets.filter(id => id !== appId) });
};

export const setWidgetLayout = (appId: string, layout: WidgetLayout): void => {
  const s = current();
  update({ layouts: { ...s.layouts, [appId]: layout } });
};

/** The widget's saved layout, or its place in the default stack. */
export const widgetLayoutFor = (s: SurfacesSnapshot, appId: string): WidgetLayout =>
  s.layouts[appId] ?? defaultWidgetLayout(Math.max(0, s.widgets.indexOf(appId)));

/**
 * A size the app asked for, clamped to the host's limits. Only one widget may
 * be expanded: growing this one returns any other expanded widget to the
 * compact size.
 */
export const resizeWidget = (appId: string, width: number, height: number): void => {
  const s = current();
  if (!s.widgets.includes(appId)) return;
  const size = clampWidgetSize(width, height);
  const layouts: Record<string, WidgetLayout> = { ...s.layouts };
  if (isExpandedSize(size.width, size.height)) {
    for (const other of s.widgets) {
      if (other === appId) continue;
      const layout = widgetLayoutFor(s, other);
      if (!isExpandedSize(layout.width, layout.height)) continue;
      const compact = clampWidgetSize(
        Math.min(layout.width, WIDGET_COMPACT_WIDTH),
        Math.min(layout.height, WIDGET_COMPACT_HEIGHT),
      );
      layouts[other] = { ...layout, ...compact };
    }
  }
  const layout = widgetLayoutFor(s, appId);
  layouts[appId] = { ...layout, ...size, top: clampWidgetTop(layout.top, size.height) };
  update({ layouts });
};

/** Forget where every widget was; they go back to the default stack. */
export const resetWidgetLayouts = (): void => {
  update({ layouts: {} });
};

// ─── Failures ───────────────────────────────────────────────────────────────

const failureKey = (surface: 'overlay' | 'widget', appId: string): string => `${surface}:${appId}`;

/**
 * Count a failure. Returns true when this one reached the limit and the app was
 * switched off on that surface.
 */
export const reportSurfaceFailure = (surface: 'overlay' | 'widget', appId: string): boolean => {
  const key = failureKey(surface, appId);
  const count = (failures.get(key) ?? 0) + 1;
  failures.set(key, count);
  if (count < MAX_SURFACE_FAILURES) return false;
  failures.delete(key);
  if (surface === 'overlay') turnOffOverlayFor(appId);
  else removeWidget(appId);
  return true;
};

export const reportSurfaceReady = (surface: 'overlay' | 'widget', appId: string): void => {
  failures.delete(failureKey(surface, appId));
};
