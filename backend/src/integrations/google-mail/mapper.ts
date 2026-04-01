import { convert } from 'html-to-text';
import type { gmail_v1 } from 'googleapis';
import {
  Apps,
  type Attachment,
  type Mail,
  type MailAttachment,
  MailAttachmentEntity,
  MailEntity,
} from '@xyne/vespa-ts';
import { parseEmailBody } from '@/integrations/adapters/google-mail/quote-parser';
import {
  coerceExtractedEntityTags,
  isExtractedEntityTagsEmpty,
  type ExtractedEntityTags,
} from '@/services/entityTagExtractor';

const MAIL_CHUNK_MAX_SIZE_BYTES = 512;
const MAIL_CHUNK_OVERLAP_BYTES = 128;

export interface GmailAttachmentPart {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  partId?: string | null;
}

export interface PreparedGmailMailMapping {
  docId: string;
  messageId: string;
  threadId: string;
  mailId: string;
  subject: string;
  chunks: string[];
  timestamp: number;
  parentThreadId: string;
  permissions: string[];
  normalizedMailboxEmail: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  mimeType: string;
  attachmentFilenames: string[];
  attachments: Attachment[];
  labels: string[];
  attachmentParts: GmailAttachmentPart[];
  entityTags?: ExtractedEntityTags;
}

export interface ExistingGmailMailDocumentState {
  docId?: string;
  userMap?: Record<string, string>;
}

export interface GmailAttachmentDocumentInput {
  docId: string;
  messageId: string;
  threadId: string;
  timestamp: number;
  permissions: string[];
  filename: string;
  mimeType: string;
  size: number;
  partId?: string | null;
  chunks: string[];
}

interface GmailMailEntityTagFields {
  entityPeople?: string[];
  entityProducts?: string[];
  entityMerchants?: string[];
}

type MappedGmailMailDocument = Mail & GmailMailEntityTagFields;

const decodeGmailBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
};

const sanitizeGmailTextForVespa = (value: string): string => {
  return value
    .normalize('NFC')
    .replace(/\r\n|\r/g, '\n')
    .replace(
      /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F\uFDD0-\uFDEF\uFFFE\uFFFF]/g,
      ''
    )
    .trim();
};

const getGmailByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

export const chunkGmailTextByParagraph = (
  text: string,
  maxChunkSize = MAIL_CHUNK_MAX_SIZE_BYTES,
  overlap = MAIL_CHUNK_OVERLAP_BYTES
): string[] => {
  const cleanedText = sanitizeGmailTextForVespa(text);
  if (!cleanedText) {
    return [];
  }

  const paragraphs = cleanedText.split(/\n+/).filter(Boolean);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;

  const addChunk = (chunkParts: string[]) => {
    const chunk = chunkParts.join('\n').trim();
    if (!chunk) {
      return;
    }

    chunks.push(chunk);

    if (overlap <= 0) {
      currentChunk = [];
      currentLength = 0;
      return;
    }

    let overlapBytes = 0;
    const overlapChunk: string[] = [];

    for (let index = chunkParts.length - 1; index >= 0; index -= 1) {
      const paragraph = chunkParts[index];
      const paragraphBytes = getGmailByteLength(paragraph) + 1;
      if (overlapBytes + paragraphBytes > overlap) {
        break;
      }

      overlapChunk.unshift(paragraph);
      overlapBytes += paragraphBytes;
    }

    currentChunk = overlapChunk;
    currentLength = overlapBytes;
  };

  for (const paragraph of paragraphs) {
    const paragraphBytes = getGmailByteLength(paragraph) + 1;

    if (paragraphBytes > maxChunkSize) {
      if (currentLength > 0) {
        addChunk(currentChunk);
      }

      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
      let subChunk: string[] = [];
      let subChunkLength = 0;

      for (const sentence of sentences) {
        const sentenceBytes = getGmailByteLength(sentence) + 1;
        if (subChunkLength + sentenceBytes > maxChunkSize && subChunk.length > 0) {
          addChunk(subChunk);
          subChunk = [];
          subChunkLength = 0;
        }

        subChunk.push(sentence);
        subChunkLength += sentenceBytes;
      }

      if (subChunk.length > 0) {
        addChunk(subChunk);
      }

      continue;
    }

    if (currentLength + paragraphBytes > maxChunkSize && currentChunk.length > 0) {
      addChunk(currentChunk);
      currentChunk = [paragraph];
      currentLength = paragraphBytes;
      continue;
    }

    currentChunk.push(paragraph);
    currentLength += paragraphBytes;
  }

  if (currentChunk.length > 0) {
    addChunk(currentChunk);
  }

  return chunks;
};

export const normalizeGmailMimeType = (mimeType: string | null | undefined): string => {
  return (mimeType || 'application/octet-stream').toLowerCase().split(';')[0].trim();
};

export const parseGmailAttachmentPartId = (partId?: string | null): number | null => {
  if (!partId) {
    return null;
  }

  const parsed = parseInt(partId, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export const getGmailMailAttachmentEntity = (mimeType: string): MailAttachmentEntity => {
  switch (mimeType) {
    case 'application/pdf':
      return MailAttachmentEntity.PDF;
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return MailAttachmentEntity.Sheets;
    case 'text/csv':
      return MailAttachmentEntity.CSV;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return MailAttachmentEntity.WordDocument;
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/vnd.ms-powerpoint':
      return MailAttachmentEntity.PowerPointPresentation;
    case 'text/plain':
    case 'text/html':
    case 'text/markdown':
      return MailAttachmentEntity.Text;
    default:
      return MailAttachmentEntity.NotValid;
  }
};

const extractGmailEmailAddresses = (headerValue: string): string[] => {
  if (!headerValue) {
    return [];
  }

  return headerValue
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      const match = value.match(/<([^>]+)>/);
      return (match?.[1] || value).trim().toLowerCase();
    });
};

const collectGmailBodyParts = (
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
      const decoded = decodeGmailBase64Url(part.body.data).toString('utf8');
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

const getGmailMailBodyText = (payload?: gmail_v1.Schema$MessagePart): string => {
  const { plainTextParts, htmlParts } = collectGmailBodyParts(payload);
  const combinedPlainText = plainTextParts.join('\n').trim();

  const textSource =
    combinedPlainText ||
    convert(htmlParts.join('\n'), {
      wordwrap: false,
    }).trim();

  return sanitizeGmailTextForVespa(parseEmailBody(textSource).replace(/[\r?\n]+/g, '\n'));
};

const collectGmailAttachmentParts = (payload?: gmail_v1.Schema$MessagePart): GmailAttachmentPart[] => {
  if (!payload) {
    return [];
  }

  const collected: GmailAttachmentPart[] = [];

  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) {
      return;
    }

    if (part.filename && part.body?.attachmentId) {
      collected.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: normalizeGmailMimeType(part.mimeType),
        size: part.body.size || 0,
        partId: part.partId,
      });
    }

    for (const child of part.parts || []) {
      walk(child);
    }
  };

  walk(payload);
  return collected;
};

const buildGmailAttachmentSummaries = (
  attachmentParts: GmailAttachmentPart[]
): { attachments: Attachment[]; attachmentFilenames: string[] } => {
  const attachments: Attachment[] = [];
  const attachmentFilenames: string[] = [];

  for (const part of attachmentParts) {
    attachmentFilenames.push(part.filename);
    attachments.push({
      fileType: part.mimeType || 'application/octet-stream',
      fileSize: part.size || 0,
    });
  }

  return { attachments, attachmentFilenames };
};

export const prepareGmailMailMapping = (
  message: gmail_v1.Schema$Message,
  mailboxEmail: string
): PreparedGmailMailMapping => {
  const messageId = message.id;
  const threadId = message.threadId;
  const labels = message.labelIds || [];
  const payload = message.payload;
  const headers = payload?.headers || [];

  if (!messageId || !threadId) {
    throw new Error('Invalid Gmail message: missing id or threadId');
  }

  const getHeader = (name: string): string => {
    const header = headers.find(item => item.name?.toLowerCase() === name.toLowerCase());
    return header?.value || '';
  };

  const fromEmailArray = extractGmailEmailAddresses(getHeader('From'));
  if (fromEmailArray.length === 0) {
    throw new Error(`Could not resolve From header for Gmail message ${messageId}`);
  }

  const from = fromEmailArray[0];
  const to = extractGmailEmailAddresses(getHeader('To') || getHeader('Delivered-To'));
  const cc = extractGmailEmailAddresses(getHeader('Cc'));
  const bcc = extractGmailEmailAddresses(getHeader('Bcc'));
  const subject = getHeader('Subject') || '';
  const reference = getHeader('References') || '';
  const inReplyTo = getHeader('In-Reply-To') || '';

  let firstReferenceId = '';
  if (reference) {
    const match = reference.match(/<([^>]+)>/);
    if (match?.[1]) {
      firstReferenceId = match[1];
    }
  }

  const mailId = getHeader('Message-Id')?.replace(/^<|>$/g, '') || messageId;
  let parentThreadId = mailId;
  if (reference && firstReferenceId) {
    parentThreadId = firstReferenceId;
  } else if (inReplyTo) {
    parentThreadId = inReplyTo.replace(/^<|>$/g, '');
  }

  let timestamp = parseInt(message.internalDate || '0', 10) || Date.now();
  const dateHeader = getHeader('Date');
  if (dateHeader) {
    const parsedDate = new Date(dateHeader);
    if (!Number.isNaN(parsedDate.getTime())) {
      timestamp = parsedDate.getTime();
    }
  }

  const normalizedMailboxEmail = mailboxEmail.trim().toLowerCase();
  const permissions = Array.from(
    new Set(
      [normalizedMailboxEmail, from, ...to, ...cc, ...bcc]
        .map(value => value?.toLowerCase().trim())
        .filter(Boolean)
    )
  );

  const bodyText = getGmailMailBodyText(payload);
  const chunks =
    chunkGmailTextByParagraph(bodyText, MAIL_CHUNK_MAX_SIZE_BYTES, 0).filter(Boolean) ||
    [];

  const attachmentParts = collectGmailAttachmentParts(payload);
  const { attachments, attachmentFilenames } = buildGmailAttachmentSummaries(attachmentParts);

  return {
    docId: messageId,
    messageId,
    threadId,
    mailId,
    subject,
    chunks,
    timestamp,
    parentThreadId,
    permissions,
    normalizedMailboxEmail,
    from,
    to,
    cc,
    bcc,
    mimeType: payload?.mimeType || 'text/plain',
    attachmentFilenames,
    attachments,
    labels,
    attachmentParts,
  };
};

export const mapPreparedGmailMail = (
  preparedMail: PreparedGmailMailMapping,
  existingDocument?: ExistingGmailMailDocumentState
): MappedGmailMailDocument => {
  const userMap = { ...(existingDocument?.userMap || {}) };
  userMap[preparedMail.normalizedMailboxEmail] = preparedMail.messageId;

  const entityTagFields = (() => {
    if (!preparedMail.entityTags || isExtractedEntityTagsEmpty(preparedMail.entityTags)) {
      return {};
    }

    const normalizedEntityTags = coerceExtractedEntityTags(preparedMail.entityTags);
    return {
      entityPeople: normalizedEntityTags.people,
      entityProducts: normalizedEntityTags.productSpecifications,
      entityMerchants: normalizedEntityTags.merchants,
    } satisfies GmailMailEntityTagFields;
  })();

  return {
    docId: existingDocument?.docId || preparedMail.docId,
    threadId: preparedMail.threadId,
    mailId: preparedMail.mailId,
    subject: preparedMail.subject,
    chunks:
      preparedMail.chunks.length > 0
        ? preparedMail.chunks
        : chunkGmailTextByParagraph(
            preparedMail.subject || '(empty email)',
            MAIL_CHUNK_MAX_SIZE_BYTES,
            0
          ),
    timestamp: preparedMail.timestamp,
    app: Apps.Gmail,
    userMap,
    entity: MailEntity.Email,
    parentThreadId: preparedMail.parentThreadId,
    permissions: preparedMail.permissions,
    from: preparedMail.from,
    to: preparedMail.to,
    cc: preparedMail.cc,
    bcc: preparedMail.bcc,
    mimeType: preparedMail.mimeType,
    attachmentFilenames: preparedMail.attachmentFilenames,
    attachments: preparedMail.attachments,
    labels: preparedMail.labels,
    ...entityTagFields,
  };
};

export const mapGmailAttachmentDocument = ({
  docId,
  messageId,
  threadId,
  timestamp,
  permissions,
  filename,
  mimeType,
  size,
  partId,
  chunks,
}: GmailAttachmentDocumentInput): MailAttachment => ({
  app: Apps.Gmail,
  entity: getGmailMailAttachmentEntity(mimeType),
  mailId: messageId,
  partId: parseGmailAttachmentPartId(partId),
  docId,
  filename,
  fileSize: size,
  fileType: mimeType,
  chunks,
  threadId,
  timestamp,
  permissions,
});
