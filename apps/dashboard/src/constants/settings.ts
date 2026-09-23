export const MEETING_DETECTION_ENABLED_KEY = 'xyne-meeting-detection-enabled';

/**
 * Frequently used emoji ranking (see `utils/frequentEmojis.ts`). The key is a prefix: the
 * real key appends `:<workspaceId>:<userId>`, because custom emoji ids are workspace scoped.
 */
export const FREQUENT_EMOJIS_STORAGE_KEY_PREFIX = 'xyne_frequent_emojis';

/** Entries kept per scope. Beyond this the least-used tail is evicted. */
export const FREQUENT_EMOJIS_MAX_TRACKED = 50;

/** Emojis shown in the picker's Frequently Used row. */
export const FREQUENT_EMOJI_DISPLAY_LIMIT = 8;

/** One-click emojis shown inline on the message hover toolbar. */
export const INLINE_QUICK_REACTION_LIMIT = 3;

/**
 * Padding for the inline strip so it always shows `INLINE_QUICK_REACTION_LIMIT` buttons,
 * including for a user who has never reacted.
 */
export const DEFAULT_QUICK_REACTIONS = ['\u{1F44D}', '\u2705', '\u{1F440}'];
