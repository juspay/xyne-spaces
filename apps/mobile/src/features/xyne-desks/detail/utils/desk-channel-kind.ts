export type DeskChannelKind = 'mailbox' | 'chat' | 'unknown';
export type ChatDeskIntegration = 'slack-desk' | 'app-desk';

export type DeskSourceLike = {
  type?: string | null | undefined;
} | null;

/** EMAIL uses the mailbox composer. SLACK and APP use the thread composer. */
export const getDeskChannelKind = (type: string | null | undefined): DeskChannelKind => {
  const normalized = (type ?? '').trim().toUpperCase();
  if (normalized === 'EMAIL') return 'mailbox';
  if (normalized === 'SLACK' || normalized === 'APP') return 'chat';
  return 'unknown';
};

/** App-installed tickets on an EMAIL desk still use chat-style chrome (dashboard parity). */
export const isAppSourcedDeskTicket = (deskSource: DeskSourceLike | undefined): boolean =>
  (deskSource?.type ?? '').trim().toLowerCase() === 'app';

/**
 * Gmail From/To/Cc/Bcc/Date expand — mailbox EMAIL only.
 * Hidden for APP / SLACK desks and for app-sourced tickets on any channel.
 *
 * Intentional mobile split (vs dashboard): `deskSource.type === 'app'` only gates
 * this header chrome today. Mailbox reply bar / chat composer still follow
 * `channel.type` via `getDeskChannelKind`. Dashboard uses one reply-kind for
 * thread + composer; unifying that on mobile is a follow-up.
 */
export const shouldShowEmailHeaderChrome = (
  channelType: string | null | undefined,
  deskSource?: DeskSourceLike,
): boolean => {
  if (isAppSourcedDeskTicket(deskSource)) return false;
  return getDeskChannelKind(channelType) === 'mailbox';
};

export const getChatDeskIntegration = (
  type: string | null | undefined,
): ChatDeskIntegration | null => {
  const normalized = (type ?? '').trim().toUpperCase();
  if (normalized === 'SLACK') return 'slack-desk';
  if (normalized === 'APP') return 'app-desk';
  return null;
};

export const getChatDeskReplyPath = (
  type: string | null | undefined,
  conversationId: string,
): string | null => {
  const integration = getChatDeskIntegration(type);
  const id = conversationId.trim();
  if (!integration || !id) return null;
  return `/integrations/${integration}/${encodeURIComponent(id)}/reply`;
};
