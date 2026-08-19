export interface InstagramCredentials {
  accessToken: string;
  igUserId: string;
  username?: string; // e.g. "xyne.spaces" — stored for display and debugging
  expiresAt: number; // epoch ms — long-lived tokens expire after 60 days
}

export interface InstagramWebhookMessaging {
  sender: { id: string; username?: string };
  recipient: { id: string };
  timestamp: number;
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
