import { readFile, rm } from 'fs/promises';
import { basename } from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { DatabaseClient } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import { decrypt, encrypt } from '@/services/encryptionService';
import { conversationService } from '@/services/conversationService';
import { ExternalAttachmentService, type ExternalAttachment } from '@/services/externalAttachmentService';
import type { UploadedFileResult } from '@/services/fileUploadService';
import { logger } from '@/utils/logger';
import { MessageDirection, ExternalEntityType } from '@prisma/client';
import { cleanupWhatsAppExtraction, extractWhatsAppArchive } from '@/services/whatsapp/archive';
import { parseWhatsAppChat, type ParsedWhatsAppChat } from '@/services/whatsapp/parser';
import {
  resolveWhatsAppUsers,
  type WhatsAppNameEmailMapping,
} from '@/services/whatsapp/userResolver';
import { queueWhatsAppChannelVespaJob } from '@/services/whatsapp/vespa';
import { whatsAppMigrationProgressService } from '@/services/whatsappMigrationProgressService';
import { gcsService } from '@/services/gcsService';
import {
  queueJiraPurgeAttachmentVespaDeleteJob,
  queueJiraPurgeMessageVespaDeleteJob,
} from '@/services/jira/vespa';

const db = DatabaseClient.getInstance();
const externalSourceRepository = new ExternalSourceRepository();
const externalMessageRepository = new ExternalMessageRepository();
const channelParticipantRepository = new ChannelParticipantRepository();
const externalAttachmentService = new ExternalAttachmentService();

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
const STRIP_WHATSAPP_CONTROL_CHARS_REGEX = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g;
const normalizeMediaLookupKey = (value: string): string =>
  value
    .trim()
    .replace(STRIP_WHATSAPP_CONTROL_CHARS_REGEX, '')
    .replace(/[.)\],;:!?]+$/g, '')
    .toLowerCase();
const ATTACHED_MARKER_REGEX = /<attached:\s*([^>]+)>/giu;
const WHATSAPP_FILE_DESCRIPTOR_LINE_REGEX = /^[^\n•·]+[•·][^\n]*$/gmu;
const MAX_WHATSAPP_MUTATIONS_PER_SECOND = 50;
const OMITTED_ATTACHMENT_LINE_REGEX =
  /^(?<file>[^\n]+?)\s[•·]\s(?<details>\d+.*\bomitted\b)$/iu;
const OMITTED_ATTACHMENT_FILENAME_REGEX =
  /([A-Za-z0-9 _.'()&+\-[\],]+\.(?:jpg|jpeg|png|gif|webp|mp4|mov|avi|m4v|m4a|aac|ogg|opus|pdf|doc|docx|xls|xlsx|csv|tsv|ppt|pptx|vcf|txt))/iu;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const CHANNEL_MENTION_HTML = '<span class="chat-input-special-mention" data-mention-type="channel" contenteditable="false">@channel</span>';

function convertWhatsAppBroadcastMentions(html: string): string {
  return html.replace(/(^|[\s(])@all(?=$|[\s).,!?;:])/gi, (_match, prefix: string) => `${prefix}${CHANNEL_MENTION_HTML}`);
}

function convertWhatsAppFormatting(escapedText: string): string {
  const inlineFormatted = escapedText
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/`(\S(?:[^`\n]*\S)?)`/g, '<code>$1</code>')
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<strong>$1</strong>')
    .replace(/_(\S(?:[^_\n]*\S)?)_/g, '<em>$1</em>')
    .replace(/~(\S(?:[^~\n]*\S)?)~/g, '<del>$1</del>');

  const lines = inlineFormatted.split('\n');
  const output: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let blockquoteLines: string[] = [];

  const flushList = (): void => {
    if (listItems.length > 0 && listType) {
      output.push(`<${listType}>${listItems.join('')}</${listType}>`);
      listItems = [];
      listType = null;
    }
  };

  const flushBlockquote = (): void => {
    if (blockquoteLines.length > 0) {
      output.push(`<blockquote>${blockquoteLines.join('<br>')}</blockquote>`);
      blockquoteLines = [];
    }
  };

  const flushAll = (): void => {
    flushList();
    flushBlockquote();
  };

  for (const line of lines) {
    const h3 = /^###\s+(.+)$/.exec(line);
    const h2 = !h3 && /^##\s+(.+)$/.exec(line);
    const h1 = !h3 && !h2 && /^#\s+(.+)$/.exec(line);

    if (h3) {
      flushAll();
      output.push(`<h3>${h3[1]}</h3>`);
    } else if (h2) {
      flushAll();
      output.push(`<h2>${h2[1]}</h2>`);
    } else if (h1) {
      flushAll();
      output.push(`<h1>${h1[1]}</h1>`);
    } else {
      const ulMatch = /^[*•\-]\s+(.*)$/.exec(line);
      const bqMatch = /^(?:&gt;|>)\s?(.*)$/.exec(line);

      if (ulMatch) {
        flushBlockquote();
        listType = 'ul';
        listItems.push(`<li>${ulMatch[1]}</li>`);
      } else if (bqMatch) {
        flushList();
        blockquoteLines.push(bqMatch[1]);
      } else {
        flushAll();
        output.push(line);
      }
    }
  }
  flushAll();

  return output.join('\n');
}

const toMessageHtml = (content: string): string =>
  convertWhatsAppBroadcastMentions(convertWhatsAppFormatting(escapeHtml(content)).replace(/\n/g, '<br>'));
const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chat';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createMutationBatchLimiter(batchSize: number, sleepMs: number): () => Promise<void> {
  let processedInBatch = 0;

  return async () => {
    processedInBatch += 1;
    if (processedInBatch >= batchSize) {
      processedInBatch = 0;
      await sleep(sleepMs);
    }
  };
}

export interface WhatsAppMigrationPreviewResult {
  chatName: string | null;
  participants: string[];
  messageCount: number;
  mediaReferenceCount: number;
  mediaFilesFound: number;
  missingMediaRefs: string[];
  dateRange: { start: string; end: string } | null;
  unresolvedNames: string[];
  warnings: string[];
}

export interface WhatsAppMigrationExecuteInput {
  archivePath: string;
  archiveOriginalName?: string;
  targetProjectId: string;
  targetChannelId: string;
  mappings: WhatsAppNameEmailMapping[];
  actorUserId: string;
  workspaceId: string;
  createMissingUsers?: boolean;
}

export interface WhatsAppImportSourceSummary {
  externalSourceId: string;
  displayName: string;
  channelId: string;
  chatName: string | null;
  createdAt: string;
  importedMessageCount: number;
  attachmentCount: number;
}

export interface WhatsAppPurgeImportResult {
  dryRun: boolean;
  stats: {
    externalSourceId: string;
    displayName: string;
    channelId: string;
    externalMessageCount: number;
    importedMessageCount: number;
    attachmentCount: number;
    conversationCount: number;
    repliedConversationCount: number;
  };
  result?: {
    deletedExternalMessages: number;
    hardDeletedMessages: number;
    softDeletedMessages: number;
    deletedAttachments: number;
    deletedConversations: number;
  };
}

type ParsedVcfContact = {
  fullName: string | null;
  organization: string | null;
  title: string | null;
  phones: string[];
  emails: string[];
};

type ParsedPreviewContext = {
  parsedChat: ParsedWhatsAppChat;
  mediaMatches: { matched: number; unmatchedRefs: string[] };
  structuredContactCount: number;
};

type WhatsAppPurgePreviewData = {
  externalSource: {
    id: string;
    displayName: string;
    channelId: string | null;
  };
  externalMessageCount: number;
  messageIds: string[];
  messageRows: Array<{
    messageId: string;
    conversationId: string;
    createdAt: Date;
  }>;
  attachmentRows: Array<{
    id: string;
    entityId: string;
    url: string;
    thumbnailUrl: string | null;
  }>;
  conversationIds: string[];
  repliedConversationCount: number;
};

async function buildPreviewContext(
  archivePath: string,
  archiveOriginalName?: string,
): Promise<ParsedPreviewContext> {
  const extracted = await extractWhatsAppArchive(archivePath, archiveOriginalName);
  try {
    const chatText = await readFile(extracted.chatFilePath, 'utf8');
    const parsedChat = parseWhatsAppChat(chatText, extracted.chatFilePath, extracted.archiveName);

    const uniqueMediaRefs = [...new Set(parsedChat.messages.map(message => message.mediaRef).filter((value): value is string => Boolean(value)))];
    let matched = 0;
    const unmatchedRefs: string[] = [];
    let structuredContactCount = 0;

    for (const mediaRef of uniqueMediaRefs) {
      const matches = extracted.mediaFilesByBasename.get(normalizeMediaLookupKey(mediaRef)) || [];
      if (matches.length > 0) {
        matched += 1;
        if (matches.some(filePath => filePath.toLowerCase().endsWith('.vcf'))) {
          structuredContactCount += 1;
        }
      } else {
        unmatchedRefs.push(mediaRef);
      }
    }

    return {
      parsedChat,
      mediaMatches: { matched, unmatchedRefs },
      structuredContactCount,
    };
  } finally {
    await cleanupWhatsAppExtraction(extracted.extractionDir);
  }
}

async function ensureWhatsAppExternalSource(
  targetChannelId: string,
  chatName: string | null,
): Promise<{ externalSourceId: string; created: boolean; sourceName: string }> {
  const sourceName = `whatsapp-${targetChannelId}-${slugify(chatName || 'chat')}`;
  const encryptedCredentials = encrypt(
    JSON.stringify({
      archiveType: 'zip',
      importedAt: new Date().toISOString(),
      chatName,
    }),
  );

  try {
    const createdSource = await externalSourceRepository.create({
      name: sourceName,
      sourceType: 'whatsapp',
      displayName: `WhatsApp Import${chatName ? ` (${chatName})` : ''}`,
      channelId: targetChannelId,
      credentials: encryptedCredentials,
    });

    return {
      externalSourceId: createdSource.id,
      created: true,
      sourceName,
    };
  } catch (error) {
    const existing = await externalSourceRepository.findByName(sourceName);
    if (!existing) {
      throw error;
    }

    await externalSourceRepository.update(existing.id, {
      channelId: targetChannelId,
      isActive: true,
      displayName: `WhatsApp Import${chatName ? ` (${chatName})` : ''}`,
      credentials: encryptedCredentials,
    });

    return {
      externalSourceId: existing.id,
      created: false,
      sourceName,
    };
  }
}

async function convertMediaToUploadedFiles(
  sourceName: string,
  mediaFilePaths: string[],
  mediaRef: string,
): Promise<UploadedFileResult[]> {
  const uploadedResults: UploadedFileResult[] = [];
  for (const mediaFilePath of mediaFilePaths) {
    const buffer = await readFile(mediaFilePath);
    const detected = await fileTypeFromBuffer(buffer);
    const attachments: ExternalAttachment[] = [{
      fileName: basename(mediaFilePath),
      buffer,
      mimeType: detected?.mime || undefined,
      size: buffer.length,
      metadata: {
        source: 'whatsapp-import',
        originalMediaRef: mediaRef,
      },
    }];

    const downloaded = await externalAttachmentService.downloadAttachmentsForSource(sourceName, attachments, {
      scopeType: 'EXTERNAL_MESSAGE',
      scopeId: sourceName,
    });

    uploadedResults.push(
      ...downloaded.map(attachment => ({
        originalName: attachment.originalName,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        fileUrl: attachment.fileUrl,
        metadata: {
          ...(attachment.metadata || {}),
          source: 'external_download',
          convertedAt: new Date().toISOString(),
        },
      })),
    );
  }

  return uploadedResults;
}

function unfoldVcfLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const unfolded: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

function decodeVcfValue(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseVcfContacts(content: string): ParsedVcfContact[] {
  const lines = unfoldVcfLines(content);
  const contacts: ParsedVcfContact[] = [];
  let current: ParsedVcfContact | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      current = {
        fullName: null,
        organization: null,
        title: null,
        phones: [],
        emails: [],
      };
      continue;
    }

    if (/^END:VCARD$/i.test(trimmed)) {
      if (current) {
        contacts.push(current);
      }
      current = null;
      continue;
    }

    if (!current) continue;

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) continue;

    const rawKey = trimmed.slice(0, separatorIndex);
    const rawValue = decodeVcfValue(trimmed.slice(separatorIndex + 1));
    const key = rawKey.split(';')[0].toUpperCase();

    if (key === 'FN' && rawValue) {
      current.fullName = rawValue;
      continue;
    }

    if (key === 'N' && rawValue && !current.fullName) {
      const parts = rawValue
        .split(';')
        .map(part => part.trim())
        .filter(Boolean);
      current.fullName = parts.join(' ') || null;
      continue;
    }

    if (key === 'TEL' && rawValue) {
      current.phones.push(rawValue);
      continue;
    }

    if (key === 'EMAIL' && rawValue) {
      current.emails.push(rawValue);
      continue;
    }

    if (key === 'ORG' && rawValue) {
      current.organization = rawValue;
      continue;
    }

    if (key === 'TITLE' && rawValue) {
      current.title = rawValue;
    }
  }

  return contacts;
}

async function extractStructuredAttachmentDetails(
  mediaFilePaths: string[],
): Promise<{ sharedContacts: ParsedVcfContact[] }> {
  const sharedContacts: ParsedVcfContact[] = [];

  for (const mediaFilePath of mediaFilePaths) {
    if (!mediaFilePath.toLowerCase().endsWith('.vcf')) continue;
    const content = await readFile(mediaFilePath, 'utf8');
    sharedContacts.push(...parseVcfContacts(content));
  }

  return { sharedContacts };
}

function buildSharedContactsText(sharedContacts: ParsedVcfContact[]): string {
  const blocks = sharedContacts.map(contact => {
    const parts = ['Shared contact'];
    if (contact.fullName) parts.push(`Name: ${contact.fullName}`);
    if (contact.organization) parts.push(`Organization: ${contact.organization}`);
    if (contact.title) parts.push(`Title: ${contact.title}`);
    if (contact.phones.length > 0) parts.push(`Phone: ${contact.phones.join(', ')}`);
    if (contact.emails.length > 0) parts.push(`Email: ${contact.emails.join(', ')}`);
    return parts.join('\n');
  });

  return blocks.join('\n\n');
}

function sanitizeWhatsAppContent(content: string): string {
  return content.replace(STRIP_WHATSAPP_CONTROL_CHARS_REGEX, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMentionedParticipants(
  messages: { content: string; isSystemMessage: boolean }[],
  mappings: { whatsappName: string }[],
): string[] {
  if (mappings.length === 0) return [];
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const mappingNames = mappings.map(m => m.whatsappName.trim()).filter(Boolean);
  const alternation = mappingNames.map(n => escapeRegex(n).replace(/\\ /g, '\\s+')).join('|');
  const mentionRegex = new RegExp(`@(?:~\\s*)?(${alternation})(?=$|[\\s).,!?;:])`, 'giu');
  const found = new Set<string>();
  for (const message of messages) {
    if (message.isSystemMessage) continue;
    for (const match of message.content.matchAll(mentionRegex)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      const mapped = mappingNames.find(n => normalize(n) === normalize(raw));
      if (mapped) found.add(mapped);
    }
  }
  return [...found];
}

function buildUserMentionHtml(userId: string, username: string): string {
  const escapedUsername = escapeHtml(username);
  return `<span class="chat-input-mention" data-mention="true" data-mention-type="user" data-user-id="${escapeAttribute(userId)}" data-username="${escapeAttribute(username)}">@${escapedUsername}</span>`;
}

function renderMessageHtmlWithMentions(
  content: string,
  resolvedUsersByName: Map<string, { userId: string; email: string; displayName: string }>,
): string {
  const sanitizedContent = sanitizeWhatsAppContent(content);
  if (resolvedUsersByName.size === 0) {
    return toMessageHtml(sanitizedContent);
  }

  // Build expanded lookup: full name + first-name variants (first name only if unique)
  const mentionLookup = new Map<string, { userId: string; email: string; displayName: string }>();
  for (const [name, user] of resolvedUsersByName) {
    mentionLookup.set(name, user);
  }
  for (const [name, user] of resolvedUsersByName) {
    const firstName = name.split(' ')[0];
    if (firstName && !mentionLookup.has(firstName)) {
      mentionLookup.set(firstName, user);
    }
  }

  const mentionNames = [...mentionLookup.keys()].sort((left, right) => right.length - left.length);

  const alternation = mentionNames
    .map(name => escapeRegex(name).replace(/ /g, '[\\s\\u00a0]+'))
    .join('|');
  const mentionRegex = new RegExp(
    `(^|[\\s(])@(?:~\\s*)?(${alternation})(?=$|[\\s).,!?;:])`,
    'giu',
  );

  let result = '';
  let lastIndex = 0;

  for (const match of sanitizedContent.matchAll(mentionRegex)) {
    const fullMatch = match[0];
    const prefix = match[1] || '';
    const matchedName = match[2] || '';
    const matchIndex = match.index ?? 0;
    const mentionStartIndex = matchIndex + prefix.length;

    result += convertWhatsAppFormatting(escapeHtml(sanitizedContent.slice(lastIndex, matchIndex)));
    result += escapeHtml(prefix);

    const resolvedUser = mentionLookup.get(normalizeName(matchedName));
    if (!resolvedUser) {
      result += escapeHtml(fullMatch.slice(prefix.length));
    } else {
      result += buildUserMentionHtml(resolvedUser.userId, resolvedUser.displayName || matchedName.trim());
    }

    lastIndex = mentionStartIndex + fullMatch.slice(prefix.length).length;
  }

  result += convertWhatsAppFormatting(escapeHtml(sanitizedContent.slice(lastIndex)));
  return convertWhatsAppBroadcastMentions(result.replace(/\n/g, '<br>'));
}

const BARE_OMITTED_MEDIA_REGEX =
  /^(video|image|photo|audio|gif|document|sticker|contact card|media)\s+omitted$|^view once (video|photo|image)$/i;

function getOmittedAttachmentPlaceholder(content: string, mediaRef: string | null): string {
  const trimmedContent = sanitizeWhatsAppContent(content).trim();

  const bareMatch = BARE_OMITTED_MEDIA_REGEX.exec(trimmedContent);
  if (bareMatch) {
    const isViewOnce = /^view once/i.test(trimmedContent);
    const mediaType = (bareMatch[1] || bareMatch[2] || 'media').toLowerCase();
    const label = mediaType.charAt(0).toUpperCase() + mediaType.slice(1);
    return isViewOnce
      ? `[${label} unavailable — view-once media cannot be exported]`
      : `[${label} unavailable]`;
  }

  const omittedLineMatch = OMITTED_ATTACHMENT_LINE_REGEX.exec(trimmedContent);
  if (omittedLineMatch?.groups?.file) {
    return `[Attachment unavailable: ${omittedLineMatch.groups.file.trim()}]`;
  }

  const fileNameMatch = OMITTED_ATTACHMENT_FILENAME_REGEX.exec(trimmedContent);
  if (fileNameMatch?.[1]) {
    return `[Attachment unavailable: ${fileNameMatch[1].trim()}]`;
  }

  if (mediaRef) {
    return `[Attachment unavailable: ${mediaRef}]`;
  }

  return '[Attachment unavailable]';
}

function normalizeImportedMessageContent(
  content: string,
  mediaRef: string | null,
  hasMatchedAttachment: boolean,
  isMediaOmitted: boolean,
): string {
  if (isMediaOmitted) {
    return getOmittedAttachmentPlaceholder(content, mediaRef);
  }

  if (!mediaRef) {
    return content;
  }

  const stripped = content.replace(ATTACHED_MARKER_REGEX, '').trim();
  const userText = stripped.replace(WHATSAPP_FILE_DESCRIPTOR_LINE_REGEX, '').trim();

  if (hasMatchedAttachment) {
    return userText;
  }

  const missingPlaceholder = `[Attachment unavailable: ${mediaRef}]`;
  return userText ? `${userText}\n\n${missingPlaceholder}` : missingPlaceholder;
}

export class WhatsAppMigrationService {
  async listImportSources(params: {
    workspaceId: string;
    targetChannelId: string;
  }): Promise<WhatsAppImportSourceSummary[]> {
    const channel = await db.channel.findFirst({
      where: {
        id: params.targetChannelId,
        workspaceId: params.workspaceId,
      },
      select: { id: true },
    });
    if (!channel) {
      throw new Error('Target channel not found for workspace');
    }

    const sources = await db.externalSource.findMany({
      where: {
        sourceType: 'whatsapp',
        channelId: params.targetChannelId,
      },
      select: {
        id: true,
        displayName: true,
        channelId: true,
        createdAt: true,
        credentials: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const sourceIds = sources.map(source => source.id);
    const externalMessages = sourceIds.length
      ? await db.externalMessage.findMany({
          where: {
            externalSourceId: { in: sourceIds },
            entityType: ExternalEntityType.MESSAGE,
          },
          select: {
            externalSourceId: true,
            entityId: true,
          },
        })
      : [];
    const externalMessagesBySourceId = new Map<string, Array<{ entityId: string | null }>>();
    for (const mapping of externalMessages) {
      const existing = externalMessagesBySourceId.get(mapping.externalSourceId) || [];
      existing.push({ entityId: mapping.entityId });
      externalMessagesBySourceId.set(mapping.externalSourceId, existing);
    }

    const messageIds = externalMessages
      .map(mapping => mapping.entityId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const uniqueMessageIds = [...new Set(messageIds)];
    const attachmentCountsByMessageId = new Map<string, number>();

    if (uniqueMessageIds.length > 0) {
      const attachments = await db.messageAttachment.findMany({
        where: {
          entityId: { in: uniqueMessageIds },
        },
        select: { entityId: true },
      });

      for (const attachment of attachments) {
        attachmentCountsByMessageId.set(
          attachment.entityId,
          (attachmentCountsByMessageId.get(attachment.entityId) || 0) + 1,
        );
      }
    }

    return sources.map(source => {
      const sourceMappings = externalMessagesBySourceId.get(source.id) || [];
      let chatName: string | null = null;
      try {
        const credentials = JSON.parse(
          source.credentials ? decrypt(String(source.credentials)) : '{}',
        ) as {
          chatName?: string | null;
        };
        chatName = credentials.chatName?.trim() || null;
      } catch {
        chatName = null;
      }

      const importedMessageCount = sourceMappings.length;
      const attachmentCount = sourceMappings.reduce(
        (sum, mapping) => sum + (mapping.entityId ? attachmentCountsByMessageId.get(mapping.entityId) || 0 : 0),
        0,
      );

      return {
        externalSourceId: source.id,
        displayName: source.displayName,
        channelId: source.channelId || params.targetChannelId,
        chatName,
        createdAt: source.createdAt.toISOString(),
        importedMessageCount,
        attachmentCount,
      };
    });
  }

  private async buildPurgePreview(params: {
    workspaceId: string;
    targetChannelId: string;
    externalSourceId: string;
  }): Promise<WhatsAppPurgePreviewData> {
    const channel = await db.channel.findFirst({
      where: {
        id: params.targetChannelId,
        workspaceId: params.workspaceId,
      },
      select: { id: true },
    });
    if (!channel) {
      throw new Error('Target channel not found for workspace');
    }

    const externalSource = await db.externalSource.findFirst({
      where: {
        id: params.externalSourceId,
        sourceType: 'whatsapp',
        channelId: params.targetChannelId,
      },
      select: {
        id: true,
        displayName: true,
        channelId: true,
      },
    });

    if (!externalSource) {
      throw new Error('WhatsApp import source not found for this channel');
    }

    const externalMessages = await db.externalMessage.findMany({
      where: {
        externalSourceId: externalSource.id,
        entityType: ExternalEntityType.MESSAGE,
      },
      select: {
        id: true,
        entityId: true,
      },
    });

    const messageIds = externalMessages
      .map(mapping => mapping.entityId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const messageRows = messageIds.length
      ? await db.message.findMany({
          where: {
            messageId: { in: messageIds },
          },
          select: {
            messageId: true,
            conversationId: true,
            createdAt: true,
          },
        })
      : [];

    const conversationIds = [...new Set(messageRows.map(message => message.conversationId))];

    const attachmentRows = messageIds.length
      ? await db.messageAttachment.findMany({
          where: {
            entityId: { in: messageIds },
          },
          select: {
            id: true,
            entityId: true,
            url: true,
            thumbnailUrl: true,
          },
        })
      : [];

    const repliedConversationCount = conversationIds.length
      ? await db.conversation.count({
          where: {
            conversationId: { in: conversationIds },
            replyCount: { gt: 0 },
          },
        })
      : 0;

    return {
      externalSource,
      externalMessageCount: externalMessages.length,
      messageIds,
      messageRows,
      attachmentRows,
      conversationIds,
      repliedConversationCount,
    };
  }

  async purgeImport(params: {
    workspaceId: string;
    actorUserId: string;
    targetChannelId: string;
    externalSourceId: string;
    dryRun?: boolean;
  }): Promise<WhatsAppPurgeImportResult> {
    const purgeData = await this.buildPurgePreview(params);
    const isDryRun = params.dryRun !== false;

    const stats = {
      externalSourceId: purgeData.externalSource.id,
      displayName: purgeData.externalSource.displayName,
      channelId: params.targetChannelId,
      externalMessageCount: purgeData.externalMessageCount,
      importedMessageCount: purgeData.messageRows.length,
      attachmentCount: purgeData.attachmentRows.length,
      conversationCount: purgeData.conversationIds.length,
      repliedConversationCount: purgeData.repliedConversationCount,
    };

    if (isDryRun) {
      logger.info('[WhatsAppMigration] Purge dry run ready', {
        targetChannelId: params.targetChannelId,
        externalSourceId: params.externalSourceId,
        stats,
      });
      return {
        dryRun: true,
        stats,
      };
    }

    logger.info('[WhatsAppMigration] Purge execution started', {
      targetChannelId: params.targetChannelId,
      externalSourceId: params.externalSourceId,
      conversationCount: purgeData.conversationIds.length,
      importedMessageCount: purgeData.messageRows.length,
      attachmentCount: purgeData.attachmentRows.length,
    });

    const attachmentsByMessageId = new Map<
      string,
      Array<{ id: string; url: string; thumbnailUrl: string | null }>
    >();
    for (const attachment of purgeData.attachmentRows) {
      const existing = attachmentsByMessageId.get(attachment.entityId) || [];
      existing.push({
        id: attachment.id,
        url: attachment.url,
        thumbnailUrl: attachment.thumbnailUrl,
      });
      attachmentsByMessageId.set(attachment.entityId, existing);
    }

    const messageRowsById = new Map(
      purgeData.messageRows.map(message => [message.messageId, message]),
    );

    const conversationIds = purgeData.conversationIds;
    const conversations = conversationIds.length
      ? await db.conversation.findMany({
          where: { conversationId: { in: conversationIds } },
          select: {
            conversationId: true,
            initialMessageId: true,
            replyCount: true,
          },
        })
      : [];

    const allConversationMessages = conversationIds.length
      ? await db.message.findMany({
          where: { conversationId: { in: conversationIds } },
          select: {
            messageId: true,
            conversationId: true,
          },
        })
      : [];
    const messagesByConversationId = new Map<string, string[]>();
    for (const row of allConversationMessages) {
      const existing = messagesByConversationId.get(row.conversationId) || [];
      existing.push(row.messageId);
      messagesByConversationId.set(row.conversationId, existing);
    }

    let deletedExternalMessages = 0;
    let hardDeletedMessages = 0;
    let softDeletedMessages = 0;
    let deletedAttachments = 0;
    let deletedConversations = 0;
    const waitForNextMutation = createMutationBatchLimiter(MAX_WHATSAPP_MUTATIONS_PER_SECOND, 1000);

    for (const conversation of conversations) {
      const conversationMessageIds = messagesByConversationId.get(conversation.conversationId) || [];
      const importedMessageIdsInConversation = conversationMessageIds.filter(messageId =>
        messageRowsById.has(messageId),
      );

      for (const messageId of importedMessageIdsInConversation) {
        await waitForNextMutation();
        const otherMessages = conversationMessageIds.filter(id => id !== messageId);
        const shouldSoftDelete =
          conversation.initialMessageId === messageId && otherMessages.length > 0;
        const attachments = attachmentsByMessageId.get(messageId) || [];

        await db.$transaction(async tx => {
          if (attachments.length > 0) {
            await tx.messageAttachment.deleteMany({
              where: {
                id: { in: attachments.map(attachment => attachment.id) },
              },
            });
          }

          await tx.reactionCount.deleteMany({ where: { messageId } });
          await tx.reaction.deleteMany({ where: { messageId } });
          await tx.messageSearch.deleteMany({ where: { messageId } });

          if (shouldSoftDelete) {
            await tx.message.update({
              where: { messageId },
              data: {
                isDeleted: true,
                content: '',
                hasAttachment: false,
                edited: false,
                link_preview_md: '',
              },
            });
          } else {
            await tx.message.deleteMany({ where: { messageId } });

            if (otherMessages.length === 0) {
              await tx.conversationParticipant.deleteMany({
                where: { conversationId: conversation.conversationId },
              });
              await tx.conversation.deleteMany({
                where: { conversationId: conversation.conversationId },
              });
            }
          }
        });

        for (const attachment of attachments) {
          deletedAttachments += 1;
          queueJiraPurgeAttachmentVespaDeleteJob(attachment.id, params.actorUserId, params.workspaceId);
          try {
            if (attachment.url) {
              await gcsService.deleteFile(attachment.url);
            }
            if (attachment.thumbnailUrl) {
              await gcsService.deleteFile(attachment.thumbnailUrl);
            }
          } catch (error) {
            logger.warn('[WhatsAppMigration] Failed to cleanup attachment blob during purge', {
              attachmentId: attachment.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        queueJiraPurgeMessageVespaDeleteJob(messageId, params.actorUserId, params.workspaceId);
        if (shouldSoftDelete) {
          softDeletedMessages += 1;
        } else {
          hardDeletedMessages += 1;
          if (otherMessages.length === 0) {
            deletedConversations += 1;
          }
        }

        if ((hardDeletedMessages + softDeletedMessages) % 50 === 0) {
          logger.info('[WhatsAppMigration] Purge progress', {
            targetChannelId: params.targetChannelId,
            externalSourceId: params.externalSourceId,
            processedMessages: hardDeletedMessages + softDeletedMessages,
            deletedAttachments,
          });
        }
      }
    }

    if (purgeData.externalSource.id) {
      const sourceId = purgeData.externalSource.id;
      const result = await db.$transaction(async tx => {
        const externalDeleteResult = await tx.externalMessage.deleteMany({
          where: { externalSourceId: sourceId },
        });
        await tx.externalSource.delete({ where: { id: sourceId } });
        return externalDeleteResult.count;
      });
      deletedExternalMessages = result;
    }

    logger.info('[WhatsAppMigration] Purge execution completed', {
      targetChannelId: params.targetChannelId,
      externalSourceId: params.externalSourceId,
      deletedExternalMessages,
      hardDeletedMessages,
      softDeletedMessages,
      deletedAttachments,
      deletedConversations,
    });

    return {
      dryRun: false,
      stats,
      result: {
        deletedExternalMessages,
        hardDeletedMessages,
        softDeletedMessages,
        deletedAttachments,
        deletedConversations,
      },
    };
  }

  async preview(params: {
    archivePath: string;
    archiveOriginalName?: string;
    workspaceId: string;
    mappings: WhatsAppNameEmailMapping[];
  }): Promise<WhatsAppMigrationPreviewResult> {
    logger.info('[WhatsAppMigration] Building preview context', {
      workspaceId: params.workspaceId,
      archiveOriginalName: params.archiveOriginalName || null,
      mappingCount: params.mappings.length,
    });
    const context = await buildPreviewContext(params.archivePath, params.archiveOriginalName);
    const importableMessages = context.parsedChat.messages.filter(message => !message.isSystemMessage);
    const humanParticipants = importableMessages
      .filter(message => !message.isSystemMessage && message.senderName)
      .map(message => message.senderName!);
    const mentionedParticipants = extractMentionedParticipants(context.parsedChat.messages, params.mappings);
    const distinctParticipants = [...new Set([...humanParticipants, ...mentionedParticipants])];
    const systemMessageCount = context.parsedChat.messages.length - importableMessages.length;
    const editedMessageCount = importableMessages.filter(message => message.isEdited).length;
    const omittedMediaCount = importableMessages.filter(message => message.isMediaOmitted).length;

    const resolution = await resolveWhatsAppUsers({
      workspaceId: params.workspaceId,
      participantNames: distinctParticipants,
      mappings: params.mappings,
      createMissingUsers: false,
    });

    const firstMessage = importableMessages[0] || null;
    const lastMessage = importableMessages[importableMessages.length - 1] || null;
    const warnings: string[] = [];
    if (systemMessageCount > 0) {
      warnings.push(`${systemMessageCount} system message(s) will be skipped during import`);
    }
    if (editedMessageCount > 0) {
      warnings.push(`${editedMessageCount} edited message(s) detected and will be flagged in metadata`);
    }
    if (omittedMediaCount > 0) {
      warnings.push(`${omittedMediaCount} omitted media message(s) detected; original media cannot be recovered from export`);
    }
    if (context.structuredContactCount > 0) {
      warnings.push(`${context.structuredContactCount} VCF contact attachment(s) detected and will be imported with parsed contact details`);
    }
    if (context.mediaMatches.unmatchedRefs.length > 0) {
      warnings.push(`${context.mediaMatches.unmatchedRefs.length} media reference(s) have no matching file in archive`);
    }

    logger.info('[WhatsAppMigration] Preview context ready', {
      workspaceId: params.workspaceId,
      archiveOriginalName: params.archiveOriginalName || null,
      chatName: context.parsedChat.chatName,
      importableMessageCount: importableMessages.length,
      participantCount: distinctParticipants.length,
      matchedMediaCount: context.mediaMatches.matched,
      unmatchedMediaCount: context.mediaMatches.unmatchedRefs.length,
      unresolvedCount: resolution.unresolvedNames.length,
    });

    return {
      chatName: context.parsedChat.chatName,
      participants: context.parsedChat.participants,
      messageCount: importableMessages.length,
      mediaReferenceCount: importableMessages.filter(message => Boolean(message.mediaRef)).length,
      mediaFilesFound: context.mediaMatches.matched,
      missingMediaRefs: context.mediaMatches.unmatchedRefs,
      dateRange:
        firstMessage && lastMessage
          ? {
              start: firstMessage.timestamp.toISOString(),
              end: lastMessage.timestamp.toISOString(),
            }
          : null,
      unresolvedNames: resolution.unresolvedNames,
      warnings,
    };
  }

  async execute(jobId: string, input: WhatsAppMigrationExecuteInput): Promise<void> {
    let extractionDir: string | null = null;

    try {
      logger.info('[WhatsAppMigration] Execute started', {
        jobId,
        targetProjectId: input.targetProjectId,
        targetChannelId: input.targetChannelId,
        workspaceId: input.workspaceId,
        archiveOriginalName: input.archiveOriginalName || null,
        mappingCount: input.mappings.length,
      });
      await whatsAppMigrationProgressService.patchJob(jobId, {
        status: 'running',
        phase: 'parsing',
      });

      const extracted = await extractWhatsAppArchive(input.archivePath, input.archiveOriginalName);
      extractionDir = extracted.extractionDir;
      const chatText = await readFile(extracted.chatFilePath, 'utf8');
      const parsedChat = parseWhatsAppChat(chatText, extracted.chatFilePath, extracted.archiveName);
      const importableMessages = parsedChat.messages.filter(message => !message.isSystemMessage);
      const systemMessageCount = parsedChat.messages.length - importableMessages.length;
      const editedMessageCount = importableMessages.filter(message => message.isEdited).length;
      const omittedMediaCount = importableMessages.filter(message => message.isMediaOmitted).length;
      const initialWarnings: string[] = [];
      if (systemMessageCount > 0) {
        initialWarnings.push(`${systemMessageCount} system message(s) skipped`);
      }
      if (editedMessageCount > 0) {
        initialWarnings.push(`${editedMessageCount} edited message(s) detected`);
      }
      if (omittedMediaCount > 0) {
        initialWarnings.push(`${omittedMediaCount} omitted media message(s) cannot be recovered from export`);
      }

      logger.info('[WhatsAppMigration] Parsing completed', {
        jobId,
        chatName: parsedChat.chatName,
        totalParsedMessages: parsedChat.messages.length,
        importableMessageCount: importableMessages.length,
        systemMessageCount,
        editedMessageCount,
        omittedMediaCount,
      });

      await whatsAppMigrationProgressService.patchJob(jobId, {
        chatName: parsedChat.chatName,
        totalMessages: importableMessages.length,
        totalMedia: importableMessages.filter(message => Boolean(message.mediaRef)).length,
        phase: 'resolving_users',
        warnings: initialWarnings,
      });

      const channel = await db.channel.findUnique({
        where: { id: input.targetChannelId },
        select: { id: true, projectId: true, workspaceId: true },
      });
      if (!channel) {
        throw new Error('Target channel not found');
      }
      if (channel.projectId !== input.targetProjectId) {
        throw new Error('Target channel does not belong to target project');
      }

      const senderNames = parsedChat.messages.filter(message => !message.isSystemMessage && message.senderName).map(message => message.senderName!);
      const mentionedNames = extractMentionedParticipants(parsedChat.messages, input.mappings);
      const participantNames = [...new Set([...senderNames, ...mentionedNames])];
      const resolvedUsers = await resolveWhatsAppUsers({
        workspaceId: channel.workspaceId,
        participantNames,
        mappings: input.mappings,
        createMissingUsers: input.createMissingUsers !== false,
      });

      logger.info('[WhatsAppMigration] User resolution completed', {
        jobId,
        participantCount: participantNames.length,
        resolvedCount: resolvedUsers.resolvedUsersByName.size,
        unresolvedCount: resolvedUsers.unresolvedNames.length,
      });

      if (resolvedUsers.unresolvedNames.length > 0) {
        await whatsAppMigrationProgressService.patchJob(jobId, {
          unresolvedNames: resolvedUsers.unresolvedNames,
          phase: 'failed',
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorMessage: `Unresolved WhatsApp participants: ${resolvedUsers.unresolvedNames.join(', ')}`,
        });
        return;
      }

      const externalSource = await ensureWhatsAppExternalSource(input.targetChannelId, parsedChat.chatName);
      const existingMappings = await externalMessageRepository.findByExternalIds(
        externalSource.externalSourceId,
        importableMessages.map(message => message.externalId),
      );
      const existingExternalIds = new Set(existingMappings.map(mapping => mapping.externalId));

      logger.info('[WhatsAppMigration] Dedup check completed', {
        jobId,
        externalSourceId: externalSource.externalSourceId,
        externalSourceCreated: externalSource.created,
        sourceName: externalSource.sourceName,
        existingMessageCount: existingExternalIds.size,
        candidateMessageCount: importableMessages.length,
      });

      const warnings = new Set(initialWarnings);
      const importedUserIds = new Set<string>();
      const unmatchedMediaRefs = new Set<string>();
      let importedMessages = 0;
      let importedMedia = 0;
      let skippedMessages = 0;
      const waitForNextMutation = createMutationBatchLimiter(MAX_WHATSAPP_MUTATIONS_PER_SECOND, 1000);

      await whatsAppMigrationProgressService.patchJob(jobId, {
        phase: 'importing_messages',
        warnings: [],
      });

      for (const message of importableMessages) {
        if (existingExternalIds.has(message.externalId)) {
          skippedMessages += 1;
          continue;
        }
        await waitForNextMutation();

        const senderUserId = message.isSystemMessage
          ? input.actorUserId
          : resolvedUsers.resolvedUsersByName.get(normalizeName(message.senderName || ''))?.userId;

        if (!senderUserId) {
          warnings.add(`Skipped message at ${message.timestamp.toISOString()} because sender could not be resolved`);
          skippedMessages += 1;
          continue;
        }

        importedUserIds.add(senderUserId);

        const mediaMatches = message.mediaRef
          ? extracted.mediaFilesByBasename.get(normalizeMediaLookupKey(message.mediaRef)) || []
          : [];
        const structuredAttachmentDetails = await extractStructuredAttachmentDetails(mediaMatches);
        const uploadedFiles =
          message.mediaRef && mediaMatches.length > 0
            ? await convertMediaToUploadedFiles(externalSource.sourceName, mediaMatches, message.mediaRef)
            : [];
        if (message.mediaRef && mediaMatches.length === 0) {
          unmatchedMediaRefs.add(message.mediaRef);
          warnings.add(`Media file not found for reference '${message.mediaRef}'`);
        }

        const messageMetadata = {
          externalSourceType: 'whatsapp',
          whatsappSenderName: message.senderName,
          whatsappMediaRef: message.mediaRef,
          isSystemMessage: message.isSystemMessage,
          isEdited: message.isEdited,
          isMediaOmitted: message.isMediaOmitted,
          sharedContacts: structuredAttachmentDetails.sharedContacts,
        };
        const sharedContactsText =
          structuredAttachmentDetails.sharedContacts.length > 0
            ? buildSharedContactsText(structuredAttachmentDetails.sharedContacts)
            : null;
        const rawMessageContent = normalizeImportedMessageContent(
          message.content,
          message.mediaRef,
          mediaMatches.length > 0,
          message.isMediaOmitted,
        );
        const finalRawMessageContent = sharedContactsText
          ? rawMessageContent
            ? `${rawMessageContent}\n\n${sharedContactsText}`
            : sharedContactsText
          : rawMessageContent;
        const messageContent = renderMessageHtmlWithMentions(
          finalRawMessageContent,
          resolvedUsers.resolvedUsersByName,
        );
        const created = await conversationService.createConversationWithMessage({
          channelId: input.targetChannelId,
          userId: senderUserId,
          content: messageContent,
          uploadedFiles,
          msgType: 'USER',
          createdAt: message.timestamp,
          isAddingParticipant: false,
          messageMetadata,
        });

        await externalMessageRepository.create({
          externalSourceId: externalSource.externalSourceId,
          externalId: message.externalId,
          externalThreadId: message.externalId,
          entityId: created.message.messageId,
          direction: MessageDirection.INCOMING,
          entityType: ExternalEntityType.MESSAGE,
        });

        importedMessages += 1;
        if (uploadedFiles.length > 0) {
          importedMedia += uploadedFiles.length;
        }

        if (importedMessages % 50 === 0) {
          logger.info('[WhatsAppMigration] Import progress', {
            jobId,
            importedMessages,
            totalMessages: importableMessages.length,
            importedMedia,
            skippedMessages,
            warningCount: warnings.size,
          });
        }

        if (importedMessages % 50 === 0) {
          await whatsAppMigrationProgressService.patchJob(jobId, {
            importedMessages,
            importedMedia,
            warnings: [...warnings],
          });
        }
      }

      await whatsAppMigrationProgressService.patchJob(jobId, {
        phase: 'indexing',
      });

      if (importedUserIds.size > 0) {
        await channelParticipantRepository.addParticipantsBatch(
          input.targetChannelId,
          [...importedUserIds],
          'MEMBER',
          false,
          new Date(),
        );
        logger.info('[WhatsAppMigration] Added channel participants from import', {
          jobId,
          targetChannelId: input.targetChannelId,
          participantCount: importedUserIds.size,
        });
        queueWhatsAppChannelVespaJob(input.targetChannelId, [...importedUserIds][0] || input.actorUserId, channel.workspaceId);
        logger.info('[WhatsAppMigration] Queued channel Vespa reindex after import', {
          jobId,
          targetChannelId: input.targetChannelId,
          workspaceId: channel.workspaceId,
        });
      }

      await whatsAppMigrationProgressService.patchJob(jobId, {
        status: 'completed',
        phase: 'completed',
        completedAt: new Date().toISOString(),
        importedMessages,
        importedMedia,
        warnings: [...warnings],
        result: {
          externalSourceId: externalSource.externalSourceId,
          externalSourceCreated: externalSource.created,
          importedMessages,
          importedMedia,
          skippedMessages,
          unmatchedMediaRefs: [...unmatchedMediaRefs],
        },
      });

      logger.info('[WhatsAppMigration] Execute completed', {
        jobId,
        externalSourceId: externalSource.externalSourceId,
        importedMessages,
        importedMedia,
        skippedMessages,
        unmatchedMediaCount: unmatchedMediaRefs.size,
        warningCount: warnings.size,
      });
    } catch (error) {
      logger.error('[WhatsAppMigration] Migration job failed', error, { jobId });
      await whatsAppMigrationProgressService.patchJob(jobId, {
        status: 'failed',
        phase: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'WhatsApp migration failed',
      });
    } finally {
      if (extractionDir) {
        await cleanupWhatsAppExtraction(extractionDir).catch(cleanupError => {
          logger.warn('[WhatsAppMigration] Failed to cleanup extraction directory', {
            extractionDir,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
      }
      await rm(input.archivePath, { force: true }).catch(cleanupError => {
        logger.warn('[WhatsAppMigration] Failed to cleanup uploaded archive', {
          archivePath: input.archivePath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
    }
  }
}

export const whatsAppMigrationService = new WhatsAppMigrationService();
