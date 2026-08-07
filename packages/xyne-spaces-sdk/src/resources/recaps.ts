/**
 * Recaps Resource
 *
 * Daily summaries of channel and project activity, their subscriptions and read
 * state, plus entity-level nudges.
 *
 * Every read is addressed by day — pass `recapDate` as epoch milliseconds.
 */

import { Resource } from './base.js';
import { recapsOperations } from '../registry/recaps.js';
import type { Recap } from '../types/index.js';

export class RecapsResource extends Resource {
  /**
   * Get recaps for several channels on one day.
   *
   * @param recapDate - The day being summarised, as epoch milliseconds
   *
   * @example
   * const recaps = await sdk.recaps.listForChannels(['channel-1'], Date.now());
   */
  listForChannels(channelIds: string[], recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listForChannels, { channelIds, recapDate });
  }

  /**
   * Get the daily recap rows for several channels, including the per-user
   * variants generated from custom prompts.
   */
  listDaily(channelIds: string[], recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listDaily, { channelIds, recapDate });
  }

  /** Get project recaps for a day. */
  listForProjects(recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listForProjects, { recapDate });
  }

  /**
   * Replace the set of channels the current user receives recaps for.
   *
   * This sets the whole subscription list rather than adding to it — include
   * every channel you want subscribed, or it will be dropped.
   */
  saveSubscriptions(channelIds: string[]): Promise<void> {
    return this.call(recapsOperations.saveSubscriptions, { channelIds });
  }

  /**
   * Set a custom prompt shaping how a channel's recap is written.
   *
   * @example
   * await sdk.recaps.setCustomPrompt('channel-1', 'Focus on incidents and blockers.');
   */
  setCustomPrompt(channelId: string, prompt: string): Promise<void> {
    return this.call(recapsOperations.setCustomPrompt, { channelId, prompt });
  }

  /** Mark a whole day's recaps seen. */
  markSeen(recapDate: number): Promise<void> {
    return this.call(recapsOperations.markSeen, { recapDate });
  }

  /** Mark one channel's recap read. */
  markChannelRead(channelId: string, recapDate: number): Promise<void> {
    return this.call(recapsOperations.markChannelRead, { channelId, recapDate });
  }

  /** Mark one channel's recap unread again. */
  markChannelUnread(channelId: string): Promise<void> {
    return this.call(recapsOperations.markChannelUnread, { channelId });
  }

  // ----- Nudges -----

  /**
   * List nudges attached to an entity such as a ticket.
   *
   * Message-level nudges, and dismissing or acting on any nudge, live on
   * `sdk.activities`.
   */
  listEntityNudges(sourceId: string, states?: string[]): Promise<unknown[]> {
    return this.call(recapsOperations.listEntityNudges, {
      sourceId,
      ...(states ? { states } : {}),
    });
  }

  /** Resolve nudges behind aggregate counts. */
  listNudgesByCountRows(countRowIds: string[]): Promise<unknown[]> {
    return this.call(recapsOperations.listNudgesByCountRows, { countRowIds });
  }
}
