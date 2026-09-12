export interface InstagramCredentials {
  accessToken: string;
  // igUserId: real Instagram user ID — returned as `user_id` from GET /me.
  //   Matches webhook entry.id. Used for the B2 filter and as the source name suffix.
  igUserId: string;
  // igsid: app-scoped Instagram-Scoped User ID — returned as `id` from GET /me.
  //   Required for all Meta Graph API calls (/{igsid}/messages, /{igsid}/subscribed_apps).
  //   Always differs from igUserId. Optional only for backward compat with credentials
  //   created before this field was added; all new credentials will have it.
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

export interface InstagramWebhookEntry {
  id: string; // IG Business Account ID
  time: number;
  messaging: InstagramWebhookMessaging[];
}

export interface InstagramWebhookPayload {
  object: string; // 'instagram'
  entry: InstagramWebhookEntry[];
}
