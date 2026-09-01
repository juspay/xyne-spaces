import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DEFAULT_WIDTH,
  SURFACE_MIN_WIDTHS,
  type ColumnSource,
  type Stream,
} from '../utils/Streams.types';
import { allowsDuplicates, sourceKey } from '../utils/Streams.utils';
import {
  createStream,
  liveStreams,
  loadLayout,
  makeColumn,
  saveLayout,
} from '../utils/streamsLayout';

/** A stream as the picker needs it: something to name and something to add to. */
export interface StreamTarget {
  id: string;
  name: string;
  /** True for the stream that is currently open, so the picker can mark it. */
  active: boolean;
}

export interface AddToStream {
  /**
   * The live streams, read fresh.
   *
   * A function rather than a value because this hook is used on pages that are
   * not Streams, and the layout can be changed by the Streams tab in another
   * browser tab between one menu opening and the next. Reading on open costs a
   * single `localStorage.getItem` and removes a whole class of "the list was
   * stale" bug.
   */
  list: () => StreamTarget[];
  /**
   * Is this already a column in some live stream?
   *
   * For controls that should not offer to add a thing that is already added —
   * most obviously the ticket header's button, which renders *inside* the ticket
   * column when a ticket is opened in a stream, and would otherwise sit there
   * offering to add the thing you are looking at to the place you are looking at
   * it. Any live stream counts, not just the open one: a ticket filed in one
   * stream and offered again from another reads as a thing that failed to stick.
   */
  has: (source: ColumnSource) => boolean;
  /** Add to a named stream. */
  add: (source: ColumnSource, streamId: string) => void;
  /** Make a stream and add to that. */
  addToNew: (source: ColumnSource) => void;
}

/**
 * Put something into a stream from anywhere in the app.
 *
 * The counterpart to the add palette, which can only add to the stream you are
 * already looking at. This is the other direction: you are reading a ticket, or
 * a thread, or an Ask AI answer, and you want it kept beside the work — without
 * leaving the page to go and fetch it.
 *
 * Writes through `loadLayout`/`saveLayout` rather than through any Streams
 * state, because the Streams screen is not mounted when this runs. It reads the
 * layout on mount and owns it from there, so an add that happens while you are
 * on another route lands cleanly and is picked up next time you open the tab.
 * The one arrangement that would lose a write is Streams staying mounted behind
 * whatever page you added from; nothing does that today, and if something ever
 * does, the fix is a `storage` listener on the Streams side rather than anything
 * here.
 */
export const useAddToStream = (): AddToStream => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  const openStreams = useCallback((): void => {
    void navigate(workspaceId ? `/${workspaceId}/streams` : '/streams');
  }, [navigate, workspaceId]);

  const has = useCallback((source: ColumnSource): boolean => {
    // An `agent` column allows duplicates by design — several Ask AI columns in
    // one stream is a normal arrangement — so it is never "already there".
    if (allowsDuplicates(source)) return false;
    const key = sourceKey(source);
    return liveStreams(loadLayout()).some(stream =>
      stream.columns.some(column => sourceKey(column.source) === key),
    );
  }, []);

  const list = useCallback((): StreamTarget[] => {
    const layout = loadLayout();
    return liveStreams(layout).map(stream => ({
      id: stream.id,
      name: stream.name,
      active: stream.id === layout.activeStreamId,
    }));
  }, []);

  /**
   * The shared tail of both entry points: append, focus, save, say so.
   *
   * `focus` moves to the new column deliberately. You added this thing in order
   * to come back to it, so the stream should be showing it when you do — landing
   * on wherever you happened to be last is the behaviour of a tab you left open,
   * not of somewhere you filed something.
   */
  const commit = useCallback(
    (source: ColumnSource, stream: Stream, streams: readonly Stream[], activeId: string): void => {
      if (
        !allowsDuplicates(source) &&
        stream.columns.some(c => sourceKey(c.source) === sourceKey(source))
      ) {
        toast.info(`Already in ${stream.name}`, {
          action: { label: 'View', onClick: openStreams },
        });
        return;
      }
      // Sized the way the stream sizes its own new columns — the shipped default,
      // floored at what the surface needs. Not the dev dial: that is a Streams
      // context which does not reach this far, and a column added from a ticket
      // page should not silently differ from the same column added in the strip.
      const column = makeColumn(source, Math.max(DEFAULT_WIDTH, SURFACE_MIN_WIDTHS[source.kind]));
      const next = {
        ...stream,
        columns: [...stream.columns, column],
        focus: stream.columns.length,
      };
      saveLayout({
        version: 1,
        streams: streams.map(s => (s.id === next.id ? next : s)),
        activeStreamId: activeId,
      });
      toast.success(`Added to ${next.name}`, {
        action: { label: 'View', onClick: openStreams },
      });
    },
    [openStreams],
  );

  const add = useCallback(
    (source: ColumnSource, streamId: string): void => {
      const layout = loadLayout();
      const stream = layout.streams.find(s => s.id === streamId);
      // The stream was archived or deleted while the menu sat open. Saying so
      // beats writing the column into a stream nobody will look at again.
      if (!stream) {
        toast.error('That stream is no longer there');
        return;
      }
      commit(source, stream, layout.streams, layout.activeStreamId);
    },
    [commit],
  );

  const addToNew = useCallback(
    (source: ColumnSource): void => {
      // `createStream` names it and makes it active; the new one is the last in
      // the returned list. Made active on purpose — you asked for a new stream,
      // so that is the one you mean to be in when you go and look.
      const layout = createStream(loadLayout());
      const created = layout.streams[layout.streams.length - 1];
      if (!created) return;
      commit(source, created, layout.streams, created.id);
    },
    [commit],
  );

  return { list, has, add, addToNew };
};
