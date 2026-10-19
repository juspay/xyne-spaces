import { deleteKeys, getJson, setJson } from '@/src/services/localStorage';

import type { MailboxRecipient } from './mailbox-reply.utils';

export type MailboxComposeDraftSnapshot = {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  to: MailboxRecipient[];
  cc: MailboxRecipient[];
  bcc: MailboxRecipient[];
};

function composeDraftKey(channelId: string): string {
  return `mailbox-compose-draft:${channelId}`;
}

export function loadMailboxComposeDraft(channelId: string): MailboxComposeDraftSnapshot | null {
  const key = channelId.trim();
  if (!key) return null;
  return getJson<MailboxComposeDraftSnapshot>(composeDraftKey(key));
}

export function saveMailboxComposeDraft(
  channelId: string,
  draft: MailboxComposeDraftSnapshot,
): void {
  const key = channelId.trim();
  if (!key) return;
  setJson(composeDraftKey(key), draft);
}

export function clearMailboxComposeDraft(channelId: string): void {
  const key = channelId.trim();
  if (!key) return;
  deleteKeys([composeDraftKey(key)]);
}
