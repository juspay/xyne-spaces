import type { CommentAnchor } from '../itemComments';

export interface PickedBlock {
  selector: string;
  text: string;
  rect: { top: number; left: number; width: number; height: number };
}

/**
 * A block's place as the page measured it, in the app's own pixels. A zoomed page
 * measures in its own, scaled units — at 125% one of its pixels is 1.25 of the
 * app's — so the box or thread drawn beside the block would otherwise land short of
 * it, towards the top left.
 */
export function rectOnScreen(rect: PickedBlock['rect'], zoom: number): PickedBlock['rect'] {
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom === 1) return rect;
  return {
    top: rect.top * zoom,
    left: rect.left * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
  };
}

/** A page's own measurement of a block, taken only as numbers. */
export function measuredRect(value: unknown): PickedBlock['rect'] | null {
  if (typeof value !== 'object' || value === null) return null;
  const { top, left, width, height } = value as Record<string, unknown>;
  return typeof top === 'number' &&
    typeof left === 'number' &&
    typeof width === 'number' &&
    typeof height === 'number'
    ? { top, left, width, height }
    : null;
}

export interface CommentMark {
  id: string;
  selector: string;
  quote: string;
  body: string;
}

/**
 * How the annotator reaches the content it is annotating.
 *
 * The three surfaces differ only here: a document renders in an iframe we own
 * and talks over postMessage, the AI screen's browser is a webview driven with
 * executeJavaScript, and a folder's browser is held by the host window over a
 * hole in this frame and is reached through the frame bridge. Everything above
 * this interface — the picker UI, the marks, the jump — is the same code.
 */
export interface AnnotateTransport {
  /** True once the content is reachable; the toggle stays hidden until then. */
  ready: boolean;
  /** Turn block picking on or off inside the content. */
  setPicking: (on: boolean) => void;
  /** Draw (or clear) the persistent comment markers. */
  paintMarks: (marks: readonly CommentMark[]) => void;
  /** Scroll an anchored block into view and flash it. */
  reveal: (anchor: CommentAnchor) => void;
  /** Drop any highlight the transport is holding on a picked block. */
  clearHighlight?: () => void;
  /** Drop the "this thread is open" marking on a commented block. */
  clearActive?: () => void;
}

export interface TransportEvents {
  onPick: (picked: PickedBlock) => void;
  /** The rect is where the block sits, for a thread opened beside it. */
  onMarkClick: (commentId: string, rect?: PickedBlock['rect']) => void;
  onReady?: () => void;
}
