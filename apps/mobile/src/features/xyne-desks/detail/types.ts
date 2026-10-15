/**
 * Serializable snapshots for the ticket detail screen.
 * Components never speak Zero row types directly.
 */

export type TicketDetailTabId = 'email' | 'messages' | 'details';

/** Subset of ticket.metadata.deskSource used for thread chrome / reply kind. */
export type TicketDetailDeskSource = {
  type: string;
};

export type TicketDetailSnapshot = {
  id: string;
  xyneId: string;
  title: string;
  channelId: string;
  status: string | null;
  stageName: string | null;
  priority: string | null;
  assignedTo: string | null;
  isArchived: boolean;
  emailCount: number;
  lastEmailAt: number | null;
  conversationId: string | null;
  /**
   * Present when the ticket was created via an installed app (may sit on an EMAIL channel).
   * Optional so legacy paint-cache snapshots without the field keep stable identity.
   */
  deskSource?: TicketDetailDeskSource | null;
  emails: TicketDetailEmailSnapshot[];
  emailDrafts: TicketDetailDraftSnapshot[];
  emailReads: TicketDetailReadSnapshot[];
  conversation: { id: string } | null;
};

/** Aligns with Zero `emailTable` fields used by dashboard EmailThread. */
export type TicketDetailEmailAttachmentSnapshot = {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  metadata?: { contentId?: string; isInline?: boolean } | null;
};

export type TicketDetailEmailSnapshot = {
  id: string;
  type: string | null;
  subject: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  body: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  externalThreadId: string | null;
  externalMessageId: string | null;
  attachmentCount: number;
  attachments: TicketDetailEmailAttachmentSnapshot[];
};

export type TicketDetailDraftSnapshot = {
  id: string;
  userId: string | null;
  draftContent: string | null;
  autoDraftStatus: string | null;
};

export type TicketDetailReadSnapshot = {
  userId: string;
  lastReadEmailAt: number | null;
};

export type EmailRecipientSummary = {
  label: string;
  hasMultiple: boolean;
};

/** Position inside the continuous Gmail-style email chain card. */
export type EmailChainItemPosition = 'single' | 'first' | 'middle' | 'last';

export type TicketDetailsTabSnapshot = {
  id: string;
  xyneId: string;
  title: string;
  description: string | null;
  status: string | null;
  stageName: string | null;
  priority: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  eta: number | null;
  boardName: string | null;
  projectName: string | null;
  labels: string[];
};
