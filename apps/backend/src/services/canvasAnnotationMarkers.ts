export interface CanvasAnnotationMarkerOptions {
  preserveCanvasCommentMarkers?: boolean;
  preserveCanvasTicketMarkers?: boolean;
}

interface AnnotationInline {
  type?: string;
  text?: string;
  styles?: unknown;
  [key: string]: unknown;
}

interface AnnotationBlock {
  content?: unknown;
  children?: AnnotationBlock[];
  [key: string]: unknown;
}

type AnnotationKind = 'comment' | 'ticket';

interface AnnotationState {
  activeCommentThreadId: string | null;
  activeTicketId: string | null;
}

const COMMENT_STYLE = 'canvasCommentThread';
const TICKET_STYLE = 'canvasTicket';
const MARKER_PATTERN = /\[\[xyne-(comment|ticket)-(start|end):([^\]\s]+)\]\]/g;

function isTextInline(inline: AnnotationInline): inline is AnnotationInline & { text: string } {
  return inline.type === 'text' && typeof inline.text === 'string';
}

function marker(kind: AnnotationKind, boundary: 'start' | 'end', id: string): string {
  return `[[xyne-${kind}-${boundary}:${id}]]`;
}

function withoutAnnotationStyles(styles: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(styles).filter(([name]) => name !== COMMENT_STYLE && name !== TICKET_STYLE)
  );
}

/**
 * Represent canvas-only inline styles as plain text markers before converting
 * the document to Markdown. The default server BlockNote schema cannot encode
 * these styles itself.
 */
export function encodeCanvasAnnotationMarkers(
  inline: AnnotationInline,
  options: CanvasAnnotationMarkerOptions
): AnnotationInline {
  if (!isTextInline(inline)) return inline;

  const styles =
    inline.styles && typeof inline.styles === 'object'
      ? (inline.styles as Record<string, unknown>)
      : {};
  const commentId = styles[COMMENT_STYLE];
  const ticketId = styles[TICKET_STYLE];
  const preserveComment =
    options.preserveCanvasCommentMarkers && typeof commentId === 'string' && commentId.length > 0;
  const preserveTicket =
    options.preserveCanvasTicketMarkers && typeof ticketId === 'string' && ticketId.length > 0;

  if (!preserveComment && !preserveTicket) return inline;

  const start = `${preserveComment ? marker('comment', 'start', commentId) : ''}${
    preserveTicket ? marker('ticket', 'start', ticketId) : ''
  }`;
  const end = `${preserveTicket ? marker('ticket', 'end', ticketId) : ''}${
    preserveComment ? marker('comment', 'end', commentId) : ''
  }`;

  return {
    ...inline,
    text: `${start}${inline.text}${end}`,
    styles: withoutAnnotationStyles(styles),
  };
}

function withActiveStyles(inline: AnnotationInline, state: AnnotationState): AnnotationInline {
  if (!state.activeCommentThreadId && !state.activeTicketId) return inline;
  const styles =
    inline.styles && typeof inline.styles === 'object'
      ? (inline.styles as Record<string, unknown>)
      : {};

  return {
    ...inline,
    styles: {
      ...styles,
      ...(state.activeCommentThreadId ? { [COMMENT_STYLE]: state.activeCommentThreadId } : {}),
      ...(state.activeTicketId ? { [TICKET_STYLE]: state.activeTicketId } : {}),
    },
  };
}

function applyMarker(
  state: AnnotationState,
  kind: AnnotationKind,
  boundary: string | undefined,
  id: string | undefined
): void {
  if (!id) return;
  const stateKey = kind === 'comment' ? 'activeCommentThreadId' : 'activeTicketId';
  if (boundary === 'start') {
    state[stateKey] = id;
  } else if (!state[stateKey] || state[stateKey] === id) {
    state[stateKey] = null;
  }
}

function restoreContent(content: unknown, state: AnnotationState): unknown {
  if (!Array.isArray(content)) return content;

  return content.flatMap((part): AnnotationInline[] => {
    const inline = part as AnnotationInline;
    if (!isTextInline(inline) || !inline.text.includes('[[xyne-')) {
      return isTextInline(inline) ? [withActiveStyles(inline, state)] : [inline];
    }

    const restored: AnnotationInline[] = [];
    let cursor = 0;
    MARKER_PATTERN.lastIndex = 0;
    for (const match of inline.text.matchAll(MARKER_PATTERN)) {
      const markerStart = match.index ?? 0;
      if (markerStart > cursor) {
        restored.push(
          withActiveStyles({ ...inline, text: inline.text.slice(cursor, markerStart) }, state)
        );
      }
      applyMarker(state, match[1] as AnnotationKind, match[2], match[3]);
      cursor = markerStart + match[0].length;
    }

    if (cursor < inline.text.length) {
      restored.push(withActiveStyles({ ...inline, text: inline.text.slice(cursor) }, state));
    }
    return restored;
  });
}

/** Remove annotation markers and restore their BlockNote inline styles. */
export function restoreCanvasAnnotationMarkers<T extends AnnotationBlock>(blocks: T[]): T[] {
  const walk = (level: AnnotationBlock[]): AnnotationBlock[] =>
    level.map((block) => {
      const next: AnnotationBlock = { ...block };
      // Generated marker pairs never span blocks. A fresh state also prevents a
      // malformed AI response from leaking a style through the remaining canvas.
      if (block.content !== undefined) {
        next.content = restoreContent(block.content, {
          activeCommentThreadId: null,
          activeTicketId: null,
        });
      }
      if (Array.isArray(block.children)) {
        next.children = walk(block.children);
      }
      return next;
    });

  return walk(blocks) as T[];
}
