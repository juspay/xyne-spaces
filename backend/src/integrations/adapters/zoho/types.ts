/**
 * Zoho webhook payload types
 * Based on Zoho Desk API structure
 */

/**
 * Main Zoho webhook payload structure
 */
export interface ZohoWebhookPayload {
  eventType: string;  // "Ticket_Add", "Ticket_Thread_Add", "Ticket_Update"
  payload: ZohoPayload;
  eventTime?: string;
  orgId?: string;
}

export interface ZohoPayload {
  id: string;  // This is the ticketId for Ticket_Add events
  ticketNumber?: string;
  subject?: string;
  webUrl?: string;
  departmentId: string;
  email?: string;
  contact?: ZohoContact;
  channel?: string; // "Email", "Phone", "Web", etc.
  status?: string;
  priority?: string;

  // For Ticket_Add events (email channel)
  ticketId?: string;
  firstThread?: ZohoThread;

  // For Ticket_Add events (phone/web channel)
  description?: string;

  // For Ticket_Thread_Add events
  threadId?: string;
  content?: string;
  fromEmailAddress?: string;
  to?: string;
  cc?: string; // Comma-separated email addresses
  bcc?: string; // Comma-separated email addresses
  replyTo?: string;
  createdTime?: string;
  attachments?: ZohoAttachment[];
  isPublic?: boolean; // false for internal notes
  visibility?: string; // "private" or "public"
  direction?: string; // "in", "out", "inbound", "outbound"

  // Common fields
  assignee?: ZohoAssignee;
  ticketContacts?: ZohoContact[]; // Additional contacts on ticket
}

export interface ZohoContact {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  mobile?: string;
  id: string;
}

export interface ZohoThread {
  id?: string;
  content: string;
  fromEmailAddress?: string;
  author?: {
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    type?: string; // "agent", "customer", "staff"
    id?: string;
  };
  to?: string;
  cc?: string; // Comma-separated email addresses
  bcc?: string; // Comma-separated email addresses
  replyTo?: string;
  subject?: string; // Subject for email threads
  createdTime: string;
  ticketId: string;
  departmentId: string;
  direction?: string; // "in", "out", "inbound", "outbound"
  summary?: string;
  visibility?: string; // "private" or "public"
  isPublic?: boolean;
  hasAttach?: boolean;
  attachments?: ZohoAttachment[];
  attachmentCount?: string;
  status?: string;
}

export interface ZohoAttachment {
  name: string;
  href?: string;
  url?: string;
  size: number;
  contentType?: string;
}

export interface ZohoAssignee {
  firstName?: string;
  lastName?: string;
  email?: string;
  id?: string;
}

/**
 * Zoho event types
 */
export enum ZohoEventType {
  TICKET_ADD = 'Ticket_Add',
  TICKET_UPDATE = 'Ticket_Update',
  TICKET_THREAD_ADD = 'Ticket_Thread_Add',
  TICKET_DELETE = 'Ticket_Delete',
}
