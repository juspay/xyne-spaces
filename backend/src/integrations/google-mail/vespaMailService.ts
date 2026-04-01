import { convert } from 'html-to-text';
import { gmail_v1 } from 'googleapis';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { XMLParser } from 'fast-xml-parser';
import {
  createDefaultConfig,
  createVespaService,
  mailAttachmentSchema,
  mailSchema,
  type VespaDependencies,
  type VespaMail,
} from '@xyne/vespa-ts';
import vespaRuntimeConfig, {
  CLUSTER,
  NAMESPACE,
  vespaBaseHost,
} from '@/vespa/vespaConfig';
import {
  extractEntityTags,
  isExtractedEntityTagsEmpty,
  type ExtractedEntityTags,
} from '@/services/entityTagExtractor';
import { logger } from '@/utils/logger';
import {
  chunkGmailTextByParagraph,
  type ExistingGmailMailDocumentState,
  mapGmailAttachmentDocument,
  mapPreparedGmailMail,
  normalizeGmailMimeType,
  prepareGmailMailMapping,
  type PreparedGmailMailMapping,
} from './mapper';

const vespaLogger = logger.child({ module: 'google-mail-vespa' });

const vespaConfig = createDefaultConfig({
  vespaBaseHost,
  page: vespaRuntimeConfig.VespaPageSize,
  isDebugMode: vespaRuntimeConfig.isDebugMode,
  namespace: NAMESPACE,
  cluster: CLUSTER,
  vespaMaxRetryAttempts: vespaRuntimeConfig.vespaMaxRetryAttempts,
  vespaRetryDelay: vespaRuntimeConfig.vespaRetryDelay,
  feedEndpoint: vespaRuntimeConfig.vespaEndpoint.feedEndpoint,
  queryEndpoint: vespaRuntimeConfig.vespaEndpoint.queryEndpoint,
});

const vespaDependencies: VespaDependencies = {
  logger: vespaLogger as any,
  config: vespaConfig,
  sourceSchemas: [mailSchema, mailAttachmentSchema],
};

const mailVespaService = createVespaService(vespaDependencies);

const MAX_CHUNK_SIZE_BYTES = 512;

const MAIL_ATTACHMENT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/html',
  'text/markdown',
]);

interface ParsedSpreadsheetSheet {
  sheetName: string;
  sheetIndex: number;
  chunks: string[];
}

const decodeBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
};

const isSpreadsheetMimeType = (mimeType: string): boolean => {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv'
  );
};

const extractSpreadsheetSheets = async (
  buffer: Buffer,
  filename: string
): Promise<ParsedSpreadsheetSheet[]> => {
  try {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      cellText: false,
      cellFormula: false,
      cellStyles: false,
      sheetStubs: false,
      dense: true,
    });

    const parsedSheets: ParsedSpreadsheetSheet[] = [];

    for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        continue;
      }

      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(worksheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      });

      const text = rows
        .map(row =>
          row
            .map(cell => String(cell ?? '').trim())
            .filter(Boolean)
            .join(' | ')
        )
        .filter(Boolean)
        .join('\n');

      const chunks = chunkGmailTextByParagraph(text, MAX_CHUNK_SIZE_BYTES, 0);
      if (chunks.length === 0) {
        continue;
      }

      parsedSheets.push({
        sheetName,
        sheetIndex,
        chunks,
      });
    }

    return parsedSheets;
  } catch (error) {
    vespaLogger.warn('Failed to parse spreadsheet attachment for Vespa indexing', {
      filename,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
};

const extractPptxText = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: true,
    trimValues: true,
  });

  const slideFiles = Object.keys(zip.files)
    .filter(fileName => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
    .sort((left, right) => {
      const leftNumber = parseInt(left.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
      const rightNumber = parseInt(right.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
      return leftNumber - rightNumber;
    });

  const collectSlideText = (node: unknown, output: string[]) => {
    if (!node) {
      return;
    }

    if (typeof node === 'string') {
      if (node.trim()) {
        output.push(node.trim());
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const child of node) {
        collectSlideText(child, output);
      }
      return;
    }

    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'a:t') {
          collectSlideText(value, output);
        } else if (typeof value === 'object') {
          collectSlideText(value, output);
        }
      }
    }
  };

  const slides: string[] = [];

  for (const slideFile of slideFiles) {
    const xml = await zip.file(slideFile)?.async('text');
    if (!xml) {
      continue;
    }

    const parsed = parser.parse(xml);
    const slideText: string[] = [];
    collectSlideText(parsed, slideText);

    if (slideText.length > 0) {
      slides.push(slideText.join('\n'));
    }
  }

  return slides.join('\n\n');
};

const extractAttachmentText = async (
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string[]> => {
  try {
    if (isSpreadsheetMimeType(mimeType)) {
      return [];
    }

    if (mimeType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return chunkGmailTextByParagraph(result.text, MAX_CHUNK_SIZE_BYTES, 0);
      } finally {
        await parser.destroy();
      }
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return chunkGmailTextByParagraph(result.value, MAX_CHUNK_SIZE_BYTES, 0);
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint'
    ) {
      const text = await extractPptxText(buffer);
      return chunkGmailTextByParagraph(text, MAX_CHUNK_SIZE_BYTES, 0);
    }

    if (mimeType === 'text/html') {
      return chunkGmailTextByParagraph(
        convert(buffer.toString('utf8'), { wordwrap: false }),
        MAX_CHUNK_SIZE_BYTES,
        0
      );
    }

    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      return chunkGmailTextByParagraph(buffer.toString('utf8'), MAX_CHUNK_SIZE_BYTES, 0);
    }

    return [];
  } catch (error) {
    vespaLogger.warn('Failed to extract Gmail attachment text for Vespa indexing', {
      filename,
      mimeType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
};

export class GoogleMailVespaService {
  async ingestMessage(
    gmail: gmail_v1.Gmail,
    message: gmail_v1.Schema$Message,
    mailboxEmail: string
  ): Promise<void> {
    if (!message.id) {
      return;
    }

    const alreadyIndexed = await mailVespaService.IfMailDocExist(mailboxEmail, message.id);
    if (alreadyIndexed) {
      return;
    }

    const mailData = await this.parseMail(message, gmail, mailboxEmail);
    await mailVespaService.insert(mailData, mailSchema);
  }

  async applyHistoryChanges(
    historyRecords: gmail_v1.Schema$History[],
    mailboxEmail: string
  ): Promise<void> {
    const normalizedMailboxEmail = mailboxEmail.trim().toLowerCase();

    for (const historyRecord of historyRecords) {
      for (const deletedEntry of historyRecord.messagesDeleted || []) {
        const messageId = deletedEntry.message?.id;
        if (!messageId) {
          continue;
        }

        try {
          const document = await mailVespaService.getDocumentOrNull(mailSchema, messageId);
          if (!document) {
            continue;
          }

          const fields = document.fields as VespaMail;
          const permissions = (fields.permissions || []).filter(Boolean);
          const userMap = { ...(fields.userMap || {}) };

          delete userMap[normalizedMailboxEmail];

          const updatedPermissions = permissions.filter(
            permission => permission.toLowerCase() !== normalizedMailboxEmail
          );

          if (updatedPermissions.length === 0) {
            await mailVespaService.DeleteDocument(messageId, mailSchema);
            continue;
          }

          await mailVespaService.UpdateDocument(mailSchema, messageId, {
            permissions: updatedPermissions,
            userMap,
          });
        } catch (error) {
          vespaLogger.warn('Failed to apply Gmail delete history to Vespa mail document', {
            mailboxEmail: normalizedMailboxEmail,
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      for (const labelAdded of historyRecord.labelsAdded || []) {
        const messageId = labelAdded.message?.id;
        if (!messageId) {
          continue;
        }

        try {
          const document = await mailVespaService.getDocumentOrNull(mailSchema, messageId);
          if (!document) {
            continue;
          }

          const fields = document.fields as VespaMail;
          const labels = Array.from(
            new Set([...(fields.labels || []), ...(labelAdded.labelIds || [])].filter(Boolean))
          );

          await mailVespaService.UpdateDocument(mailSchema, messageId, { labels });
        } catch (error) {
          vespaLogger.warn('Failed to apply Gmail label-add history to Vespa mail document', {
            mailboxEmail: normalizedMailboxEmail,
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      for (const labelRemoved of historyRecord.labelsRemoved || []) {
        const messageId = labelRemoved.message?.id;
        if (!messageId) {
          continue;
        }

        try {
          const document = await mailVespaService.getDocumentOrNull(mailSchema, messageId);
          if (!document) {
            continue;
          }

          const fields = document.fields as VespaMail;
          const removedLabels = new Set(labelRemoved.labelIds || []);
          const labels = (fields.labels || []).filter(label => !removedLabels.has(label));

          await mailVespaService.UpdateDocument(mailSchema, messageId, { labels });
        } catch (error) {
          vespaLogger.warn('Failed to apply Gmail label-remove history to Vespa mail document', {
            mailboxEmail: normalizedMailboxEmail,
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }
  }

  private async parseMail(
    message: gmail_v1.Schema$Message,
    gmail: gmail_v1.Gmail,
    mailboxEmail: string
  ) {
    const preparedMail = prepareGmailMailMapping(message, mailboxEmail);
    const entityTags = await this.extractMailEntityTags(preparedMail);
    let existingDocumentState: ExistingGmailMailDocumentState | undefined;
    let mailExists = false;

    if (preparedMail.mailId) {
      try {
        const existingDocuments = await mailVespaService.ifMailDocumentsExist([preparedMail.mailId]);
        const existingDocument = existingDocuments?.[preparedMail.mailId];
        if (existingDocument?.exists) {
          mailExists = true;
          existingDocumentState = {
            userMap: existingDocument.userMap || {},
            docId: existingDocument.docId || preparedMail.docId,
          };
        }
      } catch (error) {
        vespaLogger.warn('Failed to check Gmail mail existence in Vespa, continuing with insert', {
          mailboxEmail,
          mailId: preparedMail.mailId,
          messageId: preparedMail.messageId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (!mailExists) {
      await this.indexAttachments(gmail, preparedMail);
    }

    return mapPreparedGmailMail(
      {
        ...preparedMail,
        entityTags,
      },
      existingDocumentState
    );
  }

  private async extractMailEntityTags(
    preparedMail: PreparedGmailMailMapping
  ): Promise<ExtractedEntityTags | undefined> {
    const entityTagSourceText = [preparedMail.subject, ...preparedMail.chunks]
      .map(value => value.trim())
      .filter(Boolean)
      .join('\n\n');

    if (!entityTagSourceText) {
      return undefined;
    }

    try {
      const extractedEntityTags = await extractEntityTags(entityTagSourceText);
      return isExtractedEntityTagsEmpty(extractedEntityTags)
        ? undefined
        : extractedEntityTags;
    } catch (error) {
      vespaLogger.warn('Failed to extract Gmail entity tags for Vespa indexing', {
        messageId: preparedMail.messageId,
        threadId: preparedMail.threadId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private async indexAttachments(
    gmail: gmail_v1.Gmail,
    preparedMail: PreparedGmailMailMapping
  ): Promise<void> {
    for (const attachment of preparedMail.attachmentParts) {
      const mimeType = normalizeGmailMimeType(attachment.mimeType);
      if (!MAIL_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        continue;
      }

      try {
        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: preparedMail.messageId,
          id: attachment.attachmentId,
        });

        if (!response.data.data) {
          continue;
        }

        const buffer = decodeBase64Url(response.data.data);
        if (buffer.length === 0) {
          continue;
        }

        if (isSpreadsheetMimeType(mimeType)) {
          const sheets = await extractSpreadsheetSheets(buffer, attachment.filename);
          for (const sheet of sheets) {
            const sheetDocId =
              sheets.length > 1 ? `${attachment.attachmentId}_${sheet.sheetIndex}` : attachment.attachmentId;
            const sheetFilename =
              sheets.length > 1 ? `${attachment.filename} / ${sheet.sheetName}` : attachment.filename;

            const sheetDocument = mapGmailAttachmentDocument({
              docId: sheetDocId,
              messageId: preparedMail.messageId,
              threadId: preparedMail.threadId,
              timestamp: preparedMail.timestamp,
              permissions: preparedMail.permissions,
              filename: sheetFilename,
              mimeType,
              size: buffer.length,
              partId: attachment.partId,
              chunks: sheet.chunks,
            });

            await mailVespaService.insert(sheetDocument, mailAttachmentSchema);
          }

          continue;
        }

        const chunks = await extractAttachmentText(buffer, mimeType, attachment.filename);
        if (chunks.length === 0) {
          continue;
        }

        const attachmentDocument = mapGmailAttachmentDocument({
          docId: attachment.attachmentId,
          messageId: preparedMail.messageId,
          threadId: preparedMail.threadId,
          timestamp: preparedMail.timestamp,
          permissions: preparedMail.permissions,
          filename: attachment.filename,
          mimeType,
          size: buffer.length,
          partId: attachment.partId,
          chunks,
        });

        await mailVespaService.insert(attachmentDocument, mailAttachmentSchema);
      } catch (error) {
        vespaLogger.warn('Failed to index Gmail attachment into Vespa', {
          messageId: preparedMail.messageId,
          threadId: preparedMail.threadId,
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
}

export const googleMailVespaService = new GoogleMailVespaService();
