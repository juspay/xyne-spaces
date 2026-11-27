import type { WidgetLayout, WidgetSide } from './surfacesStore';

/**
 * Size and placement rules for widgets. The host enforces all of them; an app
 * asks for a size and gets the nearest size these allow.
 */

export const WIDGET_MIN_SIZE = 48;
export const WIDGET_MAX_WIDTH = 400;
export const WIDGET_MAX_HEIGHT = 560;
/** Never more than this share of the window, whichever limit is smaller. */
export const WIDGET_MAX_VIEWPORT_WIDTH = 0.35;
export const WIDGET_MAX_VIEWPORT_HEIGHT = 0.6;

export const WIDGET_DEFAULT_WIDTH = 320;
export const WIDGET_DEFAULT_HEIGHT = 200;

/** Larger than this in either direction counts as expanded; one at a time. */
export const WIDGET_COMPACT_WIDTH = 320;
export const WIDGET_COMPACT_HEIGHT = 240;

/** Gap kept between a widget and the window edge, and between stacked widgets. */
export const WIDGET_EDGE_GAP = 16;
/** Clears the top bar, so a default widget never sits over navigation. */
export const WIDGET_TOP_OFFSET = 72;

/** Height of a collapsed widget (a pill with the app's name). */
export const WIDGET_COLLAPSED_HEIGHT = 36;
export const WIDGET_COLLAPSED_WIDTH = 180;

const viewport = (): { width: number; height: number } =>
  typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight };

export const clampWidgetSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const vp = viewport();
  const maxW = Math.max(
    WIDGET_MIN_SIZE,
    Math.min(WIDGET_MAX_WIDTH, vp.width * WIDGET_MAX_VIEWPORT_WIDTH),
  );
  const maxH = Math.max(
    WIDGET_MIN_SIZE,
    Math.min(WIDGET_MAX_HEIGHT, vp.height * WIDGET_MAX_VIEWPORT_HEIGHT),
  );
  return {
    width: Math.round(Math.max(WIDGET_MIN_SIZE, Math.min(maxW, width))),
    height: Math.round(Math.max(WIDGET_MIN_SIZE, Math.min(maxH, height))),
  };
};

export const isExpandedSize = (width: number, height: number): boolean =>
  width > WIDGET_COMPACT_WIDTH || height > WIDGET_COMPACT_HEIGHT;

/** Keeps a widget's top inside the window for its current height. */
export const clampWidgetTop = (top: number, height: number): number => {
  const vp = viewport();
  return Math.round(Math.max(WIDGET_EDGE_GAP, Math.min(vp.height - height - WIDGET_EDGE_GAP, top)));
};

/** Where a widget with no saved layout goes: stacked down the right edge. */
export const defaultWidgetLayout = (index: number): WidgetLayout => {
  const size = clampWidgetSize(WIDGET_DEFAULT_WIDTH, WIDGET_DEFAULT_HEIGHT);
  return {
    side: 'right',
    top: clampWidgetTop(WIDGET_TOP_OFFSET + index * (size.height + WIDGET_EDGE_GAP), size.height),
    width: size.width,
    height: size.height,
    collapsed: false,
  };
};

/** The side a widget snaps to when dropped: whichever half its centre is in. */
export const snapSide = (left: number, width: number): WidgetSide =>
  left + width / 2 < viewport().width / 2 ? 'left' : 'right';
