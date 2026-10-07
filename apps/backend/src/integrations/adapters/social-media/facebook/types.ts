export interface FacebookCredentials {
  // Page access token derived from a long-lived user token — does not expire on its own.
  pageAccessToken: string;
  pageId: string; // equals webhook entry.id
  pageName?: string;
  // App-scoped id of the Facebook user who connected the Page; matched by the data-deletion callback.
  fbUserId?: string;
}

export interface FacebookWebhookMessaging {
  sender: { id: string; name?: string }; // id is the PSID; name is filled in by flow.ts
  recipient: { id: string };
  timestamp: number; // Unix ms
  message: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type: string; payload?: { url?: string } }>;
  };
  /** Set by flow.ts for message_edit events — tells the transformer to update the existing message body. */
  isContentUpdate?: boolean;
  /** Set by historyFetcher.ts — a fetched item (manual fetch or hourly catch-up), not a live webhook. */
  fromFetch?: boolean;
}

// `feed` webhook field, item=comment.
export interface FacebookFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string; // the post id for a top-level comment, the parent comment id for a reply
  from?: { id: string; name?: string };
  message?: string;
  created_time?: number; // Unix seconds
}

// `mention` webhook field — another Page or person @mentioned this Page.
export interface FacebookMentionValue {
  item?: string; // 'post' | 'comment'
  verb?: string;
  post_id?: string;
  comment_id?: string;
  sender_id?: string;
  sender_name?: string;
  message?: string;
  created_time?: number; // Unix seconds
}

export interface FacebookWebhookChange {
  field: string;
  value: FacebookFeedValue | FacebookMentionValue;
}

// Normalized comment/mention event produced by flow.ts.
export interface FacebookWebhookComment {
  type: 'comment' | 'mention';
  senderName: string;
  senderId: string;
  text: string;
  commentId?: string; // thread key: parent comment id for replies, own id otherwise
  rawCommentId?: string; // actual comment id — unique externalId per reply
  postId?: string;
  permalink?: string; // opens the comment (or the post) on Facebook
  fromFetch?: boolean; // see FacebookWebhookMessaging.fromFetch
  timestamp: number; // Unix ms
}

export interface FacebookWebhookEntry {
  id: string; // Page id
  time: number;
  messaging?: Array<Record<string, unknown>>;
  changes?: FacebookWebhookChange[];
}

export interface FacebookWebhookPayload {
  object: string; // 'page'
  entry: FacebookWebhookEntry[];
}
