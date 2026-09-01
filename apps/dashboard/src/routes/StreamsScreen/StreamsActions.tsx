import { createContext, useContext } from 'react';
import type { ColumnActivity } from './useColumnActivity';
import type { ColumnSource } from './Streams.types';

export interface StreamsActions {
  /**
   * Insert a column immediately right of the one asking, and focus it.
   *
   * Surfaces need this to act on the *stream* rather than only on themselves —
   * a feed row opening the conversation it points at, for instance. Passed
   * through context rather than props so the surface registry's `Body`
   * signature stays the same for every kind, including the ones that never
   * touch the stream.
   */
  openBeside: (fromColumnId: string, source: ColumnSource) => void;
  /**
   * Replace a column's source in place.
   *
   * Some surfaces are defined by something the user wrote — a feed is its
   * description — and editing that has to survive a reload, so it belongs in the
   * persisted layout rather than in the surface's own state.
   */
  updateSource: (columnId: string, source: ColumnSource) => void;
  /**
   * Publish a column's own activity to the stream.
   *
   * The stream derives activity for channels and threads from the same signals
   * the sidebar reads, but some surfaces are the only thing that knows whether
   * they changed — a feed's "new" means "something matched my topic since you
   * last looked", which no shared hook can answer. Reporting it here is what
   * puts a feed behind the off-screen jump pills alongside everything else.
   */
  reportActivity: (columnId: string, activity: ColumnActivity) => void;
  /**
   * Close the column a surface is sitting in.
   *
   * Some embedded surfaces ship their own close control and cannot be talked out
   * of it — Ask AI's header close falls back to dismissing the global drawer,
   * which inside a stream means dismissing something that is not on screen. Giving
   * it the column's own close makes the button mean what it looks like.
   */
  closeColumn: (columnId: string) => void;
}

const NOOP: StreamsActions = {
  openBeside: () => {},
  updateSource: () => {},
  reportActivity: () => {},
  closeColumn: () => {},
};

const StreamsActionsContext = createContext<StreamsActions>(NOOP);

export const StreamsActionsProvider = StreamsActionsContext.Provider;

export const useStreamsActions = (): StreamsActions => useContext(StreamsActionsContext);
