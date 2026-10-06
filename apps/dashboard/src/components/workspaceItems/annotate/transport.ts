import type { CommentAnchor } from '../itemComments';

export interface PickedBlock {
  selector: string;
  text: string;
  rect: { top: number; left: number; width: number; height: number };
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
