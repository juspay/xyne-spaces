
export enum SignalType {
  // Channel interaction signals
  CHANNEL_MESSAGE_SENT = 'channel_message_sent',
  CHANNEL_DM_MESSAGE_SENT = 'channel_dm_message_sent',
  CHANNEL_THREAD_REPLY = 'channel_thread_reply',
  CHANNEL_DM_THREAD_REPLY = 'channel_dm_thread_reply',
  CHANNEL_REACTION_ADDED = 'channel_reaction_added',
  CHANNEL_MENTIONED_IN = 'channel_mentioned_in', // NEW: When user gets mentioned in a channel

  // User interaction signals
  USER_MENTIONED = 'user_mentioned',
  USER_DM_SENT = 'user_dm_sent',
  USER_DM_RECEIVED = 'user_dm_received',
  USER_REPLIED_TO = 'user_replied_to',

  // Search interaction signals
  SEARCH_RESULT_CLICKED = 'search_result_clicked',
  SEARCH_CHANNEL_SELECTED = 'search_channel_selected',
}

export enum SignalCategory {
  CHANNEL = 'channel',
  USER = 'user',
}

/**
 * Signal configuration for each signal type
 */
export interface SignalConfig {
  type: SignalType;
  category: SignalCategory;
  defaultWeight: number;
  description: string;
  redisKeyPattern: string; // Pattern for Redis key
}


export const SIGNAL_CONFIGS: Record<SignalType, SignalConfig> = {
  [SignalType.CHANNEL_MESSAGE_SENT]: {
    type: SignalType.CHANNEL_MESSAGE_SENT,
    category: SignalCategory.CHANNEL,
    defaultWeight: 1.0,
    description: 'User sends a regular message in a channel',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.CHANNEL_DM_MESSAGE_SENT]: {
    type: SignalType.CHANNEL_DM_MESSAGE_SENT,
    category: SignalCategory.CHANNEL,
    defaultWeight: 2.0,
    description: 'User sends a message in a DM/Group DM channel',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.CHANNEL_THREAD_REPLY]: {
    type: SignalType.CHANNEL_THREAD_REPLY,
    category: SignalCategory.CHANNEL,
    defaultWeight: 1.5,
    description: 'User replies in a thread (shows deeper engagement)',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.CHANNEL_DM_THREAD_REPLY]: {
    type: SignalType.CHANNEL_DM_THREAD_REPLY,
    category: SignalCategory.CHANNEL,
    defaultWeight: 2.5,
    description: 'User replies in a DM thread',
    redisKeyPattern: 'user:{userId}:deltas'
  },


  [SignalType.CHANNEL_REACTION_ADDED]: {
    type: SignalType.CHANNEL_REACTION_ADDED,
    category: SignalCategory.CHANNEL,
    defaultWeight: 0.5,
    description: 'User adds a reaction to a message',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.CHANNEL_MENTIONED_IN]: {
    type: SignalType.CHANNEL_MENTIONED_IN,
    category: SignalCategory.CHANNEL,
    defaultWeight: 1.2,
    description: 'User gets mentioned in a channel (boosts channel importance for mentioned user)',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.USER_MENTIONED]: {
    type: SignalType.USER_MENTIONED,
    category: SignalCategory.USER,
    defaultWeight: 1.5,
    description: 'User mentions another user',
    redisKeyPattern: 'user:{userId}:user_deltas'
  },

  [SignalType.USER_DM_SENT]: {
    type: SignalType.USER_DM_SENT,
    category: SignalCategory.USER,
    defaultWeight: 2.0,
    description: 'User sends a direct message (outbound)',
    redisKeyPattern: 'user:{userId}:user_deltas'
  },

  [SignalType.USER_DM_RECEIVED]: {
    type: SignalType.USER_DM_RECEIVED,
    category: SignalCategory.USER,
    defaultWeight: 0.5,
    description: 'User receives a direct message (inbound)',
    redisKeyPattern: 'user:{userId}:user_deltas'
  },

  [SignalType.USER_REPLIED_TO]: {
    type: SignalType.USER_REPLIED_TO,
    category: SignalCategory.USER,
    defaultWeight: 1.3,
    description: 'User replies to another user in a thread',
    redisKeyPattern: 'user:{userId}:user_deltas'
  },

  // below defined signals we will use when we want to track the sematic and lexical contribution in search result
  [SignalType.SEARCH_RESULT_CLICKED]: {
    type: SignalType.SEARCH_RESULT_CLICKED,
    category: SignalCategory.CHANNEL,
    defaultWeight: 1.2,
    description: 'User clicks on a search result from a channel',
    redisKeyPattern: 'user:{userId}:deltas'
  },

  [SignalType.SEARCH_CHANNEL_SELECTED]: {
    type: SignalType.SEARCH_CHANNEL_SELECTED,
    category: SignalCategory.CHANNEL,
    defaultWeight: 0.8,
    description: 'User selects a channel from search results',
    redisKeyPattern: 'user:{userId}:deltas'
  },
};

/**
 * Signal payload interfaces
 */
export interface ChannelSignalPayload {
  userId: string;
  channelId: string;
  signalType: SignalType;
  weight?: number; // Optional override of default weight
  metadata?: Record<string, any>; // Optional metadata for debugging
}

export interface UserSignalPayload {
  fromUserId: string;
  toUserId: string;
  signalType: SignalType;
  weight?: number;
  metadata?: Record<string, any>;
}

/**
 * Generic signal payload (union type)
 */
export type SignalPayload = ChannelSignalPayload | UserSignalPayload;

/**
 * Signal capture result
 */
export interface SignalCaptureResult {
  success: boolean;
  signalType: SignalType;
  error?: Error;
}
