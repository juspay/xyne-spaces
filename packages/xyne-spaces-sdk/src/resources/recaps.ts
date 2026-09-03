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
import type { Nudge, NudgeState, Recap } from '../types/index.js';

export class RecapsResource extends Resource {
  /**
   * Get recaps for several channels on one day.
   *
   * @param channelIds - Channels to summarise.
   * @param recapDate - The day being summarised, as epoch milliseconds.
   * @returns One recap per channel that has one for that day.
   * @example
   * const recaps = await sdk.recaps.listForChannels(['channel-1'], Date.now());
   */
  listForChannels(channelIds: string[], recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listForChannels, { channelIds, recapDate });
  }

  /**
   * Get the daily recap rows for several channels, including the per-user
   * variants generated from custom prompts.
   *
   * @param channelIds - Channels to read.
   * @param recapDate - The day being summarised, as epoch milliseconds.
   * @returns Base recaps plus any custom variants written for the caller.
   * @example
   * const rows = await sdk.recaps.listDaily(['channel-1'], Date.now());
   */
  listDaily(channelIds: string[], recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listDaily, { channelIds, recapDate });
  }

  /**
   * Get project recaps for a day.
   *
   * @param recapDate - The day being summarised, as epoch milliseconds.
   * @returns Project recaps written for the caller on that day.
   * @example
   * const recaps = await sdk.recaps.listForProjects(Date.now());
   */
  listForProjects(recapDate: number): Promise<Recap[]> {
    return this.call(recapsOperations.listForProjects, { recapDate });
  }

  /**
   * Replace the set of channels the current user receives recaps for.
   *
   * This sets the whole subscription list rather than adding to it — include
   * every channel you want subscribed, or it will be dropped.
   *
   * @param channelIds - The complete set of channels to subscribe to.
   * @example
   * await sdk.recaps.saveSubscriptions(['channel-1', 'channel-2']);
   */
  saveSubscriptions(channelIds: string[]): Promise<void> {
    return this.call(recapsOperations.saveSubscriptions, { channelIds });
  }

  /**
   * Set a custom prompt shaping how a channel's recap is written for the caller.
   *
   * @param channelId - Channel whose recap to shape.
   * @param prompt - Instruction applied when the recap is generated.
   * @example
   * await sdk.recaps.setCustomPrompt('channel-1', 'Focus on incidents and blockers.');
   */
  setCustomPrompt(channelId: string, prompt: string): Promise<void> {
    return this.call(recapsOperations.setCustomPrompt, { channelId, prompt });
  }

  /**
   * Mark a whole day's recaps seen.
   *
   * @param recapDate - The day to mark, as epoch milliseconds.
   * @example
   * await sdk.recaps.markSeen(Date.now());
   */
  markSeen(recapDate: number): Promise<void> {
    return this.call(recapsOperations.markSeen, { recapDate });
  }

  /**
   * Mark one channel's recap read.
   *
   * @param channelId - Channel whose recap was read.
   * @param recapDate - The day of the recap, as epoch milliseconds.
   * @example
   * await sdk.recaps.markChannelRead('channel-1', Date.now());
   */
  markChannelRead(channelId: string, recapDate: number): Promise<void> {
    return this.call(recapsOperations.markChannelRead, { channelId, recapDate });
  }

  /**
   * Mark one channel's recap unread again.
   *
   * @param channelId - Channel whose recap to restore to unread.
   * @example
   * await sdk.recaps.markChannelUnread('channel-1');
   */
  markChannelUnread(channelId: string): Promise<void> {
    return this.call(recapsOperations.markChannelUnread, { channelId });
  }

  // ----- Nudges -----

  /**
   * List nudges attached to an entity such as a ticket.
   *
   * Message-level nudges, and dismissing or acting on any nudge, live on
   * `sdk.activities`.
   *
   * @param sourceId - Id of the entity the nudges are attached to.
   * @param states - Restrict to these states. Defaults to active nudges only.
   * @returns Nudges for that entity.
   * @example
   * const nudges = await sdk.recaps.listEntityNudges('ticket-1', ['ACTIVE']);
   */
  listEntityNudges(sourceId: string, states?: NudgeState[]): Promise<Nudge[]> {
    return this.call(recapsOperations.listEntityNudges, {
      sourceId,
      ...(states ? { states } : {}),
    });
  }

  /**
   * Resolve the individual nudges behind aggregate count rows.
   *
   * @param countRowIds - Count-row ids to expand.
   * @returns Every nudge rolled into those counts.
   * @example
   * const nudges = await sdk.recaps.listNudgesByCountRows(['count-1']);
   */
  listNudgesByCountRows(countRowIds: string[]): Promise<Nudge[]> {
    return this.call(recapsOperations.listNudgesByCountRows, { countRowIds });
  }
}
