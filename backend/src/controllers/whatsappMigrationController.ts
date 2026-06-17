import { randomUUID } from 'crypto';
import { readFile, rm } from 'fs/promises';
import type { Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  whatsAppMigrationService,
  type WhatsAppMigrationExecuteInput,
} from '@/services/whatsappMigrationService';
import { whatsAppMigrationProgressService } from '@/services/whatsappMigrationProgressService';
import type { WhatsAppNameEmailMapping } from '@/services/whatsapp/userResolver';

type MulterRequest = Request & {
  files?: {
    archive?: Express.Multer.File[];
    mappingFile?: Express.Multer.File[];
  };
};

const db = DatabaseClient.getInstance();

async function cleanupUploadedArchive(file?: Express.Multer.File): Promise<void> {
  if (!file?.path) return;
  await rm(file.path, { force: true }).catch(() => undefined);
}

async function cleanupUploadedFiles(files: Array<Express.Multer.File | undefined>): Promise<void> {
  await Promise.all(files.map(file => cleanupUploadedArchive(file)));
}

function parseMappings(rawMappings: unknown): WhatsAppNameEmailMapping[] {
  if (Array.isArray(rawMappings)) {
    return rawMappings
      .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
      .map(value => ({
        whatsappName: String(value.whatsappName || '').trim(),
        email: String(value.email || '').trim().toLowerCase(),
      }))
      .filter(mapping => Boolean(mapping.whatsappName) && Boolean(mapping.email));
  }

  if (typeof rawMappings === 'string' && rawMappings.trim()) {
    try {
      const parsed = JSON.parse(rawMappings) as unknown;
      return parseMappings(parsed);
    } catch (error) {
      logger.warn('[WhatsAppMigration] Invalid mapping JSON payload', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Invalid mappingJson payload');
    }
  }

  return [];
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseMappingCsvContent(content: string): WhatsAppNameEmailMapping[] {
  return content
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [first = '', second = ''] = parseCsvLine(line);
      const isHeader =
        index === 0 &&
        /name/i.test(first) &&
        /email/i.test(second);
      if (isHeader) return null;
      return {
        whatsappName: first,
        email: second.toLowerCase(),
      };
    })
    .filter((mapping): mapping is WhatsAppNameEmailMapping =>
      Boolean(mapping?.whatsappName) && Boolean(mapping?.email),
    );
}

async function parseMappingsFromRequest(req: MulterRequest): Promise<WhatsAppNameEmailMapping[]> {
  const bodyMappings = parseMappings(req.body.mappingJson ?? req.body.mappings);
  const mappingFile = req.files?.mappingFile?.[0];
  if (!mappingFile?.path) {
    return bodyMappings;
  }

  const mappingFileContent = await readFile(mappingFile.path, 'utf8');
  const fileMappings = parseMappingCsvContent(mappingFileContent);
  const mergedMappings = [...bodyMappings, ...fileMappings];
  const dedupedMappings = new Map<string, WhatsAppNameEmailMapping>();

  for (const mapping of mergedMappings) {
    dedupedMappings.set(mapping.whatsappName.trim().toLowerCase(), {
      whatsappName: mapping.whatsappName.trim(),
      email: mapping.email.trim().toLowerCase(),
    });
  }

  return [...dedupedMappings.values()];
}

export class WhatsAppMigrationController {
  listSources = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      const targetChannelId = String(req.query.targetChannelId || '').trim();

      if (!workspaceId) {
        res.status(401).json({ error: 'Authenticated workspace required' });
        return;
      }

      if (!targetChannelId) {
        res.status(400).json({ error: 'targetChannelId is required' });
        return;
      }

      logger.info('[WhatsAppMigration] List sources requested', {
        workspaceId,
        targetChannelId,
      });

      const sources = await whatsAppMigrationService.listImportSources({
        workspaceId,
        targetChannelId,
      });

      logger.info('[WhatsAppMigration] List sources completed', {
        workspaceId,
        targetChannelId,
        sourceCount: sources.length,
      });

      res.json({ success: true, data: sources });
    } catch (error) {
      logger.error('WhatsApp migration sources fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch WhatsApp import sources',
      });
    }
  };

  preview = async (req: MulterRequest, res: Response): Promise<void> => {
    const archive = req.files?.archive?.[0];
    const mappingFile = req.files?.mappingFile?.[0];
    try {
      if (!archive) {
        res.status(400).json({ error: 'archive zip file is required' });
        return;
      }

      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Authenticated workspace required for WhatsApp preview' });
        return;
      }

      const mappings = await parseMappingsFromRequest(req);
      logger.info('[WhatsAppMigration] Preview requested', {
        workspaceId,
        archiveOriginalName: archive.originalname,
        archiveSize: archive.size,
        mappingCount: mappings.length,
        hasMappingFile: Boolean(mappingFile),
      });
      const result = await whatsAppMigrationService.preview({
        archivePath: archive.path,
        archiveOriginalName: archive.originalname,
        workspaceId,
        mappings,
      });

      logger.info('[WhatsAppMigration] Preview completed', {
        workspaceId,
        archiveOriginalName: archive.originalname,
        chatName: result.chatName,
        messageCount: result.messageCount,
        mediaReferenceCount: result.mediaReferenceCount,
        unresolvedCount: result.unresolvedNames.length,
        warningCount: result.warnings.length,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('WhatsApp migration preview failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview WhatsApp migration',
      });
    } finally {
      await cleanupUploadedFiles([archive, mappingFile]);
    }
  };

  execute = async (req: MulterRequest, res: Response): Promise<void> => {
    const archive = req.files?.archive?.[0];
    const mappingFile = req.files?.mappingFile?.[0];
    try {
      if (!archive) {
        res.status(400).json({ error: 'archive zip file is required' });
        return;
      }

      const actorUserId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!actorUserId || !workspaceId) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(401).json({ error: 'Authenticated user required for WhatsApp migration' });
        return;
      }

      const { targetProjectId, targetChannelId } = req.body as {
        targetProjectId?: string;
        targetChannelId?: string;
      };

      if (!targetProjectId || !targetChannelId) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(400).json({ error: 'targetProjectId and targetChannelId are required' });
        return;
      }

      const channel = await db.channel.findUnique({
        where: { id: targetChannelId },
        select: { id: true, projectId: true, workspaceId: true },
      });
      if (!channel) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(404).json({ error: 'Target channel not found' });
        return;
      }
      if (channel.projectId !== targetProjectId) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(400).json({ error: 'Target channel does not belong to targetProjectId' });
        return;
      }
      if (channel.workspaceId !== workspaceId) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(403).json({ error: 'Target channel does not belong to your workspace' });
        return;
      }

      const mappings = await parseMappingsFromRequest(req);
      if (mappings.length === 0) {
        await cleanupUploadedFiles([archive, mappingFile]);
        res.status(400).json({ error: 'Provide at least one mapping in textarea or CSV file' });
        return;
      }

      const jobId = randomUUID();
      await whatsAppMigrationProgressService.createJob(jobId, {
        targetProjectId,
        targetChannelId,
        chatName: null,
      });

      const input: WhatsAppMigrationExecuteInput = {
        archivePath: archive.path,
        archiveOriginalName: archive.originalname,
        targetProjectId,
        targetChannelId,
        mappings,
        actorUserId,
        workspaceId,
        createMissingUsers: req.body.createMissingUsers !== 'false' && req.body.createMissingUsers !== false,
      };

      logger.info('[WhatsAppMigration] Execute requested', {
        jobId,
        actorUserId,
        workspaceId,
        targetProjectId,
        targetChannelId,
        archiveOriginalName: archive.originalname,
        archiveSize: archive.size,
        mappingCount: mappings.length,
        hasMappingFile: Boolean(mappingFile),
      });

      res.json({ success: true, data: { jobId } });

      void Promise.resolve()
        .then(async () => {
          await whatsAppMigrationService.execute(jobId, input);
        })
        .catch(dispatchError => {
          logger.error('[WhatsAppMigration] Background execute dispatch failed', dispatchError, {
            jobId,
          });
        });
    } catch (error) {
      await cleanupUploadedFiles([archive, mappingFile]);
      logger.error('WhatsApp migration execute failed', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to execute WhatsApp migration',
        });
      }
    }
  };

  status = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await whatsAppMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      res.json({ success: true, data: job });
    } catch (error) {
      logger.error('WhatsApp migration status fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch WhatsApp migration status',
      });
    }
  };

  purgeImport = async (req: Request, res: Response): Promise<void> => {
    try {
      const actorUserId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!actorUserId || !workspaceId) {
        res.status(401).json({ error: 'Authenticated user required' });
        return;
      }

      const { externalSourceId, targetChannelId, dryRun } = req.body as {
        externalSourceId?: string;
        targetChannelId?: string;
        dryRun?: boolean;
      };

      if (!externalSourceId || !targetChannelId) {
        res.status(400).json({ error: 'externalSourceId and targetChannelId are required' });
        return;
      }

      const isDryRun = dryRun !== false && (dryRun as unknown) !== 'false';

      logger.info('[WhatsAppMigration] Purge requested', {
        actorUserId,
        workspaceId,
        targetChannelId,
        externalSourceId,
        dryRun: isDryRun,
      });

      const result = await whatsAppMigrationService.purgeImport({
        workspaceId,
        actorUserId,
        targetChannelId,
        externalSourceId,
        dryRun: isDryRun,
      });

      logger.info('[WhatsAppMigration] Purge completed', {
        actorUserId,
        targetChannelId,
        externalSourceId,
        dryRun: isDryRun,
        importedMessageCount: result.stats.importedMessageCount,
        attachmentCount: result.stats.attachmentCount,
        result: result.result || null,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('WhatsApp migration purge failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to purge WhatsApp import',
      });
    }
  };
}
