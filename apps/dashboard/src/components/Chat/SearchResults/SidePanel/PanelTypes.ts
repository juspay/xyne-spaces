import type { SearchResultsThread } from '../SearchResultsContext';

// Right-pane state for the full-screen search view. Each variant is a named type so its
// renderer in PANEL_RENDERERS (SidePanel.tsx) can type its props explicitly — no
// Extract/mapped-type gymnastics. New surfaces are added as a variant here + a renderer.
export type ThreadPanelState = { kind: 'thread'; thread: SearchResultsThread };

export type ProfilePanelState = { kind: 'profile'; userId: string };

export type ChannelPanelState = {
  kind: 'channel';
  channelId: string;
  // Optional: a plain channel/DM opens without anchoring to a specific message.
  conversationId?: string;
  conversationCreatedAt?: number;
  matchedMessageId?: string | null;
};

export type CanvasPanelState = { kind: 'canvas'; canvasId: string };

export type AttachmentPanelState = {
  kind: 'attachment';
  attachmentId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

// A desk/support ticket (or desk mail) hosted in the pane. SupportTicketDetail is URL-driven, so
// DeskTicketPanel replays these into a synthetic route location (see SidePanel.tsx).
export type DeskTicketPanelState = {
  kind: 'deskTicket';
  title: string; // mail subject / ticket title, shown in the pane header
  channelId: string;
  ticketXyneId: string; // ticket public id → synthetic URL :ticketId
  ticketId: string; // db id → router state (SupportTicketDetail reads location.state.ticketId)
  conversationId: string;
  mailId?: string; // desk-mail only → ?mail= deep-link scroll target
};

export type SidePanelState =
  | ThreadPanelState
  | ProfilePanelState
  | ChannelPanelState
  | CanvasPanelState
  | AttachmentPanelState
  | DeskTicketPanelState
  | null;

export type PanelKind = NonNullable<SidePanelState>['kind'];
