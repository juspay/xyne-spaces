import { setup, assign, createActor } from 'xstate';

interface StreamsContext {
  /**
   * Which channels are currently on screen as Streams columns, in stream order.
   *
   * Stream order rather than recency, because the arrangement *is* the ranking:
   * it is the order the user put them in, which is a better answer than "most
   * recently touched" for anything offering them back.
   *
   * Empty whenever Streams is not mounted, which is everywhere else in the app.
   * Consumers already render correctly against an empty list, so nothing needs
   * an "am I in a stream?" branch.
   */
  channelIds: readonly string[];
}

type StreamsEvent =
  | { type: 'CHANNELS_CHANGED'; channelIds: readonly string[] }
  | { type: 'STREAM_CLOSED' };

/**
 * The stream's public surface to the rest of the app.
 *
 * Exists so a surface embedded *inside* a stream can prefer what the stream is
 * already showing, without either side importing the other. Ask AI does not know
 * what Streams is, and Streams does not know how Ask AI attaches context — they
 * meet on this list of ids and nothing else.
 *
 * Deliberately holds only what crosses the feature boundary. Everything the
 * stream needs for itself — layout, focus, widths — stays local to
 * `StreamsScreen`, because publishing it here would invite the rest of the app
 * to depend on the shape of a stream's internals.
 */
export const streamsMachine = setup({
  types: {
    context: {} as StreamsContext,
    events: {} as StreamsEvent,
  },
  actions: {
    setChannels: assign({
      channelIds: ({ context, event }) =>
        event.type === 'CHANNELS_CHANGED' ? event.channelIds : context.channelIds,
    }),
    // Unmounting has to clear the list, not leave the last stream's channels
    // standing. Ask AI outlives Streams, and a stale "in this stream" group
    // offering channels from a screen the user has left is worse than no group.
    clearChannels: assign({ channelIds: () => [] }),
  },
}).createMachine({
  context: { channelIds: [] },
  on: {
    CHANNELS_CHANGED: { actions: 'setChannels' },
    STREAM_CLOSED: { actions: 'clearChannels' },
  },
});

export const streamsActor = createActor(streamsMachine).start();
