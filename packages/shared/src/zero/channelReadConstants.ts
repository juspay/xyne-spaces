/**
 * Upper bound on channels per `channel.markChannelsAsViewed` call. Each channel
 * costs a handful of reads and 1 + K writes inside one transaction, so the cap
 * keeps a single "mark section as read" commit small. Callers with more channels
 * split the list into chunks of this size.
 */
export const MARK_CHANNELS_VIEWED_MAX_BATCH = 25;
