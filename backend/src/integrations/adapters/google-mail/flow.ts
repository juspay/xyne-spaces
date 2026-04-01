import { convert } from 'html-to-text';
import type { gmail_v1 } from 'googleapis';
import { BaseFlow } from '../../core/baseFlow';
import { downloadGmailAttachments } from '@/integrations/google-mail/attachmentService';
import type { GoogleMailPreprocessedPayload, GoogleMailRawPayload } from './types';
import { parseEmailBody } from './quote-parser';

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
};

const collectBodyParts = (
  payload?: gmail_v1.Schema$MessagePart
): { plainTextParts: string[]; htmlParts: string[] } => {
  if (!payload) {
    return {
      plainTextParts: [],
      htmlParts: [],
    };
  }

  const plainTextParts: string[] = [];
  const htmlParts: string[] = [];

  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) {
      return;
    }

    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === 'text/plain') {
        plainTextParts.push(decoded);
      } else if (part.mimeType === 'text/html') {
        htmlParts.push(decoded);
      }
    }

    for (const child of part.parts || []) {
      walk(child);
    }
  };

  walk(payload);
  return {
    plainTextParts,
    htmlParts,
  };
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const plainTextToHtml = (value: string): string => {
  if (!value.trim()) {
    return '<div></div>';
  }

  return value
    .split('\n')
    .map(line => `<div>${escapeHtml(line) || '<br />'}</div>`)
    .join('');
};

export class GoogleMailFlow extends BaseFlow {
  async preprocess(rawPayload: GoogleMailRawPayload): Promise<GoogleMailPreprocessedPayload> {
    const { message, mailboxEmail, gmail } = rawPayload;
    const { plainTextParts, htmlParts } = collectBodyParts(message.payload);

    const combinedPlainText = plainTextParts.join('\n').trim();
    const plainTextFromHtml =
      combinedPlainText ||
      convert(htmlParts.join('\n'), {
        wordwrap: false,
      }).trim();

    const cleanedBody = parseEmailBody(plainTextFromHtml).trim() || plainTextFromHtml;
    const bodyHtml = plainTextToHtml(cleanedBody);
    const downloadedAttachments = await downloadGmailAttachments(gmail, message, mailboxEmail);

    return {
      message,
      mailboxEmail,
      bodyHtml,
      bodyText: cleanedBody,
      downloadedAttachments,
    };
  }
}
