import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Prisma } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { initializeYSweetDoc, syncToYSweet } from '@/utils/ysweetUtils';
import { getStorageService } from '@/services/storage';
import { config } from '@/config/env';
import { ProjectRepository } from '@/database/repositories/projectRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { sanitizeProjectCode,
  AttachmentEntityType,
  CanvasRole,
  CanvasVisibility,
  DocType,
  ExternalEntityType,
  MessageDirection, ChannelRole, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { encrypt } from '@/services/encryptionService';
import { ConfluenceClient, type ConfluenceContentRestrictions, type ConfluencePage } from './confluenceClient';
import { resolveConfluenceCanvasVisibility, type ConfluenceRestrictionDecision } from './contentRestrictions';
import {
  hasMeaningfulConfluenceContent,
  rewriteConfluenceCanvasLinks,
  shouldPreferRenderedConfluenceView,
  transformConfluenceStorageToMarkdown,
} from './contentTransformer';
import { ConfluenceUserResolver, type UnresolvedConfluenceUser } from './userResolver';
import { buildConfluencePageTree, getConfluenceSectionRoots, type ConfluencePageTreeNode } from './pageTree';

export type ConfluenceSectionMapping =
  | { type: 'channel'; channelId?: string; channelName?: string }
  | { type: 'channelFolder'; channelId?: string }
  | { type: 'projectFolder' };

export interface ConfluenceImportConfig {
  spaceKey: string;
  projectId?: string;
  projectName?: string;
  projectCode?: string;
  workspaceId?: string;
  actorUserId: string;
  targetChannelId?: string;
  targetChannelName?: string;
  sectionMappings?: Record<string, ConfluenceSectionMapping>;
  migrateAttachments?: boolean;
  frontendBaseUrl?: string;
  createProjectIfMissing?: boolean;
  createDefaultChannel?: boolean;
  defaultDestination?: 'projectFolder' | 'channelFolder';
  defaultChannelId?: string;
  externalSourceId?: string;
}

export interface ConfluenceImportSummary {
  spaceKey: string;
  projectId: string;
  createdProject: boolean;
  reusedProject: boolean;
  defaultChannelId?: string;
  externalSourceId?: string;
  createdChannels: number;
  reusedChannels: number;
  totalPages: number;
  createdCanvases: number;
  updatedCanvases: number;
  createdFolders: number;
  reusedFolders: number;
  migratedAttachments: number;
  reusedAttachments: number;
  failedAttachments: number;
  containerPagesWithContent: number;
  containerCanvasesCreated: number;
  containerCanvasesUpdated: number;
  unresolvedUsers: UnresolvedConfluenceUser[];
  warnings: string[];
  pageResults: Array<{
    confluencePageId: string;
    canvasId?: string;
    title: string;
    createdByUserId?: string;
    visibility?: CanvasVisibility;
    confluenceReadRestricted?: boolean;
    confluenceRestrictionStatus?: 'checked' | 'unknown';
    isContainerPage?: boolean;
    containerPageHasContent?: boolean;
    status: 'created' | 'updated' | 'partial' | 'failed';
    failedStep?: 'canvas' | 'attachments' | 'link_rewrite' | null;
    errors?: string[];
    destination?: PageDestination;
    error?: string;
  }>;
}

export interface ConfluenceImportProgressUpdate {
  totalPages: number;
  processedPages: number;
  createdCanvases: number;
  updatedCanvases: number;
  createdFolders: number;
  reusedFolders: number;
  migratedAttachments: number;
  reusedAttachments: number;
  failedAttachments: number;
  containerPagesWithContent: number;
  containerCanvasesCreated: number;
  containerCanvasesUpdated: number;
  warnings: string[];
  unresolvedUsers: UnresolvedConfluenceUser[];
  currentStep: string;
  currentPageTitle?: string | null;
  pageResult?: ConfluenceImportSummary['pageResults'][number];
}

interface PageDestination {
  type: 'channel' | 'projectFolder' | 'channelFolder';
  projectId: string;
  channelId?: string;
  folderId?: string;
  folderName?: string;
  sectionTitle: string;
}

interface PreparedPage {
  page: ConfluencePage;
  breadcrumb: string[];
  topLevelPageId: string;
  topLevelSectionTitle: string;
  destination: PageDestination;
  isContainerPage: boolean;
  containerPageHasContent: boolean;
}

interface SectionContext {
  topLevelPageId: string;
  topLevelTitle: string;
  destination: PageDestination;
}

interface AttachmentMigrationResult {
  urlByFileName: Map<string, string>;
  migratedCount: number;
  reusedCount: number;
  failedCount: number;
  errors: string[];
}

const db = DatabaseClient.getInstance();
const projectRepository = new ProjectRepository();
const channelRepository = new ChannelRepository();
const channelParticipantRepository = new ChannelParticipantRepository();
const DEFAULT_PROJECT_CANVAS_FOLDER_NAME = 'Default';

interface ResolvedImportTarget {
  projectId: string;
  workspaceId: string;
  createdProject: boolean;
  reusedProject: boolean;
  defaultChannelId?: string;
  externalSourceId?: string;
  createdChannels: number;
  reusedChannels: number;
}

export class ConfluenceImportService {
  private readonly contentRestrictionCache = new Map<string, Promise<ConfluenceContentRestrictions>>();
  private confluenceClient?: ConfluenceClient;

  constructor(client?: ConfluenceClient) {
    this.confluenceClient = client;
  }

  private get client(): ConfluenceClient {
    if (!this.confluenceClient) {
      this.confluenceClient = ConfluenceClient.fromEnv();
    }
    return this.confluenceClient;
  }

  async importSpace(
    input: ConfluenceImportConfig,
    onProgress?: (update: ConfluenceImportProgressUpdate) => Promise<void> | void,
  ): Promise<ConfluenceImportSummary> {
    const summary: ConfluenceImportSummary = {
      spaceKey: input.spaceKey,
      projectId: input.projectId || '',
      createdProject: false,
      reusedProject: false,
      createdChannels: 0,
      reusedChannels: 0,
      totalPages: 0,
      createdCanvases: 0,
      updatedCanvases: 0,
      createdFolders: 0,
      reusedFolders: 0,
      migratedAttachments: 0,
      reusedAttachments: 0,
      failedAttachments: 0,
      containerPagesWithContent: 0,
      containerCanvasesCreated: 0,
      containerCanvasesUpdated: 0,
      unresolvedUsers: [],
      warnings: [],
      pageResults: [],
    };

    const [space, pages] = await Promise.all([
      this.client.getSpace(input.spaceKey),
      this.client.fetchAllPages(input.spaceKey),
    ]);
    const target = await this.resolveImportTarget(input, space.name);
    const externalSourceId = await this.ensureExternalSource(input, space.name, target);
    const resolvedInput: ConfluenceImportConfig = {
      ...input,
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      defaultChannelId: target.defaultChannelId,
      externalSourceId,
    };
    summary.projectId = target.projectId;
    summary.createdProject = target.createdProject;
    summary.reusedProject = target.reusedProject;
    summary.defaultChannelId = target.defaultChannelId;
    summary.externalSourceId = externalSourceId;
    summary.createdChannels = target.createdChannels;
    summary.reusedChannels = target.reusedChannels;

    await this.validateTarget(resolvedInput);
    summary.totalPages = pages.length;
    await this.emitProgress(summary, 'fetched_pages', null, onProgress);

    logger.info('[ConfluenceImport] Starting import', {
      spaceKey: space.key,
      spaceName: space.name,
      projectId: resolvedInput.projectId,
      totalPages: pages.length,
    });

    const pageIdByTitle = this.buildPageTitleIndex(pages, summary.warnings);
    const preparedPages = await this.preparePages(resolvedInput, buildConfluencePageTree(pages).roots, summary);
    const unresolvedUsers = new Map<string, UnresolvedConfluenceUser>();
    const userResolver = new ConfluenceUserResolver(target.workspaceId);
    await userResolver.warmUserResolutionLookup();
    const fallbackUserId = await this.resolveFallbackUserId(
      target.workspaceId,
      resolvedInput.actorUserId,
      summary.warnings,
    );
    const confluencePageIdToCanvasId = new Map<string, string>();
    const rawMarkdownByPageId = new Map<string, string>();
    const lastEditorUserIdByPageId = new Map<string, string>();

    for (const [index, prepared] of preparedPages.entries()) {
      const result = await this.createOrUpdateInitialCanvas(
        prepared,
        resolvedInput,
        pageIdByTitle,
        summary,
        userResolver,
        unresolvedUsers,
        fallbackUserId,
      );
      summary.unresolvedUsers = Array.from(unresolvedUsers.values());
      await this.emitProgress(
        summary,
        'importing_pages',
        prepared.breadcrumb.join(' / '),
        onProgress,
        summary.pageResults.at(-1),
      );
      if (!result) continue;

      confluencePageIdToCanvasId.set(prepared.page.id, result.canvasId);
      rawMarkdownByPageId.set(prepared.page.id, result.rawMarkdown);
      lastEditorUserIdByPageId.set(prepared.page.id, result.lastEditorUserId);
      await this.applyImportBatchCooldown(index + 1, preparedPages.length, 'importing_pages');
    }

    const canvasUrlByConfluencePageId = await this.buildCanvasUrlMap(
      confluencePageIdToCanvasId,
      resolvedInput.workspaceId,
    );

    for (const [index, prepared] of preparedPages.entries()) {
      const canvasId = confluencePageIdToCanvasId.get(prepared.page.id);
      const rawMarkdown = rawMarkdownByPageId.get(prepared.page.id);
      const lastEditorUserId = lastEditorUserIdByPageId.get(prepared.page.id);
      if (!canvasId || rawMarkdown === undefined || !lastEditorUserId) continue;

      try {
        const finalMarkdown = rewriteConfluenceCanvasLinks(
          rawMarkdown,
          canvasUrlByConfluencePageId,
          config.confluence.baseUrl,
        );
        await this.updateCanvasContent(canvasId, finalMarkdown, lastEditorUserId, prepared, resolvedInput);
        await this.queueCanvasVespaJob(canvasId, lastEditorUserId);
        await this.emitProgress(summary, 'rewriting_internal_links', prepared.breadcrumb.join(' / '), onProgress);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[ConfluenceImport] Failed to rewrite internal links for page', error, {
          confluencePageId: prepared.page.id,
          canvasId,
          title: prepared.page.title,
        });
        summary.warnings.push(
          `Failed to rewrite internal Confluence links for page ${prepared.page.id} (${prepared.page.title}): ${message}`,
        );
        const pageResult = this.markPageResultPartial(
          summary,
          prepared.page.id,
          'link_rewrite',
          message,
        );
        await this.emitProgress(
          summary,
          'rewriting_internal_links',
          prepared.breadcrumb.join(' / '),
          onProgress,
          pageResult,
        );
      }
      await this.applyImportBatchCooldown(index + 1, preparedPages.length, 'rewriting_internal_links');
    }

    summary.unresolvedUsers = Array.from(unresolvedUsers.values());

    logger.info('[ConfluenceImport] Import completed', {
      spaceKey: input.spaceKey,
      createdCanvases: summary.createdCanvases,
      updatedCanvases: summary.updatedCanvases,
      warnings: summary.warnings.length,
    });

    return summary;
  }

  private async emitProgress(
    summary: ConfluenceImportSummary,
    currentStep: string,
    currentPageTitle: string | null,
    onProgress?: (update: ConfluenceImportProgressUpdate) => Promise<void> | void,
    pageResult?: ConfluenceImportSummary['pageResults'][number],
  ): Promise<void> {
    if (!onProgress) return;

    await onProgress({
      totalPages: summary.totalPages,
      processedPages: summary.pageResults.length,
      createdCanvases: summary.createdCanvases,
      updatedCanvases: summary.updatedCanvases,
      createdFolders: summary.createdFolders,
      reusedFolders: summary.reusedFolders,
      migratedAttachments: summary.migratedAttachments,
      reusedAttachments: summary.reusedAttachments,
      failedAttachments: summary.failedAttachments,
      containerPagesWithContent: summary.containerPagesWithContent,
      containerCanvasesCreated: summary.containerCanvasesCreated,
      containerCanvasesUpdated: summary.containerCanvasesUpdated,
      warnings: summary.warnings,
      unresolvedUsers: summary.unresolvedUsers,
      currentStep,
      currentPageTitle,
      pageResult,
    });
  }

  private async applyImportBatchCooldown(
    processedCount: number,
    totalCount: number,
    phase: string,
  ): Promise<void> {
    const batchSize = config.confluence.importBatchSize;
    const cooldownMs = config.confluence.importBatchCooldownMs;
    if (cooldownMs <= 0 || processedCount >= totalCount || processedCount % batchSize !== 0) {
      return;
    }

    logger.info('[ConfluenceImport] Applying import batch cooldown', {
      phase,
      processedCount,
      totalCount,
      batchSize,
      cooldownMs,
    });
    await this.sleep(cooldownMs);
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async validateTarget(input: ConfluenceImportConfig): Promise<void> {
    if (!input.projectId) {
      throw new Error('Target project was not resolved for Confluence import');
    }

    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (!project) {
      throw new Error(`Target project ${input.projectId} not found`);
    }

    const actorMembership = await db.channelParticipant.findFirst({
      where: {
        userId: input.actorUserId,
        channel: { projectId: input.projectId },
      },
      select: { id: true },
    });
    if (!actorMembership) {
      throw new Error(`Actor user ${input.actorUserId} must belong to at least one channel in project ${input.projectId}`);
    }

    const mappedChannelIds = Object.values(input.sectionMappings || {})
      .filter((mapping): mapping is { type: 'channel' | 'channelFolder'; channelId: string } =>
        (mapping.type === 'channel' || mapping.type === 'channelFolder') && typeof mapping.channelId === 'string',
      )
      .map(mapping => mapping.channelId);

    if (mappedChannelIds.length > 0) {
      const channels = await db.channel.findMany({
        where: { id: { in: mappedChannelIds } },
        select: { id: true, projectId: true, isArchived: true },
      });
      const channelById = new Map(channels.map(channel => [channel.id, channel]));

      for (const channelId of mappedChannelIds) {
        const channel = channelById.get(channelId);
        if (!channel) throw new Error(`Mapped channel ${channelId} not found`);
        if (channel.projectId !== input.projectId) {
          throw new Error(`Mapped channel ${channelId} does not belong to project ${input.projectId}`);
        }
        if (channel.isArchived) {
          throw new Error(`Mapped channel ${channelId} is archived`);
        }

        const channelMembership = await db.channelParticipant.findUnique({
          where: {
            channelId_userId: {
              channelId,
              userId: input.actorUserId,
            },
          },
          select: { id: true },
        });
        if (!channelMembership) {
          throw new Error(`Actor user ${input.actorUserId} must belong to mapped channel ${channelId}`);
        }
      }
    }
  }

  private async resolveImportTarget(
    input: ConfluenceImportConfig,
    spaceName: string,
  ): Promise<ResolvedImportTarget> {
    const actor = await db.user.findUnique({
      where: { id: input.actorUserId },
      select: { workspaceId: true },
    });
    const workspaceId = input.workspaceId || actor?.workspaceId;
    if (!workspaceId) {
      throw new Error(`Could not resolve workspace for actor user ${input.actorUserId}`);
    }

    let createdProject = false;
    let reusedProject = false;
    let projectId = input.projectId;
    let defaultChannelId = input.defaultChannelId;
    let createdChannels = 0;
    let reusedChannels = 0;

    if (input.targetChannelId || input.targetChannelName) {
      const targetChannel = await this.resolveTargetChannel({
        channelId: input.targetChannelId,
        channelName: input.targetChannelName,
        workspaceId,
      });

      projectId = targetChannel.projectId;
      defaultChannelId = targetChannel.id;
      reusedProject = true;
      reusedChannels += 1;
    }

    if (projectId) {
      reusedProject = true;
    } else {
      if (input.createProjectIfMissing === false) {
        throw new Error('targetProjectId is required when createProjectIfMissing is false');
      }

      const projectName = input.projectName || spaceName || input.spaceKey;
      const existingProject = await db.project.findFirst({
        where: { workspaceId, name: projectName },
        select: { id: true },
      });

      if (existingProject) {
        projectId = existingProject.id;
        reusedProject = true;
      } else {
        const project = await projectRepository.create({
          name: projectName,
          code: await this.generateProjectCode(input.projectCode || input.spaceKey, workspaceId),
          workspaceId,
          createdBy: input.actorUserId,
          description: `Imported from Confluence space ${input.spaceKey}`,
        });
        projectId = project.id;
        createdProject = true;
      }
    }

    if (!projectId) {
      throw new Error('Unable to create or resolve target project for Confluence import');
    }

    if (!defaultChannelId && input.createDefaultChannel !== false) {
      const result = await this.findOrCreateProjectChannel({
        projectId,
        workspaceId,
        actorUserId: input.actorUserId,
        channelName: `${input.projectName || spaceName || input.spaceKey} General`,
      });
      defaultChannelId = result.channelId;
      createdChannels += result.created ? 1 : 0;
      reusedChannels += result.created ? 0 : 1;
    }

    return {
      projectId,
      workspaceId,
      createdProject,
      reusedProject,
      defaultChannelId,
      createdChannels,
      reusedChannels,
    };
  }

  private async resolveTargetChannel(input: {
    channelId?: string;
    channelName?: string;
    workspaceId: string;
  }): Promise<{ id: string; name: string; projectId: string }> {
    if (input.channelId) {
      const channel = await db.channel.findFirst({
        where: {
          id: input.channelId,
          workspaceId: input.workspaceId,
          isArchived: false,
        },
        select: { id: true, name: true, projectId: true },
      });

      if (!channel) {
        throw new Error(`Target channel ${input.channelId} not found`);
      }

      return channel;
    }

    const channelName = input.channelName?.trim();
    if (!channelName) {
      throw new Error('targetChannelId or targetChannelName is required');
    }

    const channels = await db.channel.findMany({
      where: {
        workspaceId: input.workspaceId,
        name: { equals: channelName, mode: 'insensitive' },
        isArchived: false,
      },
      select: { id: true, name: true, projectId: true },
      take: 2,
    });

    if (channels.length === 0) {
      throw new Error(`Target channel "${channelName}" not found`);
    }
    if (channels.length > 1) {
      throw new Error(`Target channel "${channelName}" matched multiple channels; select the channel from the UI`);
    }

    return channels[0]!;
  }

  private async ensureExternalSource(
    input: ConfluenceImportConfig,
    spaceName: string,
    target: ResolvedImportTarget,
  ): Promise<string> {
    const sourceName = `confluence-${input.spaceKey}-${target.projectId}`.toLowerCase();
    const credentials = encrypt(JSON.stringify({
      baseUrl: this.client.getBaseUrl(),
      spaceKey: input.spaceKey,
      projectId: target.projectId,
    }));

    const existingSource = await db.externalSource.findUnique({
      where: { name: sourceName },
      select: { id: true },
    });

    if (existingSource) {
      await db.externalSource.update({
        where: { id: existingSource.id },
        data: {
          sourceType: 'confluence',
          displayName: `Confluence (${spaceName || input.spaceKey})`,
          channelId: target.defaultChannelId || null,
          boardId: null,
          credentials,
          isActive: true,
        },
      });

      return existingSource.id;
    }

    const createdSource = await db.externalSource.create({
      data: {
        name: sourceName,
        sourceType: 'confluence',
        displayName: `Confluence (${spaceName || input.spaceKey})`,
        channelId: target.defaultChannelId || null,
        boardId: null,
        credentials,
        isActive: true,
        workspaceId: target.workspaceId,
      },
      select: { id: true },
    });

    return createdSource.id;
  }

  private async generateProjectCode(baseCode: string, workspaceId: string): Promise<string> {
    const sanitizedBase = sanitizeProjectCode(baseCode || 'CONF') || 'CONF';
    const sanitized = sanitizedBase.length >= 3
      ? sanitizedBase.slice(0, 8)
      : `${sanitizedBase}${'CONF'.slice(0, 3 - sanitizedBase.length)}`;
    let candidate = sanitized;
    let suffix = 1;

    while (await db.project.findFirst({ where: { workspaceId, code: candidate }, select: { id: true } })) {
      const nextSuffix = String(suffix);
      candidate = `${sanitized.slice(0, Math.max(1, 8 - nextSuffix.length))}${nextSuffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private async resolveFallbackUserId(
    workspaceId: string,
    actorUserId: string,
    warnings: string[],
  ): Promise<string> {
    const fallbackUser = await db.user.findFirst({
      where: {
        workspaceId,
        email: config.confluence.migrationFallbackEmail,
      },
      select: { id: true },
    });

    if (fallbackUser) {
      return fallbackUser.id;
    }

    const warning = `Configured Confluence fallback user ${config.confluence.migrationFallbackEmail} was not found; unresolved Confluence authors will fall back to migration actor.`;
    warnings.push(warning);
    logger.warn('[ConfluenceImport] Configured fallback user not found; using actor user', {
      configuredFallbackEmail: config.confluence.migrationFallbackEmail,
      actorUserId,
      workspaceId,
    });

    return actorUserId;
  }

  private buildPageTitleIndex(pages: ConfluencePage[], warnings: string[]): Map<string, string> {
    const index = new Map<string, string>();
    const duplicateTitles = new Set<string>();

    for (const page of pages) {
      if (index.has(page.title)) {
        duplicateTitles.add(page.title);
      } else {
        index.set(page.title, page.id);
      }
    }

    for (const title of duplicateTitles) {
      index.delete(title);
      warnings.push(`Confluence page title "${title}" is duplicated; title-only links to it will not be rewritten`);
    }

    return index;
  }

  private async preparePages(
    input: ConfluenceImportConfig,
    roots: ConfluencePageTreeNode[],
    summary: ConfluenceImportSummary,
  ): Promise<PreparedPage[]> {
    const prepared: PreparedPage[] = [];
    const folderIdBySection = new Map<string, string>();

    const visit = async (node: ConfluencePageTreeNode, breadcrumb: string[], section: SectionContext): Promise<void> => {
      const nextBreadcrumb = [...breadcrumb, node.page.title];
      const isLeafPage = node.children.length === 0;
      const containerPageHasContent = !isLeafPage && !node.isVirtual && this.pageHasMeaningfulContent(node.page);

      if ((isLeafPage || containerPageHasContent) && !node.isVirtual) {
        prepared.push({
          page: node.page,
          breadcrumb: nextBreadcrumb,
          topLevelPageId: section.topLevelPageId,
          topLevelSectionTitle: section.topLevelTitle,
          destination: section.destination,
          isContainerPage: !isLeafPage,
          containerPageHasContent,
        });
        if (containerPageHasContent) {
          summary.containerPagesWithContent += 1;
        }
      }

      for (const child of node.children.sort((a, b) => a.page.title.localeCompare(b.page.title))) {
        await visit(child, nextBreadcrumb, section);
      }
    };

    const { sectionRoots, spaceHomePage } = getConfluenceSectionRoots(roots);

    if (spaceHomePage) {
      summary.warnings.push(
        `Detected "${spaceHomePage.page.title}" as the Confluence space home page; using its direct children as top-level sections.`,
      );
    }

    for (const root of sectionRoots) {
      const explicitMapping = input.sectionMappings?.[root.page.title];
      const destination = explicitMapping
        ? await this.resolveDestination(input, root.page.title, explicitMapping, folderIdBySection, summary)
        : input.defaultDestination === 'projectFolder'
          ? await this.resolveDestination(
            input,
            root.page.title,
            { type: 'projectFolder' },
            folderIdBySection,
            summary,
          )
        : root.children.length > 0
          ? await this.resolveDestination(
            input,
            root.page.title,
            { type: 'channelFolder' },
            folderIdBySection,
            summary,
          )
          : this.resolveChannelDestination(input, root.page.title);

      await visit(root, [], {
        topLevelPageId: root.page.id,
        topLevelTitle: root.page.title,
        destination,
      });
    }

    return prepared;
  }

  private pageHasMeaningfulContent(page: ConfluencePage): boolean {
    return hasMeaningfulConfluenceContent(this.getPageBodyForTransform(page));
  }

  private getPageBodyForTransform(page: ConfluencePage): string {
    const storage = page.body?.storage?.value || '';
    const view = page.body?.view?.value || '';
    const shouldPreferRenderedView = shouldPreferRenderedConfluenceView(storage);

    return shouldPreferRenderedView && view ? view : storage || view;
  }

  private resolveChannelDestination(
    input: ConfluenceImportConfig,
    sectionTitle: string,
  ): PageDestination {
    if (!input.projectId) {
      throw new Error('Target project was not resolved for Confluence channel destination');
    }
    if (!input.defaultChannelId) {
      throw new Error(`No default channel found for Confluence page "${sectionTitle}"`);
    }

    return {
      type: 'channel',
      projectId: input.projectId,
      channelId: input.defaultChannelId,
      sectionTitle,
    };
  }

  private async resolveDestination(
    input: ConfluenceImportConfig,
    sectionTitle: string,
    mapping: ConfluenceSectionMapping,
    folderIdBySection: Map<string, string>,
    summary: ConfluenceImportSummary,
  ): Promise<PageDestination> {
    if (!input.projectId) {
      throw new Error('Target project was not resolved for Confluence destination');
    }
    const workspaceId = input.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId required: Confluence import target not resolved');
    }

    if (mapping.type === 'channel') {
      const channelId = mapping.channelId || (await this.findOrCreateProjectChannel({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        channelName: mapping.channelName || sectionTitle,
      }).then(result => {
        summary.createdChannels += result.created ? 1 : 0;
        summary.reusedChannels += result.created ? 0 : 1;
        return result.channelId;
      }));

      return {
        type: 'channel',
        projectId: input.projectId,
        channelId,
        sectionTitle,
      };
    }

    if (mapping.type === 'channelFolder') {
      const channelId = mapping.channelId || input.defaultChannelId;
      if (!channelId) {
        throw new Error(`No default channel found for Confluence section folder "${sectionTitle}"`);
      }

      const folderId = await this.findOrCreateCanvasFolder({
        projectId: input.projectId,
        channelId,
        workspaceId,
        actorUserId: input.actorUserId,
        sectionTitle,
        folderIdBySection,
        summary,
      });

      return {
        type: 'channelFolder',
        projectId: input.projectId,
        channelId,
        folderId,
        folderName: sectionTitle,
        sectionTitle,
      };
    }

    const folderName = DEFAULT_PROJECT_CANVAS_FOLDER_NAME;
    const cacheKey = `project-default:${input.projectId}`;
    let folderId = folderIdBySection.get(cacheKey);
    if (!folderId) {
      const existingFolder = await db.canvasFolder.findFirst({
        where: {
          projectId: input.projectId,
          channelId: null,
          name: folderName,
        },
        select: { id: true },
      });

      if (existingFolder) {
        folderId = existingFolder.id;
        summary.reusedFolders += 1;
      } else {
        const folder = await db.canvasFolder.create({
          data: {
            id: uuidv4(),
            projectId: input.projectId,
            channelId: null,
            name: folderName,
            createdBy: input.actorUserId,
            workspaceId,
          },
          select: { id: true },
        });
        folderId = folder.id;
        summary.createdFolders += 1;
      }

      folderIdBySection.set(cacheKey, folderId);
    }

    return {
      type: 'projectFolder',
      projectId: input.projectId,
      folderId,
      folderName,
      sectionTitle,
    };
  }

  private async findOrCreateCanvasFolder(input: {
    projectId: string;
    channelId: string | null;
    workspaceId: string;
    actorUserId: string;
    sectionTitle: string;
    folderIdBySection: Map<string, string>;
    summary: ConfluenceImportSummary;
  }): Promise<string> {
    const cacheKey = `${input.channelId || 'project'}:${input.sectionTitle}`;
    const cachedFolderId = input.folderIdBySection.get(cacheKey);
    if (cachedFolderId) return cachedFolderId;

    const existingFolder = await db.canvasFolder.findFirst({
      where: {
        projectId: input.projectId,
        channelId: input.channelId,
        name: input.sectionTitle,
      },
      select: { id: true },
    });

    if (existingFolder) {
      input.summary.reusedFolders += 1;
      input.folderIdBySection.set(cacheKey, existingFolder.id);
      return existingFolder.id;
    }

    const folder = await db.canvasFolder.create({
      data: {
        id: uuidv4(),
        projectId: input.projectId,
        channelId: input.channelId,
        name: input.sectionTitle,
        createdBy: input.actorUserId,
        workspaceId: input.workspaceId,
      },
      select: { id: true },
    });

    input.summary.createdFolders += 1;
    input.folderIdBySection.set(cacheKey, folder.id);
    return folder.id;
  }

  private async findOrCreateProjectChannel(input: {
    projectId: string;
    workspaceId?: string;
    actorUserId: string;
    channelName: string;
  }): Promise<{ channelId: string; created: boolean }> {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { workspaceId: true },
    });
    const workspaceId = input.workspaceId || project?.workspaceId;
    if (!workspaceId) {
      throw new Error(`Could not resolve workspace for project ${input.projectId}`);
    }

    const existingChannel = await db.channel.findFirst({
      where: {
        projectId: input.projectId,
        name: input.channelName,
        isArchived: false,
      },
      select: { id: true },
    });

    if (existingChannel) {
      await channelParticipantRepository.addParticipant(existingChannel.id, input.actorUserId, ChannelRole.ADMIN);
      return { channelId: existingChannel.id, created: false };
    }

    const uniqueName = await this.generateUniqueChannelName(input.channelName, workspaceId);
    const channel = await channelRepository.create({
      name: uniqueName,
      description: `Created for Confluence import`,
      scopeType: ChannelScopeType.DEFAULT,
      visibility: ChannelVisibility.PUBLIC,
      createdBy: input.actorUserId,
      projectId: input.projectId,
      workspaceId,
    });

    await channelParticipantRepository.addParticipant(channel.id, input.actorUserId, ChannelRole.ADMIN);
    return { channelId: channel.id, created: true };
  }

  private async generateUniqueChannelName(baseName: string, workspaceId: string): Promise<string> {
    let candidate = baseName.trim() || 'Confluence Import';
    let suffix = 1;

    while (await db.channel.findFirst({ where: { workspaceId, name: candidate }, select: { id: true } })) {
      suffix += 1;
      candidate = `${baseName} ${suffix}`;
    }

    return candidate;
  }

  private async createOrUpdateInitialCanvas(
    prepared: PreparedPage,
    input: ConfluenceImportConfig,
    pageIdByTitle: Map<string, string>,
    summary: ConfluenceImportSummary,
    userResolver: ConfluenceUserResolver,
    unresolvedUsers: Map<string, UnresolvedConfluenceUser>,
    fallbackUserId: string,
  ): Promise<{ canvasId: string; rawMarkdown: string; lastEditorUserId: string } | null> {
    const page = prepared.page;

    try {
      if (!input.projectId) {
        throw new Error('Target project was not resolved for Confluence page import');
      }
      const workspaceId = input.workspaceId;
      if (!workspaceId) {
        throw new Error('workspaceId required: Confluence import config missing workspaceId');
      }

      const existingCanvas = await this.findExistingCanvas(page.id, input.projectId, input.externalSourceId);
      const canvasId = existingCanvas?.id || uuidv4();
      const creatorUserId = await userResolver.resolveUser(
        page.history?.createdBy,
        fallbackUserId,
        unresolvedUsers,
        page.id,
      );
      const lastEditorUserId = page.history?.lastUpdated?.by
        ? await userResolver.resolveUser(
            page.history.lastUpdated.by,
            creatorUserId,
            unresolvedUsers,
            page.id,
          )
        : creatorUserId;
      const visibilityDecision = await this.resolveCanvasVisibility(prepared, summary.warnings);
      const attachmentResult = input.migrateAttachments === false
        ? { urlByFileName: new Map<string, string>(), migratedCount: 0, reusedCount: 0, failedCount: 0, errors: [] }
        : await this.migrateAttachmentsForPage(
            page.id,
            prepared.topLevelPageId,
            canvasId,
            input.actorUserId,
            workspaceId,
            input.externalSourceId,
            summary.warnings,
          );

      summary.migratedAttachments += attachmentResult.migratedCount;
      summary.reusedAttachments += attachmentResult.reusedCount;
      summary.failedAttachments += attachmentResult.failedCount;
      const attachmentErrors = attachmentResult.errors;
      const resultStatus = (baseStatus: 'created' | 'updated'): 'created' | 'updated' | 'partial' =>
        attachmentErrors.length > 0 ? 'partial' : baseStatus;

      const rawMarkdown = transformConfluenceStorageToMarkdown(this.getPageBodyForTransform(page), {
        baseUrl: this.client.getBaseUrl(),
        pageIdByTitle,
        attachmentUrlByFileName: attachmentResult.urlByFileName,
        warnings: summary.warnings,
      });

      const content = await convertMarkdownToBlockNote(rawMarkdown);
      const checksum = checksumMarkdown(rawMarkdown);
      const title = page.title;

      const sourceUrl = this.client.getWebUrl(page._links?.webui);

      if (existingCanvas) {
        await this.updateCanvasRecord(existingCanvas.id, title, content, input.actorUserId, creatorUserId, lastEditorUserId, prepared, input, visibilityDecision, checksum, sourceUrl, existingCanvas.metadata);
        await this.ensureCanvasExternalMapping(input.externalSourceId, page.id, prepared.topLevelPageId, existingCanvas.id, workspaceId);
        summary.updatedCanvases += 1;
        if (prepared.isContainerPage) summary.containerCanvasesUpdated += 1;
        summary.pageResults.push({
          confluencePageId: page.id,
          canvasId: existingCanvas.id,
          title,
          createdByUserId: creatorUserId,
          visibility: visibilityDecision.visibility,
          confluenceReadRestricted: visibilityDecision.hasReadRestriction ?? undefined,
          confluenceRestrictionStatus: visibilityDecision.status,
          isContainerPage: prepared.isContainerPage,
          containerPageHasContent: prepared.containerPageHasContent,
          status: resultStatus('updated'),
          failedStep: attachmentErrors.length > 0 ? 'attachments' : null,
          errors: attachmentErrors,
          destination: prepared.destination,
        });
      } else {
        await this.createCanvasRecord(canvasId, title, content, input.actorUserId, creatorUserId, lastEditorUserId, prepared, input, visibilityDecision, checksum, sourceUrl);
        await this.ensureCanvasExternalMapping(input.externalSourceId, page.id, prepared.topLevelPageId, canvasId, workspaceId);
        summary.createdCanvases += 1;
        if (prepared.isContainerPage) summary.containerCanvasesCreated += 1;
        summary.pageResults.push({
          confluencePageId: page.id,
          canvasId,
          title,
          createdByUserId: creatorUserId,
          visibility: visibilityDecision.visibility,
          confluenceReadRestricted: visibilityDecision.hasReadRestriction ?? undefined,
          confluenceRestrictionStatus: visibilityDecision.status,
          isContainerPage: prepared.isContainerPage,
          containerPageHasContent: prepared.containerPageHasContent,
          status: resultStatus('created'),
          failedStep: attachmentErrors.length > 0 ? 'attachments' : null,
          errors: attachmentErrors,
          destination: prepared.destination,
        });
      }

      return { canvasId, rawMarkdown, lastEditorUserId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ConfluenceImport] Failed to import page', error, {
        confluencePageId: page.id,
        title: page.title,
        topLevelPageId: prepared.topLevelPageId,
        destination: prepared.destination,
      });
      summary.warnings.push(`Failed to import Confluence page ${page.id} (${page.title}): ${message}`);
      summary.pageResults.push({
        confluencePageId: page.id,
        title: page.title,
        status: 'failed',
        isContainerPage: prepared.isContainerPage,
        containerPageHasContent: prepared.containerPageHasContent,
        failedStep: 'canvas',
        errors: [message],
        destination: prepared.destination,
        error: message,
      });
      return null;
    }
  }

  private async findExistingCanvas(pageId: string, projectId: string, externalSourceId?: string): Promise<{ id: string; metadata: Prisma.JsonValue } | null> {
    if (externalSourceId) {
      const mapping = await db.externalMessage.findUnique({
        where: {
          externalSourceId_externalId: {
            externalSourceId,
            externalId: pageId,
          },
        },
        select: {
          entityId: true,
          messageId: true,
          entityType: true,
        },
      });

      const mappedCanvasId = mapping?.entityType === ExternalEntityType.CANVAS
        ? mapping.entityId || mapping.messageId
        : null;

      if (mappedCanvasId) {
        const mappedCanvas = await db.canvas.findFirst({
          where: { id: mappedCanvasId, projectId },
          select: { id: true, metadata: true },
        });
        if (mappedCanvas) return mappedCanvas;
      }
    }

    return db.canvas.findFirst({
      where: {
        projectId,
        metadata: {
          path: ['externalSourceType'],
          equals: 'confluence',
        },
        AND: [{
          metadata: {
            path: ['externalSourceId'],
            equals: pageId,
          },
        }],
      },
      select: { id: true, metadata: true },
    });
  }

  private async ensureCanvasExternalMapping(
    externalSourceId: string | undefined,
    confluencePageId: string,
    topLevelPageId: string,
    canvasId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!externalSourceId) return;

    await db.externalMessage.upsert({
      where: {
        externalSourceId_externalId: {
          externalSourceId,
          externalId: confluencePageId,
        },
      },
      create: {
        externalSourceId,
        externalId: confluencePageId,
        externalThreadId: topLevelPageId || confluencePageId,
        entityType: ExternalEntityType.CANVAS,
        entityId: canvasId,
        messageId: canvasId,
        direction: MessageDirection.INCOMING,
        workspaceId,
      },
      update: {
        externalThreadId: topLevelPageId || confluencePageId,
        entityType: ExternalEntityType.CANVAS,
        entityId: canvasId,
        messageId: canvasId,
        direction: MessageDirection.INCOMING,
      },
    });
  }

  private async createCanvasRecord(
    canvasId: string,
    title: string,
    content: BlockNoteBlock[],
    actorUserId: string,
    creatorUserId: string,
    lastEditorUserId: string,
    prepared: PreparedPage,
    input: ConfluenceImportConfig,
    visibilityDecision: ConfluenceRestrictionDecision,
    checksum: string,
    sourceUrl?: string,
  ): Promise<void> {
    const safeContent = sanitizeForJson(content) as Prisma.InputJsonValue;
    const workspaceId = input.workspaceId;
    if (!workspaceId) {
      throw new Error('workspaceId required: Confluence import config missing workspaceId');
    }
    const ownerUserIds = uniqueIds([creatorUserId, lastEditorUserId, actorUserId]);
    await db.$transaction([
      db.canvas.create({
        data: {
          id: canvasId,
          title,
          content: safeContent,
          createdBy: creatorUserId,
          lastEditedBy: lastEditorUserId,
          lastEditedAt: new Date(),
          visibility: visibilityDecision.visibility,
          isTemplate: false,
          isCollaborative: true,
          docType: DocType.Canvas,
          workspaceId,
          projectId: prepared.destination.projectId,
          ...(prepared.destination.type === 'channel' || prepared.destination.type === 'channelFolder'
            ? { channelId: prepared.destination.channelId }
            : {}),
          ...(prepared.destination.type === 'projectFolder' || prepared.destination.type === 'channelFolder'
            ? { folderId: prepared.destination.folderId }
            : {}),
          metadata: this.buildCanvasMetadata(prepared, input, checksum, sourceUrl, undefined, visibilityDecision) as Prisma.InputJsonValue,
        },
      }),
      db.canvasParticipant.createMany({
        data: ownerUserIds.map(userId => ({
          id: uuidv4(),
          canvasId,
          userId,
          role: CanvasRole.OWNER,
          joinedAt: new Date(),
          updatedAt: new Date(),
          workspaceId,
        })),
        skipDuplicates: true,
      }),
    ]);

    await initializeYSweetDoc(canvasId, safeContent as unknown as BlockNoteBlock[], actorUserId);
  }

  private async updateCanvasRecord(
    canvasId: string,
    title: string,
    content: BlockNoteBlock[],
    actorUserId: string,
    creatorUserId: string,
    lastEditorUserId: string,
    prepared: PreparedPage,
    input: ConfluenceImportConfig,
    visibilityDecision: ConfluenceRestrictionDecision,
    checksum: string,
    sourceUrl?: string,
    existingMetadata?: Prisma.JsonValue,
  ): Promise<void> {
    const safeContent = sanitizeForJson(content) as Prisma.InputJsonValue;
    await db.canvas.update({
      where: { id: canvasId },
      data: {
        title,
        content: safeContent,
        createdBy: creatorUserId,
        lastEditedBy: lastEditorUserId,
        lastEditedAt: new Date(),
        projectId: prepared.destination.projectId,
        channelId: prepared.destination.type === 'channel' || prepared.destination.type === 'channelFolder'
          ? prepared.destination.channelId
          : null,
        folderId: prepared.destination.type === 'projectFolder' || prepared.destination.type === 'channelFolder'
          ? prepared.destination.folderId
          : null,
        visibility: visibilityDecision.visibility,
        metadata: this.buildCanvasMetadata(prepared, input, checksum, sourceUrl, existingMetadata, visibilityDecision) as Prisma.InputJsonValue,
      },
    });

    const ownersWorkspaceId = input.workspaceId;
    if (!ownersWorkspaceId) {
      throw new Error('workspaceId required: Confluence import config missing workspaceId');
    }
    await this.ensureCanvasOwners(canvasId, [creatorUserId, lastEditorUserId, actorUserId], ownersWorkspaceId);
    await syncToYSweet(canvasId, safeContent as unknown as BlockNoteBlock[], actorUserId);
  }

  private async ensureCanvasOwners(canvasId: string, userIds: string[], workspaceId: string): Promise<void> {
    const ownerUserIds = uniqueIds(userIds);
    if (ownerUserIds.length === 0) return;

    await db.canvasParticipant.createMany({
      data: ownerUserIds.map(userId => ({
        id: uuidv4(),
        canvasId,
        userId,
        role: CanvasRole.OWNER,
        joinedAt: new Date(),
        updatedAt: new Date(),
        workspaceId,
      })),
      skipDuplicates: true,
    });

    await db.canvasParticipant.updateMany({
      where: {
        canvasId,
        userId: { in: ownerUserIds },
        role: { not: CanvasRole.OWNER },
      },
      data: { role: CanvasRole.OWNER },
    });
  }

  private async resolveCanvasVisibility(
    prepared: PreparedPage,
    warnings: string[],
  ): Promise<ConfluenceRestrictionDecision> {
    const decision = await resolveConfluenceCanvasVisibility(
      prepared.page,
      contentId => this.fetchContentRestrictionsCached(contentId),
    );

    if (decision.status === 'unknown') {
      warnings.push(
        `Could not determine Confluence read restrictions for page ${prepared.page.id} (${prepared.page.title}); migrated as PRIVATE. ${decision.error || ''}`.trim(),
      );
    }

    return decision;
  }

  private fetchContentRestrictionsCached(contentId: string): Promise<ConfluenceContentRestrictions> {
    const cached = this.contentRestrictionCache.get(contentId);
    if (cached) return cached;

    const promise = this.client.fetchContentRestrictions(contentId);
    this.contentRestrictionCache.set(contentId, promise);
    return promise;
  }

  private async updateCanvasContent(
    canvasId: string,
    markdown: string,
    lastEditorUserId: string,
    prepared: PreparedPage,
    input: ConfluenceImportConfig,
  ): Promise<void> {
    const content = await convertMarkdownToBlockNote(markdown);
    const safeContent = sanitizeForJson(content) as Prisma.InputJsonValue;
    const checksum = checksumMarkdown(markdown);
    const sourceUrl = this.client.getWebUrl(prepared.page._links?.webui);
    const existingCanvas = await db.canvas.findUnique({
      where: { id: canvasId },
      select: { metadata: true },
    });

    await db.canvas.update({
      where: { id: canvasId },
      data: {
        content: safeContent,
        lastEditedBy: lastEditorUserId,
        lastEditedAt: new Date(),
        metadata: this.buildCanvasMetadata(prepared, input, checksum, sourceUrl, existingCanvas?.metadata) as Prisma.InputJsonValue,
      },
    });

    const ownersWorkspaceId = input.workspaceId;
    if (!ownersWorkspaceId) {
      throw new Error('workspaceId required: Confluence import config missing workspaceId');
    }
    await this.ensureCanvasOwners(canvasId, [lastEditorUserId], ownersWorkspaceId);

    await syncToYSweet(canvasId, safeContent as unknown as BlockNoteBlock[], lastEditorUserId);
  }

  private markPageResultPartial(
    summary: ConfluenceImportSummary,
    confluencePageId: string,
    failedStep: NonNullable<ConfluenceImportSummary['pageResults'][number]['failedStep']>,
    errorMessage: string,
  ): ConfluenceImportSummary['pageResults'][number] | undefined {
    const pageResult = summary.pageResults.find(result => result.confluencePageId === confluencePageId);
    if (!pageResult) return undefined;

    pageResult.status = pageResult.status === 'failed' ? 'failed' : 'partial';
    pageResult.failedStep = failedStep;
    pageResult.errors = [...(pageResult.errors || []), errorMessage];
    pageResult.error = pageResult.error || errorMessage;
    return pageResult;
  }

  private async queueCanvasVespaJob(canvasId: string, userId: string): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId,
        app: SubApp.CANVAS,
      });
      logger.info('[ConfluenceImport] Queued Vespa indexing for canvas', { canvasId });
    } catch (error) {
      logger.error('[ConfluenceImport] Failed to queue Vespa job for canvas', error, { canvasId });
    }
  }

  private buildCanvasMetadata(
    prepared: PreparedPage,
    input: ConfluenceImportConfig,
    checksum: string,
    sourceUrl?: string,
    existingMetadata?: Prisma.JsonValue,
    restrictionDecision?: ConfluenceRestrictionDecision,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    const previousMetadata = asRecord(existingMetadata);
    const previousConfluenceMetadata = asRecord(previousMetadata.confluence);

    return {
      ...previousMetadata,
      externalSourceType: 'confluence',
      externalSourceId: prepared.page.id,
      externalSourceUrl: sourceUrl,
      lastImportedAt: now,
      importChecksum: checksum,
      confluence: {
        ...previousConfluenceMetadata,
        spaceKey: input.spaceKey,
        pageId: prepared.page.id,
        pageVersion: prepared.page.version?.number ?? null,
        topLevelPageId: prepared.topLevelPageId,
        topLevelSection: prepared.topLevelSectionTitle,
        breadcrumb: prepared.breadcrumb,
        isContainerPage: prepared.isContainerPage,
        containerPageHasContent: prepared.containerPageHasContent,
        destination: prepared.destination,
        ...(restrictionDecision ? {
          restriction: {
            status: restrictionDecision.status,
            hasReadRestriction: restrictionDecision.hasReadRestriction,
            visibility: restrictionDecision.visibility,
            restrictedContentIds: restrictionDecision.restrictedContentIds,
            checkedContentIds: restrictionDecision.checkedContentIds,
            ...(restrictionDecision.error ? { error: restrictionDecision.error } : {}),
          },
        } : {}),
        importedAt: now,
      },
    };
  }

  private async migrateAttachmentsForPage(
    pageId: string,
    topLevelPageId: string,
    canvasId: string,
    actorUserId: string,
    workspaceId: string,
    externalSourceId: string | undefined,
    warnings: string[],
  ): Promise<AttachmentMigrationResult> {
    const result: AttachmentMigrationResult = {
      urlByFileName: new Map<string, string>(),
      migratedCount: 0,
      reusedCount: 0,
      failedCount: 0,
      errors: [],
    };

    const attachments = await this.client.fetchAttachments(pageId);
    if (attachments.length === 0) return result;

    for (const attachment of attachments) {
      try {
        const existing = await this.findExistingAttachment(canvasId, pageId, attachment.id, externalSourceId);
        if (existing) {
          await this.ensureAttachmentExternalMapping(
            externalSourceId,
            pageId,
            topLevelPageId,
            attachment.id,
            existing.id,
            workspaceId,
          );
          result.urlByFileName.set(attachment.title, existing.id);
          result.reusedCount += 1;
          continue;
        }

        const downloaded = await this.client.downloadAttachment(pageId, attachment);
        const uploaded = await getStorageService().uploadFile(downloaded.buffer, {
          filename: downloaded.filename,
          contentType: downloaded.contentType,
          scopeType: 'CANVAS',
          scopeId: canvasId,
          metadata: {
            confluencePageId: pageId,
            confluenceAttachmentId: attachment.id,
            originalName: attachment.title,
            uploadedAt: new Date().toISOString(),
          },
        });

        const attachmentRecord = await db.messageAttachment.create({
          data: {
            entityId: canvasId,
            entityType: AttachmentEntityType.CANVAS,
            conversationId: `canvas_${canvasId}`,
            originalFilename: attachment.title,
            size: uploaded.size,
            mimetype: downloaded.contentType,
            url: uploaded.path,
            uploadedByUserId: actorUserId,
            createdBy: actorUserId,
            storageProvider: config.fileStorage.provider,
            workspaceId,
            metadata: {
              confluencePageId: pageId,
              confluenceAttachmentId: attachment.id,
              confluenceAttachmentVersion: attachment.version?.number ?? null,
              type: 'confluence_canvas_attachment',
            },
          },
          select: { id: true },
        });

        result.urlByFileName.set(attachment.title, attachmentRecord.id);
        await this.ensureAttachmentExternalMapping(
          externalSourceId,
          pageId,
          topLevelPageId,
          attachment.id,
          attachmentRecord.id,
          workspaceId,
        );
        result.migratedCount += 1;
      } catch (error) {
        result.failedCount += 1;
        const message = `Failed to migrate attachment ${attachment.title} (${attachment.id}) for Confluence page ${pageId}: ${error instanceof Error ? error.message : 'Unknown error'
        }`;
        logger.warn('[ConfluenceImport] Failed to migrate attachment', {
          confluencePageId: pageId,
          confluenceAttachmentId: attachment.id,
          title: attachment.title,
          canvasId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.errors.push(message);
        warnings.push(message);
      }
    }

    return result;
  }

  private buildAttachmentExternalId(pageId: string, attachmentId: string): string {
    return `confluence-attachment:${pageId}:${attachmentId}`;
  }

  private async ensureAttachmentExternalMapping(
    externalSourceId: string | undefined,
    confluencePageId: string,
    topLevelPageId: string,
    confluenceAttachmentId: string,
    attachmentRowId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!externalSourceId) return;

    await db.externalMessage.upsert({
      where: {
        externalSourceId_externalId: {
          externalSourceId,
          externalId: this.buildAttachmentExternalId(confluencePageId, confluenceAttachmentId),
        },
      },
      create: {
        externalSourceId,
        externalId: this.buildAttachmentExternalId(confluencePageId, confluenceAttachmentId),
        externalThreadId: topLevelPageId || confluencePageId,
        entityType: ExternalEntityType.ATTACHMENT,
        entityId: attachmentRowId,
        messageId: attachmentRowId,
        direction: MessageDirection.INCOMING,
        workspaceId,
      },
      update: {
        externalThreadId: topLevelPageId || confluencePageId,
        entityType: ExternalEntityType.ATTACHMENT,
        entityId: attachmentRowId,
        messageId: attachmentRowId,
        direction: MessageDirection.INCOMING,
      },
    });
  }

  private async findExistingAttachment(
    canvasId: string,
    confluencePageId: string,
    confluenceAttachmentId: string,
    externalSourceId?: string,
  ): Promise<{ id: string } | null> {
    if (externalSourceId) {
      const mapping = await db.externalMessage.findUnique({
        where: {
          externalSourceId_externalId: {
            externalSourceId,
            externalId: this.buildAttachmentExternalId(confluencePageId, confluenceAttachmentId),
          },
        },
        select: {
          entityId: true,
          messageId: true,
          entityType: true,
        },
      });

      const mappedAttachmentId = mapping?.entityType === ExternalEntityType.ATTACHMENT
        ? mapping.entityId || mapping.messageId
        : null;

      if (mappedAttachmentId) {
        const mappedAttachment = await db.messageAttachment.findFirst({
          where: {
            id: mappedAttachmentId,
            entityId: canvasId,
            entityType: AttachmentEntityType.CANVAS,
          },
          select: { id: true },
        });
        if (mappedAttachment) return mappedAttachment;
      }
    }

    const candidates = await db.messageAttachment.findMany({
      where: {
        entityId: canvasId,
        entityType: AttachmentEntityType.CANVAS,
      },
      select: { id: true, metadata: true },
    });

    return candidates.find(candidate =>
      asRecord(candidate.metadata).confluenceAttachmentId === confluenceAttachmentId,
    ) || null;
  }

  private async buildCanvasUrlMap(
    pageIdToCanvasId: Map<string, string>,
    workspaceId?: string,
  ): Promise<Map<string, string>> {
    const canvasIds = [...pageIdToCanvasId.values()];
    const canvases = await db.canvas.findMany({
      where: { id: { in: canvasIds } },
      select: { id: true },
    });
    const canvasById = new Map(canvases.map(canvas => [canvas.id, canvas]));
    const result = new Map<string, string>();

    for (const [pageId, canvasId] of pageIdToCanvasId.entries()) {
      const canvas = canvasById.get(canvasId);
      if (!canvas) continue;
      result.set(pageId, this.buildWorkspaceCanvasUrl(canvas.id, workspaceId));
    }

    return result;
  }

  private buildWorkspaceCanvasUrl(canvasRouteId: string, workspaceId?: string): string {
    const canvasPath = `/chat/dir/canvas/${canvasRouteId}`;

    return workspaceId ? `/${workspaceId}${canvasPath}` : canvasPath;
  }
}

function checksumMarkdown(markdown: string): string {
  return crypto.createHash('sha256').update(markdown).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizeForJson(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForJson(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeForJson(nestedValue)]),
    );
  }

  return value;
}

function uniqueIds(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
