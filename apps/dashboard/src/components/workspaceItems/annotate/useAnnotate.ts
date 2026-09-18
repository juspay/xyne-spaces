import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { commentStoreFor, onCommentsChanged } from '../itemComments';
import { registerAnchorRevealer, requestComments } from '../anchorReveal';
import type { WorkspaceItem } from '../itemDescriptor';
import { useAnnotation } from './AnnotateBox';
import type { AnnotateTransport, CommentMark, PickedBlock } from './transport';

export interface AnnotateParts {
  /** Toolbar toggle, or null while the content is not reachable yet. */
  toggle: ReactElement | null;
  /** The inline box over the picked block, drawn by the viewer's overlay. */
  box: ReactElement | null;
  picking: boolean;
  /** Tells the annotator a pick landed on a surface that renders it itself. */
  notePicked: () => void;
}

export interface AnnotateInput {
  item: WorkspaceItem;
  url: string;
  editable?: boolean;
  /** Built by the viewer for whatever holds its content. */
  transport: AnnotateTransport;
  picked: PickedBlock | null;
  onPicked: (picked: PickedBlock | null) => void;
}

/**
 * Point at a block, then comment on it or send it to chat — and keep the
 * comments that already exist painted on the content. The viewer supplies a
 * transport; everything else is the same wherever an item is rendered.
 */
export function useAnnotate({
  item,
  url,
  editable = false,
  transport,
  picked,
  onPicked,
}: AnnotateInput): AnnotateParts {
  const [picking, setPicking] = useState(false);
  const { ready, setPicking: drive, paintMarks, reveal, clearHighlight } = transport;

  const paint = useCallback((): void => {
    const store = commentStoreFor(item);
    if (!store || !ready) return;
    void store
      .list(item)
      .then(rows => {
        const marks: CommentMark[] = rows
          .filter(row => !row.resolved && row.anchor?.quote)
          .map(row => ({
            id: row.id,
            selector: row.anchor?.selector ?? '',
            quote: row.anchor?.quote ?? '',
            body: row.body,
          }));
        paintMarks(marks);
      })
      .catch(() => undefined);
  }, [item, ready, paintMarks]);

  const paintRef = useRef(paint);
  paintRef.current = paint;

  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  // A reload loses the picker's state but not the reader's intent: if they were
  // mid-pick when the content came back, arm it again rather than silently
  // dropping them out of it.
  useEffect(() => {
    if (!ready) return;
    paintRef.current();
    if (pickingRef.current) drive(true);
  }, [ready, drive]);

  useEffect(
    () =>
      onCommentsChanged(id => {
        if (id === item.id) paintRef.current();
      }),
    [item.id],
  );

  useEffect(() => registerAnchorRevealer(item.id, anchor => reveal(anchor)), [item.id, reveal]);

  const start = useCallback((): void => {
    setPicking(true);
    drive(true);
  }, [drive]);

  const stop = useCallback((): void => {
    setPicking(false);
    drive(false);
  }, [drive]);

  useEffect(() => {
    if (picked) setPicking(false);
  }, [picked]);

  // A surface that renders its own pick elsewhere (the bridge path puts the
  // passage in the comments panel, since a box here would sit behind the
  // host-drawn page) never sets `picked`, so it reports the pick this way
  // instead. Without it the toggle stays armed and the next click stops.
  const notePicked = useCallback((): void => setPicking(false), []);

  const annotation = useAnnotation({
    item,
    editable,
    url,
    picking,
    picked,
    start,
    stop,
    onCleared: () => {
      onPicked(null);
      clearHighlight?.();
    },
  });

  return {
    toggle: ready ? annotation.toggle : null,
    box: annotation.box,
    picking,
    notePicked,
  };
}

export { requestComments };
