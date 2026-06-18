import { readFile, rm } from 'fs/promises';
import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import type { WhatsAppNameEmailMapping } from '@/services/whatsapp/userResolver';
import {
  whatsAppBulkMigrationService,
  type StartWhatsAppBulkJobInput,
} from '@/services/whatsappBulkMigrationService';

type MulterRequest = Request & {
  files?: {
    archives?: Express.Multer.File[];
    mappingFile?: Express.Multer.File[];
  };
};

async function cleanupUploadedFile(file?: Express.Multer.File): Promise<void> {
  if (!file?.path) return;
  await rm(file.path, { force: true }).catch(() => undefined);
}

async function cleanupUploadedFiles(files: Array<Express.Multer.File | undefined>): Promise<void> {
  await Promise.all(files.map(file => cleanupUploadedFile(file)));
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
      logger.warn('[WhatsAppBulkMigration] Invalid mapping JSON payload', {
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
      const isHeader = index === 0 && /name/i.test(first) && /email/i.test(second);
      if (isHeader) return null;
      return {
        whatsappName: first,
        email: second.toLowerCase(),
      };
    })
    .filter((mapping): mapping is WhatsAppNameEmailMapping => Boolean(mapping?.whatsappName) && Boolean(mapping?.email));
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

function parseJobs(rawJobs: unknown): StartWhatsAppBulkJobInput[] {
  let parsedJobs = rawJobs;
  if (typeof rawJobs === 'string' && rawJobs.trim()) {
    try {
      parsedJobs = JSON.parse(rawJobs) as unknown;
    } catch {
      throw new Error('Invalid jobs payload');
    }
  }

  if (!Array.isArray(parsedJobs) || parsedJobs.length === 0) {
    throw new Error('jobs is required and must be a non-empty array');
  }

  return parsedJobs.map(item => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each job must be an object');
    }

    const job = item as Record<string, unknown>;
    const stagedFileId = String(job.stagedFileId || '').trim();
    const targetChannelId = String(job.targetChannelId || '').trim();

    if (!stagedFileId || !targetChannelId) {
      throw new Error('Each job must include stagedFileId and targetChannelId');
    }

    return {
      stagedFileId,
      targetChannelId,
    };
  });
}

export class WhatsAppBulkMigrationController {
  stage = async (req: MulterRequest, res: Response): Promise<void> => {
    const archives = req.files?.archives || [];
    try {
      const actorUserId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!actorUserId || !workspaceId) {
        res.status(401).json({ error: 'Authenticated user required for WhatsApp bulk staging' });
        return;
      }

      if (archives.length === 0) {
        res.status(400).json({ error: 'At least one archive zip file is required' });
        return;
      }

      const stagedFiles = [];
      for (const archive of archives) {
        // eslint-disable-next-line no-await-in-loop
        const staged = await whatsAppBulkMigrationService.stageArchive({
          workspaceId,
          uploaderUserId: actorUserId,
          file: archive,
        });
        stagedFiles.push({
          stagedFileId: staged.stagedFileId,
          originalName: staged.originalName,
          gcsPath: staged.gcsPath,
          size: staged.size,
        });
      }

      res.json({ success: true, data: { stagedFiles } });
    } catch (error) {
      logger.error('[WhatsAppBulkMigration] Staging failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to stage WhatsApp archives',
      });
    } finally {
      await cleanupUploadedFiles(archives);
    }
  };

  start = async (req: MulterRequest, res: Response): Promise<void> => {
    const mappingFile = req.files?.mappingFile?.[0];
    try {
      const actorUserId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!actorUserId || !workspaceId) {
        res.status(401).json({ error: 'Authenticated user required for WhatsApp bulk migration' });
        return;
      }

      const jobs = parseJobs((req.body as { jobs?: unknown }).jobs);
      const stagedIds = jobs.map(job => job.stagedFileId);
      if (new Set(stagedIds).size !== stagedIds.length) {
        res.status(400).json({ error: 'Each job must reference a unique staged file' });
        return;
      }

      const mappings = await parseMappingsFromRequest(req);
      if (mappings.length === 0) {
        res.status(400).json({ error: 'Provide at least one mapping in textarea or CSV file' });
        return;
      }

      const hasApprovedPreview = await whatsAppBulkMigrationService.hasPreviewApproval({
        workspaceId,
        jobs,
        mappings,
      });
      if (!hasApprovedPreview) {
        res.status(400).json({
          error:
            'Preview this bulk migration again before starting. Preview approval is missing or outdated.',
        });
        return;
      }

      const startedJobs = await whatsAppBulkMigrationService.startBulkJobs({
        actorUserId,
        workspaceId,
        jobs,
        mappings,
        createMissingUsers: req.body.createMissingUsers !== 'false' && req.body.createMissingUsers !== false,
      });

      res.json({ success: true, data: { jobs: startedJobs } });
    } catch (error) {
      logger.error('[WhatsAppBulkMigration] Start failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to start WhatsApp bulk migration',
      });
    } finally {
      await cleanupUploadedFiles([mappingFile]);
    }
  };

  preview = async (req: MulterRequest, res: Response): Promise<void> => {
    const mappingFile = req.files?.mappingFile?.[0];
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(401).json({ error: 'Authenticated workspace required for WhatsApp bulk preview' });
        return;
      }

      const jobs = parseJobs((req.body as { jobs?: unknown }).jobs);
      const stagedIds = jobs.map(job => job.stagedFileId);
      if (new Set(stagedIds).size !== stagedIds.length) {
        res.status(400).json({ error: 'Each job must reference a unique staged file' });
        return;
      }

      const mappings = await parseMappingsFromRequest(req);
      if (mappings.length === 0) {
        res.status(400).json({ error: 'Provide at least one mapping in textarea or CSV file' });
        return;
      }

      const validationResults = await whatsAppBulkMigrationService.previewBulkJobs({
        workspaceId,
        jobs,
        mappings,
      });
      await whatsAppBulkMigrationService.clearPreviewApproval({
        workspaceId,
        jobs,
        mappings,
      });

      const unresolved = validationResults.filter(
        result => result.preview.unresolvedNames.length > 0,
      );
      if (unresolved.length === 0) {
        await whatsAppBulkMigrationService.recordPreviewApproval({
          workspaceId,
          jobs,
          mappings,
        });
      }

      res.json({ success: true, data: { validationResults } });
    } catch (error) {
      logger.error('[WhatsAppBulkMigration] Preview failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview WhatsApp bulk migration',
      });
    } finally {
      await cleanupUploadedFiles([mappingFile]);
    }
  };
}
