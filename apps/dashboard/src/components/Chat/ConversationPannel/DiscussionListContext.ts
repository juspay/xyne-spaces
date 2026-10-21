import { createContext } from 'react';

/**
 * Set by a host that shows a channel's conversations as discussions rather than as
 * a chat: each is started with a title, reads as a card of its own, and opens into
 * its thread, which is where people talk. The messages, their actions and the
 * composer are the same ones the channel uses; only how they are laid out changes.
 *
 * The SDLC panel sets it. A channel never does, so nothing changes there.
 */
export interface DiscussionListSettings {
  /** Whose discussions these are — a track, a folder, an artifact — for the empty state. */
  subject: string;
}

export const DiscussionListContext = createContext<DiscussionListSettings | null>(null);

/**
 * Which discussions a list shows, joined in the conversation queries themselves: a
 * track's (its own, its items' and its artifacts'), a folder's (with everything under
 * it), or those filed on given items.
 */
export type DiscussionScope = { trackId: string } | { folderId: string } | { ownerIds: string[] };
