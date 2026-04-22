/**
 * Microsoft Graph API webhook types
 */

/**
 * Graph API change notification payload
 * https://learn.microsoft.com/en-us/graph/api/resources/changenotification
 */
export interface GraphChangeNotification {
  value: GraphNotificationItem[];
  validationTokens?: string[];
}

export interface GraphNotificationItem {
  changeType: 'created' | 'updated' | 'deleted';
  clientState?: string;
  resource: string; // e.g. "Users/{user-id}/Messages/{message-id}"
  resourceData?: {
    '@odata.type': string;
    '@odata.id': string;
    '@odata.etag': string;
    id: string;
  };
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  tenantId: string;
  encryptedContent?: unknown;
}

/**
 * Microsoft Graph mail message (simplified)
 * https://learn.microsoft.com/en-us/graph/api/resources/message
 */
export interface GraphMailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: 'text' | 'html';
    content: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  ccRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  bccRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  replyTo: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  conversationId: string;
  internetMessageId: string;
  receivedDateTime: string;
  hasAttachments: boolean;
  parentFolderId: string;
}
