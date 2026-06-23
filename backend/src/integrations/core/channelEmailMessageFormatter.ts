import type { NormalizedData } from './types';

export interface ChannelEmailMessageMetadata {
  messageSubtype: 'channel_email';
  subject: string;
  from: string;
  to: string;
  cc: string[];
  bcc: string[];
}

export function buildChannelEmailMessageMetadata(
  normalizedData: NormalizedData,
  channelDisplayName?: string,
): ChannelEmailMessageMetadata | null {
  const emailData = normalizedData.emailData;
  if (!emailData) {
    return null;
  }

  return {
    messageSubtype: 'channel_email',
    subject: emailData.subject || '',
    from: emailData.from || '',
    to: channelDisplayName || (emailData.to || []).join(', '),
    cc: emailData.cc || [],
    bcc: emailData.bcc || [],
  };
}
