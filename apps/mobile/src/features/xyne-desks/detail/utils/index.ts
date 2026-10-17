export {
  getTicketDetailPaintCache,
  setTicketDetailPaintCache,
  clearTicketDetailPaintCache,
} from './ticket-detail-paint-cache';
export {
  mapTicketDetail,
  mapEmailRow,
  mapEmailRows,
  mergeEmailLists,
  mergeTicketDetailEmails,
  ticketEmailsLookIncomplete,
  visibleEmailAttachments,
  emailAttachmentCount,
  normalizeEmailSnapshots,
  type SupportTicketDetailRowLike,
  type EmailRowLike,
} from './map-ticket-detail';
export { mapTicketDetailsTab } from './map-ticket-details-tab';
export {
  asStringArray,
  normalizeEmailAddress,
  displayNameFromAddress,
} from './parse-email-addresses';
export { stripHtml } from './strip-html';
export { preprocessEmailHtml, looksLikeHtml, escapeHtml } from './preprocess-email-html';
export { emailHtmlToMarkdown } from './email-html-to-markdown';
export { buildEmailPreview } from './build-email-preview';
export { summarizeRecipients } from './summarize-recipients';
export { formatEmailHeaderDate, type EmailHeaderDate } from './format-email-header-date';
export {
  getEmailChainItemPosition,
  getEmailChainBorderRadius,
} from './get-email-chain-border-radius';
export {
  getDeskChannelKind,
  getChatDeskIntegration,
  getChatDeskReplyPath,
  isAppSourcedDeskTicket,
  shouldShowEmailHeaderChrome,
  type DeskChannelKind,
  type ChatDeskIntegration,
  type DeskSourceLike,
} from './desk-channel-kind';
export {
  resolveDeskMailboxIdentity,
  type DeskMailboxIdentity,
  type EmailChannelPreferenceSnapshot,
} from './resolve-desk-mailbox-identity';
