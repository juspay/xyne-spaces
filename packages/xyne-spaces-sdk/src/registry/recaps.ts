/**
 * Recaps Operation Registry
 *
 * Generated daily summaries of channel and project activity, their
 * subscriptions and read state, plus the entity-level nudge queries.
 *
 * Recaps are addressed by date: every read takes a `recapDate` in epoch
 * milliseconds identifying the day being summarised.
 *
 * Message-level nudges and the dismiss/act operations live on
 * `sdk.activities`, since that is where a user encounters them.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { Recap } from '../types/index.js';

export const recapsOperations = {
  // ----- Reads -----

  /**
   * Recaps for several channels on one day.
   * Maps to: Zero query 'channelRecaps'
   */
  listForChannels: query<{ channelIds: string[]; recapDate: number }, Recap[]>(
    'channelRecaps'
  ),

  /**
   * Daily recap rows for several channels, including per-user variants.
   * Maps to: Zero query 'channelDailyRecaps'
   */
  listDaily: query<{ channelIds: string[]; recapDate: number }, Recap[]>(
    'channelDailyRecaps'
  ),

  /**
   * Project recaps for a day.
   * Maps to: Zero query 'projectRecaps'
   */
  listForProjects: query<{ recapDate: number }, Recap[]>('projectRecaps'),

  /**
   * Nudges attached to an entity such as a ticket.
   * Maps to: Zero query 'entityNudges'
   */
  listEntityNudges: query<{ sourceId: string; states?: string[] }, unknown[]>(
    'entityNudges'
  ),

  /**
   * Nudges behind aggregate counts, resolved by count-row id.
   * Maps to: Zero query 'surfaceNudgesByCountRowIds'
   */
  listNudgesByCountRows: query<{ countRowIds: string[] }, unknown[]>(
    'surfaceNudgesByCountRowIds'
  ),

  // ----- Writes -----

  /**
   * Replace the set of channels the user gets recaps for.
   *
   * This is the whole subscription list, not an addition — send every channel
   * you want subscribed.
   * Maps to: Zero mutator 'recap.saveSubscriptions'
   */
  saveSubscriptions: mutator<{ channelIds: string[] }, void>('recap.saveSubscriptions', {
    mapArgs: (args) => ({ channelIds: args.channelIds, timestamp: now() }),
  }),

  /**
   * Set a custom prompt shaping how a channel's recap is written.
   * Maps to: Zero mutator 'recap.setCustomRecapPrompt'
   */
  setCustomPrompt: mutator<{ channelId: string; prompt: string }, void>(
    'recap.setCustomRecapPrompt',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Mark a whole day's recaps seen.
   * Maps to: Zero mutator 'recap.markSeen'
   */
  markSeen: mutator<{ recapDate: number }, void>('recap.markSeen', {
    mapArgs: (args) => ({ recapDate: args.recapDate, timestamp: now() }),
  }),

  /**
   * Mark one channel's recap read.
   * Maps to: Zero mutator 'recap.markChannelRecapAsRead'
   */
  markChannelRead: mutator<{ channelId: string; recapDate: number }, void>(
    'recap.markChannelRecapAsRead',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Mark one channel's recap unread again.
   * Maps to: Zero mutator 'recap.markChannelRecapAsUnread'
   */
  markChannelUnread: mutator<{ channelId: string }, void>(
    'recap.markChannelRecapAsUnread',
    {
      mapArgs: (args) => ({ channelId: args.channelId, timestamp: now() }),
    }
  ),
} as const;
