import { createContext, useContext } from 'react';

/**
 * Which channels are currently on screen as Streams columns.
 *
 * Exists so that a surface embedded *inside* a stream can prefer what the stream is
 * already showing, without either side importing the other. Ask AI does not know
 * what Streams is, and Streams does not know how Ask AI attaches context — they
 * meet on this list of ids and nothing else.
 *
 * The default is an empty array on purpose: every consumer already renders
 * correctly when it is empty, which is exactly the case everywhere outside
 * Streams. Nothing needs a "am I in a stream?" branch.
 */
const StreamChannelsContext = createContext<readonly string[]>([]);

export const StreamChannelsProvider = StreamChannelsContext.Provider;

/**
 * The stream's channels, in stream order — which is the order the user arranged them
 * in, and therefore a better ranking than recency for anything offering them
 * back. Empty outside Streams.
 */
export const useStreamChannels = (): readonly string[] => useContext(StreamChannelsContext);
