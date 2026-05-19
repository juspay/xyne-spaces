import type { ConfluenceSectionMapping } from '@/services/confluence/confluenceImportService';
import { CanvasVisibility } from '@prisma/client';
import { ConfluenceClient, type ConfluenceContentRestrictions, type ConfluenceUser } from '@/services/confluence/confluenceClient';
import { resolveConfluenceCanvasVisibility, type ConfluenceRestrictionDecision } from '@/services/confluence/contentRestrictions';
import {
  hasMeaningfulConfluenceContent,
  shouldPreferRenderedConfluenceView,
} from '@/services/confluence/contentTransformer';
import {
  buildConfluencePageTree,
  countChildrenByParentId,
  getConfluenceTopLevelSections,
} from '@/services/confluence/pageTree';
import { DatabaseClient } from '@/database/client';

export interface ConfluenceMigrationPreviewInput {
  spaceKey: string;
  targetProjectId?: string;
  targetChannelId?: string;
  targetChannelName?: string;
  workspaceId?: string;
  sectionMappings?: Record<string, ConfluenceSectionMapping>;
}

export interface ConfluenceMigrationPreviewResult {
  spaceKey: string;
  spaceName: string;
  totalPages: number;
  leafPages: number;
  containerPages: number;
  containerPagesWithContent: number;
  expectedCanvasPages: number;
  rootPages: Array<{ id: string; title: string; childPages: number }>;
  sections: Array<{
    id: string;
    title: string;
    childPages: number;
    destination: ConfluenceSectionMapping;
  }>;
  targetProject: { id: string; name: string; code: string | null } | null;
  targetChannel: { id: string; name: string; projectId: string } | null;
  projectChannels: Array<{ id: string; name: string }>;
  visibilitySummary: {
    publicCanvases: number;
    privateCanvases: number;
    readRestrictedPages: number;
    unknownRestrictionPages: number;
  };
  pageAuthorSamples: Array<{
    id: string;
    title: string;
    isLeafPage: boolean;
    xyneVisibility: CanvasVisibility | null;
    hasReadRestriction: boolean | null;
    restrictionStatus: 'checked' | 'unknown' | null;
    createdDate: string | null;
    createdBy: ConfluencePreviewUser | null;
    lastUpdatedAt: string | null;
    lastUpdatedBy: ConfluencePreviewUser | null;
  }>;
  suggestedConfig: {
    spaceKey: string;
    projectId?: string;
    projectName: string;
    defaultDestination: 'channelFolder';
    sectionMappings?: Record<string, ConfluenceSectionMapping>;
  };
  warnings: string[];
}

interface ConfluencePreviewUser {
  accountId: string | null;
  email: string | null;
  displayName: string | null;
  publicName: string | null;
  username: string | null;
  userKey: string | null;
}

const db = DatabaseClient.getInstance();

class ConfluenceMigrationPreviewService {
  private client?: ConfluenceClient;

  constructor(client?: ConfluenceClient) {
    this.client = client;
  }

  private getClient(): ConfluenceClient {
    if (!this.client) {
      this.client = ConfluenceClient.fromEnv();
    }
    return this.client;
  }

  async preview(input: ConfluenceMigrationPreviewInput): Promise<ConfluenceMigrationPreviewResult> {
    const spaceKey = input.spaceKey.trim();
    const warnings: string[] = [];
    const client = this.getClient();
    const contentRestrictionCache = new Map<string, Promise<ConfluenceContentRestrictions>>();

    const [space, pages] = await Promise.all([
      client.getSpace(spaceKey),
      client.fetchAllPages(spaceKey),
    ]);

    const tree = buildConfluencePageTree(pages);
    const nodeById = tree.nodeById;
    const childCountByParentId = countChildrenByParentId(nodeById);
    const leafPages = [...nodeById.values()].filter(node => !node.isVirtual && node.children.length === 0).length;
    const containerPages = pages.length - leafPages;
    const roots = tree.roots;
    const realImportNodes = [...nodeById.values()].filter(node => {
      if (node.isVirtual) return false;
      if (node.children.length === 0) return true;
      return this.pageHasMeaningfulContent(node.page);
    });
    const containerPagesWithContent = realImportNodes.filter(node => node.children.length > 0).length;
    const expectedCanvasPages = realImportNodes.length;
    const restrictionDecisionByPageId = new Map<string, ConfluenceRestrictionDecision>();

    if (roots.length === 0 && pages.length > 0) {
      warnings.push('No root page could be detected from Confluence ancestors; using all pages as top-level sections.');
    }
    if (roots.length > 1) {
      warnings.push(`Space has ${roots.length} root pages. Preview treats each root as a top-level section.`);
    }

    const sections = getConfluenceTopLevelSections(roots, childCountByParentId);
    await this.mapWithConcurrency(realImportNodes, 8, async (node) => {
      const decision = await resolveConfluenceCanvasVisibility(
        node.page,
        contentId => this.fetchContentRestrictionsCached(contentId, contentRestrictionCache),
      );
      restrictionDecisionByPageId.set(node.page.id, decision);
      if (decision.status === 'unknown') {
        warnings.push(
          `Could not determine Confluence read restrictions for page ${node.page.id} (${node.page.title}); execute will migrate it as PRIVATE. ${decision.error || ''}`.trim(),
        );
      }
    });

    const visibilitySummary = [...restrictionDecisionByPageId.values()].reduce(
      (acc, decision) => {
        if (decision.visibility === CanvasVisibility.PUBLIC) acc.publicCanvases += 1;
        if (decision.visibility === CanvasVisibility.PRIVATE) acc.privateCanvases += 1;
        if (decision.hasReadRestriction === true) acc.readRestrictedPages += 1;
        if (decision.status === 'unknown') acc.unknownRestrictionPages += 1;
        return acc;
      },
      { publicCanvases: 0, privateCanvases: 0, readRestrictedPages: 0, unknownRestrictionPages: 0 },
    );
    let targetProject: ConfluenceMigrationPreviewResult['targetProject'] = null;
    let targetChannel: ConfluenceMigrationPreviewResult['targetChannel'] = null;
    let projectChannels: ConfluenceMigrationPreviewResult['projectChannels'] = [];
    let targetProjectId = input.targetProjectId;

    if (input.targetChannelId || input.targetChannelName) {
      if (!input.workspaceId) {
        throw new Error('workspaceId is required when resolving a target channel');
      }

      targetChannel = await this.resolveTargetChannel({
        channelId: input.targetChannelId,
        channelName: input.targetChannelName,
        workspaceId: input.workspaceId,
      });
      targetProjectId = targetChannel.projectId;
    }

    if (targetProjectId) {
      const project = await db.project.findUnique({
        where: { id: targetProjectId },
        select: { id: true, name: true, code: true },
      });
      if (!project) {
        throw new Error(`Target project ${targetProjectId} not found`);
      }
      targetProject = project;

      projectChannels = await db.channel.findMany({
        where: { projectId: targetProjectId, isArchived: false },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }

    const channelIds = new Set(projectChannels.map(channel => channel.id));
    const sectionMappings = input.sectionMappings || {};
    for (const [sectionTitle, mapping] of Object.entries(sectionMappings)) {
      if (!sections.some(section => section.title === sectionTitle)) {
        warnings.push(`Section mapping "${sectionTitle}" does not match a detected top-level section.`);
      }
      if (mapping.type === 'channel' && mapping.channelId && targetProjectId && !channelIds.has(mapping.channelId)) {
        warnings.push(`Mapped channel ${mapping.channelId} for "${sectionTitle}" was not found in target project.`);
      }
    }

    const suggestedMappings = sections.reduce<Record<string, ConfluenceSectionMapping>>((acc, section) => {
      if (sectionMappings[section.title]) {
        acc[section.title] = sectionMappings[section.title];
      }
      return acc;
    }, {});

    return {
      spaceKey: space.key,
      spaceName: space.name,
      totalPages: pages.length,
      leafPages,
      containerPages,
      containerPagesWithContent,
      expectedCanvasPages,
      rootPages: roots.map(root => ({
        id: root.page.id,
        title: root.page.title,
        childPages: childCountByParentId.get(root.page.id) || 0,
      })),
      sections: sections.map(section => ({
        ...section,
        destination: suggestedMappings[section.title] || { type: section.childPages > 0 ? 'channelFolder' : 'channel' },
      })),
      targetProject,
      targetChannel,
      projectChannels,
      visibilitySummary,
      pageAuthorSamples: pages.slice(0, 25).map(page => ({
        id: page.id,
        title: page.title,
        isLeafPage: nodeById.get(page.id)?.children.length === 0,
        xyneVisibility: restrictionDecisionByPageId.get(page.id)?.visibility || null,
        hasReadRestriction: restrictionDecisionByPageId.get(page.id)?.hasReadRestriction ?? null,
        restrictionStatus: restrictionDecisionByPageId.get(page.id)?.status || null,
        createdDate: page.history?.createdDate || null,
        createdBy: this.toPreviewUser(page.history?.createdBy),
        lastUpdatedAt: page.history?.lastUpdated?.when || page.version?.when || null,
        lastUpdatedBy: this.toPreviewUser(page.history?.lastUpdated?.by),
      })),
      suggestedConfig: {
        spaceKey: space.key,
        ...(targetProjectId ? { projectId: targetProjectId } : {}),
        projectName: space.name,
        defaultDestination: 'channelFolder',
        ...(Object.keys(suggestedMappings).length > 0 ? { sectionMappings: suggestedMappings } : {}),
      },
      warnings,
    };
  }

  private pageHasMeaningfulContent(page: { body?: { storage?: { value?: string }, view?: { value?: string } } }): boolean {
    return hasMeaningfulConfluenceContent(this.getPageBodyForTransform(page));
  }

  private getPageBodyForTransform(page: { body?: { storage?: { value?: string }, view?: { value?: string } } }): string {
    const storage = page.body?.storage?.value || '';
    const view = page.body?.view?.value || '';
    const shouldPreferRenderedView = shouldPreferRenderedConfluenceView(storage);

    return shouldPreferRenderedView && view ? view : storage || view;
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

  private fetchContentRestrictionsCached(
    contentId: string,
    contentRestrictionCache: Map<string, Promise<ConfluenceContentRestrictions>>,
  ): Promise<ConfluenceContentRestrictions> {
    const cached = contentRestrictionCache.get(contentId);
    if (cached) return cached;

    const promise = this.getClient().fetchContentRestrictions(contentId);
    contentRestrictionCache.set(contentId, promise);
    return promise;
  }

  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (!item) return;
        await mapper(item);
      }
    });
    await Promise.all(workers);
  }

  private toPreviewUser(user?: ConfluenceUser): ConfluencePreviewUser | null {
    if (!user) return null;

    return {
      accountId: user.accountId || null,
      email: user.email || user.emailAddress || null,
      displayName: user.displayName || null,
      publicName: user.publicName || null,
      username: user.username || null,
      userKey: user.userKey || null,
    };
  }
}

export const confluenceMigrationPreviewService = new ConfluenceMigrationPreviewService();
