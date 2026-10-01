export interface InstagramCredentials {
  accessToken: string;
  // igUserId: real Instagram user ID — returned as `user_id` from GET /me.
  //   Equals webhook entry.id. Used for source name, externalIdentifier, and B2 filter.
  igUserId: string;
  // igsid: app-scoped IGSID — returned as `id` from GET /me.
  //   Used ONLY for API calls: POST /{igsid}/subscribed_apps, POST /{igsid}/messages, getSenderUsername.
  //   Does NOT equal webhook entry.id.
  igsid?: string;
  username?: string; // IG @handle — stored for display and debugging
  expiresAt: number; // epoch ms — long-lived tokens expire after 60 days
}

export interface InstagramWebhookMessaging {
  sender: { id: string; username?: string };
  recipient: { id: string };
  timestamp: number; // Unix ms — Meta sends 13-digit millisecond timestamps
  message: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{
      type: string;
      payload: { url: string };
    }>;
  };
  /** Set by flow.ts for message_edit events with num_edit > 0 — signals transformer to update existing message body rather than insert. */
  isContentUpdate?: boolean;
}

// Payload for the `mentions` webhook field — Meta delivers only IDs; text must be fetched via API.
export interface InstagramMentionValue {
  comment_id?: string; // present when mentioned in a comment; absent for caption mentions
  media_id: string;
}

// Payload for the `comments` webhook field — text is delivered inline.
export interface InstagramCommentValue {
  id: string;
  text: string;
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
  parent_id?: string; // absent from Meta's webhook payload; fetched via getCommentDetails API
  timestamp?: string | number;
}

export interface InstagramWebhookChange {
  field: string;
  value: InstagramMentionValue | InstagramCommentValue | Record<string, unknown>;
}

// Normalized mention/comment event produced by flow.ts for Cases 1, 2, and 3.
// type='mention': @mention in someone else's comment or caption (webhook field: mentions)
// type='comment': comment on the business account's own post (webhook field: comments)
export interface InstagramWebhookComment {
  type: 'mention' | 'comment';
  senderUsername: string; // @handle of the person who mentioned/commented
  senderId: string; // IGSID of the sender (may be empty for caption mentions without owner)
  text: string;
  commentId?: string; // thread key: parent_id for replies, own id for top-level comments
  rawCommentId?: string; // actual comment id — used as externalId to deduplicate individual replies
  mediaId?: string; // IG media ID; absent for IG-Login mention-via-messages (no comment_id available)
  mid?: string; // message ID; used as unique key when neither commentId nor mediaId is available
  timestamp: number; // Unix ms
}

export interface InstagramWebhookEntry {
  id: string; // IG Business Account ID
  time: number;
  messaging?: InstagramWebhookMessaging[];
  changes?: InstagramWebhookChange[];
}

export interface InstagramWebhookPayload {
  object: string; // 'instagram'
  entry: InstagramWebhookEntry[];
}
