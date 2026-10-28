
import { ensureFolderPathTx, createTx, editTx, moveTx } from '@/bypassAcl/transactions/SdlcWikiPageStore';
import {  type PrismaClient } from '@prisma/client';
import {
  
  SDLC_HUB_ITEM_FLAT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_MEMBERSHIP_RELATION,
  SDLC_WIKI_FOLDER,
  SDLC_WIKI_WORKFLOW_RELATION,
  type SdlcWikiPageAction,
  type WriteSdlcWikiPageInput,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { vespaQueue } from '@/queues/vespaQueue';
import { convertMarkdownToBlockNote } from '@/services/canvasService';
import { logger } from '@/utils/logger';
import { syncToYSweet } from '@/utils/ysweetUtils';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { commitAndSyncCanvasArtifact, readCanvasMarkdown } from '../sdlcCanvasSync';
import { withSdlcSearchSync } from '@/zero/vespa-injection/core/sdlc-sync';
import { ensureHubWikiFolder, ensureRepositoryWikiFolder } from '../hubFolders';
import { mutateMarkdownSection } from '../markdownSection';
import { isSdlcHubAdmin } from '../sdlcChannelMembership';
import { SDLC_AGENT_STEP_TYPE } from '@/workflowsV2/agents/sdlc-agent-provider';
import { sdlcAuthorOf } from '@/workflowsV2/agents/sdlc-dispatch';
import { TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';

export interface WikiScopeInput {
  workspaceId: string;
  actorUserId: string;
  channelId: string;
  repoId?: string;
}

export interface WikiScope {
  workspaceId: string;
  actorUserId: string;
  channelId: string;
  projectId: string;
  folderId: string;
}

export interface WikiPageEntry {
  canvasId: string;
  title: string;
  folderPath: string;
  archived: boolean;
  lastCommitSha: string | null;
  updatedAt: string;
}

export type PageAction<T extends SdlcWikiPageAction['action']> = Extract<SdlcWikiPageAction, { action: T }>;

function splitFolderPath(folderPath: string | undefined): string[] {
  return (folderPath ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function versionName(action: string, commitSha: string | undefined): string {
  return commitSha ? `Wiki ${commitSha.slice(0, 12)}: ${action}` : `Wiki: ${action}`;
}

export class SdlcWikiPageStore {
  constructor(readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async listPages(input: WikiScopeInput & { includeArchived?: boolean }): Promise<WikiPageEntry[]> {
    return this.pagesIn(await this.scope(input, true), input.includeArchived ?? false);
  }

  private async pagesIn(scope: WikiScope, includeArchived: boolean): Promise<WikiPageEntry[]> {
    const tree = await this.tree(scope);
    const canvases = await this.prisma.canvas.findMany({
      where: { id: { in: [...tree.canvasParents.keys()] }, channelId: scope.channelId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        sdlcArtifact: { select: { artifactStatus: true, generationCommit: true } },
      },
    });
    return canvases
      .map((canvas) => ({
        canvasId: canvas.id,
        title: canvas.title,
        folderPath: tree.folderPath(tree.canvasParents.get(canvas.id)!),
        archived: canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED',
        lastCommitSha: canvas.sdlcArtifact?.generationCommit ?? null,
        updatedAt: canvas.updatedAt.toISOString(),
      }))
      .filter((page) => includeArchived || !page.archived)
      .sort((left, right) =>
        `${left.folderPath}/${left.title}`.localeCompare(`${right.folderPath}/${right.title}`)
      );
  }

  async write(input: WriteSdlcWikiPageInput): Promise<WikiPageEntry> {
    if (
      !(await this.isGenerationRun(input))
      && !(await isSdlcHubAdmin(this.prisma, { userId: input.actorUserId }, input.channelId))
    ) {
      throw new AppError('Only hub admins can edit the Wiki', 403);
    }
    const scope = await this.scope(input);
    const { page } = input;
    switch (page.action) {
      case 'create':
        return this.create(scope, page, input.generationCommit);
      case 'update':
      case 'replace_section':
      case 'insert_section':
      case 'remove_section':
        return this.edit(scope, page, input.generationCommit);
      case 'move':
        return this.move(scope, page);
    }
  }

  /** Wiki generation runs as the workflow author, who may not be an admin: trust the commit only if that run is live. */
  async isGenerationRun(input: Pick<WriteSdlcWikiPageInput, 'channelId' | 'actorUserId' | 'repoId' | 'generationCommit'>): Promise<boolean> {
    const commit = input.generationCommit;
    if (!commit) return false;
    const link = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        channelId: input.channelId,
        sourceType: 'CHANNEL',
        targetType: 'WORKFLOW',
        relationType: SDLC_WIKI_WORKFLOW_RELATION,
      },
      select: { targetId: true },
    });
    if (!link) return false;
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: link.targetId },
      select: { metadata: true },
    });
    if (sdlcAuthorOf(workflow?.metadata) !== input.actorUserId) return false;
    const executions = await this.prisma.workflowExecution.findMany({
      where: { workflowId: link.targetId, status: { notIn: [...TERMINAL_EXECUTION_STATUSES] } },
      select: { id: true },
    });
    if (!executions.length) return false;
    // A dispatched SDLC agent step waits in EXTERNAL_WAIT with its resolved config as `input`.
    const steps = await this.prisma.workflowStep.findMany({
      where: {
        workflowExecutionId: { in: executions.map((execution) => execution.id) },
        status: 'EXTERNAL_WAIT',
        data: { contains: commit },
      },
      select: { data: true },
    });
    return steps.some((step) => {
      try {
        const data = JSON.parse(step.data ?? '{}') as { type?: unknown; input?: { repoId?: unknown; generationCommit?: unknown } };
        return data.type === SDLC_AGENT_STEP_TYPE
          && data.input?.generationCommit === commit
          && (data.input.repoId ?? null) === (input.repoId ?? null);
      } catch {
        return false;
      }
    });
  }

  /** A public hub's Wiki is readable by the workspace; writing still needs membership. */
  private async scope(input: WikiScopeInput, read = false): Promise<WikiScope> {
    const member = { participants: { some: { userId: input.actorUserId } } };
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: input.channelId,
        workspaceId: input.workspaceId,
        type: 'SDLC',
        ...(read ? { OR: [{ visibility: 'PUBLIC' }, member] } : member),
      },
      select: { projectId: true },
    });
    if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
    const actor = { workspaceId: input.workspaceId, userId: input.actorUserId };
    let folderId: string;
    if (input.repoId) {
      const [membership, repo] = await Promise.all([
        this.prisma.sdlcEntityLink.findFirst({
          where: {
            channelId: input.channelId,
            sourceType: 'CHANNEL',
            targetType: 'REPOSITORY',
            targetId: input.repoId,
            relationType: SDLC_MEMBERSHIP_RELATION,
          },
          select: { id: true },
        }),
        this.prisma.repo.findFirst({
          where: { id: input.repoId, workspaceId: input.workspaceId },
          select: { id: true, name: true },
        }),
      ]);
      if (!membership || !repo) {
        throw new AppError('This repository is not part of that SDLC hub', 404);
      }
      folderId = await withSdlcSearchSync(changes => ensureRepositoryWikiFolder(this.prisma, actor, input.channelId, repo, changes));
    } else {
      folderId = await withSdlcSearchSync(changes => ensureHubWikiFolder(this.prisma, actor, input.channelId, changes));
    }
    return {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      channelId: input.channelId,
      projectId: channel.projectId,
      folderId,
    };
  }

  private async tree(scope: WikiScope) {
    const descendants = await this.prisma.sdlcEntityLink.findMany({
      where: {
        channelId: scope.channelId,
        sourceType: 'FOLDER',
        sourceId: scope.folderId,
        relationType: SDLC_HUB_ITEM_FLAT_RELATION,
      },
      select: { targetId: true },
    });
    const placements = descendants.length
      ? await this.prisma.sdlcEntityLink.findMany({
          where: {
            channelId: scope.channelId,
            relationType: SDLC_HUB_ITEM_RELATION,
            targetId: { in: descendants.map((edge) => edge.targetId) },
          },
          select: { sourceId: true, targetType: true, targetId: true },
        })
      : [];
    const folderParents = new Map<string, string>();
    const canvasParents = new Map<string, string>();
    for (const edge of placements) {
      (edge.targetType === 'FOLDER' ? folderParents : canvasParents).set(edge.targetId, edge.sourceId);
    }
    const folders = folderParents.size
      ? await this.prisma.sdlcFolder.findMany({
          where: { id: { in: [...folderParents.keys()] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(folders.map((folder) => [folder.id, folder.name]));
    const folderPath = (folderId: string): string => {
      const segments: string[] = [];
      for (let id = folderId; id !== scope.folderId && segments.length < 64; ) {
        const name = names.get(id);
        const parent = folderParents.get(id);
        if (!name || !parent) break;
        segments.unshift(name);
        id = parent;
      }
      return segments.join('/');
    };
    return { folderParents, canvasParents, names, folderPath };
  }

  private async ensureFolderPath(scope: WikiScope, folderPath: string | undefined): Promise<string> {
    const actor = { workspaceId: scope.workspaceId, userId: scope.actorUserId };
    let parentId = scope.folderId;
    for (const name of splitFolderPath(folderPath)) {
      const parent = parentId;
      parentId = await ensureFolderPathTx(this, parent, name, scope, actor);
    }
    return parentId;
  }

  private async wikiTypeFolderId(scope: WikiScope): Promise<string> {
    const folder = await this.prisma.canvasFolder.upsert({
      where: {
        projectId_channelId_name: {
          projectId: scope.projectId,
          channelId: scope.channelId,
          name: SDLC_WIKI_FOLDER,
        },
      },
      create: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        channelId: scope.channelId,
        name: SDLC_WIKI_FOLDER,
        createdBy: scope.actorUserId,
      },
      update: {},
      select: { id: true },
    });
    return folder.id;
  }

  private async requirePage(scope: WikiScope, canvasId: string) {
    const placement = await this.prisma.sdlcEntityLink.findFirst({
      where: {
        channelId: scope.channelId,
        sourceType: 'FOLDER',
        sourceId: scope.folderId,
        targetType: 'CANVAS',
        targetId: canvasId,
        relationType: SDLC_HUB_ITEM_FLAT_RELATION,
      },
      select: { id: true },
    });
    const canvas = placement
      ? await this.prisma.canvas.findFirst({
          where: { id: canvasId, channelId: scope.channelId },
          select: { id: true, title: true, content: true, createdBy: true },
        })
      : null;
    if (!canvas) throw new AppError('Wiki page not found in this scope', 404);
    return canvas;
  }

  private async create(
    scope: WikiScope,
    page: PageAction<'create'>,
    commitSha: string | undefined
  ): Promise<WikiPageEntry> {
    const [parentId, typeFolderId] = await Promise.all([
      this.ensureFolderPath(scope, page.folderPath),
      this.wikiTypeFolderId(scope),
    ]);
    const content = await convertMarkdownToBlockNote(page.markdown);
    const actor = { workspaceId: scope.workspaceId, userId: scope.actorUserId };
    const canvasId = await commitAndSyncCanvasArtifact(
      changes => createTx(this, scope, page, content, typeFolderId, commitSha, actor, parentId, changes),
      syncToYSweet,
      scope.actorUserId
    );
    this.index(scope, canvasId);
    return this.entry(scope, canvasId);
  }

  private async edit(
    scope: WikiScope,
    page: PageAction<'update' | 'replace_section' | 'insert_section' | 'remove_section'>,
    commitSha: string | undefined
  ): Promise<WikiPageEntry> {
    const existing = await this.requirePage(scope, page.canvasId);
    let markdown: string;
    if (page.action === 'update') {
      markdown = page.markdown;
    } else {
      markdown = mutateMarkdownSection({
        markdown: await readCanvasMarkdown(existing),
        action: page.action,
        heading: page.heading,
        ...(page.action === 'remove_section' ? {} : { sectionMarkdown: page.markdown }),
      });
    }
    const content = await convertMarkdownToBlockNote(markdown);
    // Wiki canvases give the hub read-only access, so sync as the creator, who can edit.
    await commitAndSyncCanvasArtifact(
      () => editTx(this, existing, page, content, scope, markdown, commitSha),
      (canvasId, blocks) => syncToYSweet(canvasId, blocks, existing.createdBy),
      existing.createdBy
    );
    this.index(scope, existing.id);
    return this.entry(scope, existing.id);
  }

  private async move(scope: WikiScope, page: PageAction<'move'>): Promise<WikiPageEntry> {
    const existing = await this.requirePage(scope, page.canvasId);
    const parentId = await this.ensureFolderPath(scope, page.folderPath);
    await moveTx(this, scope, existing, parentId, page);
    return this.entry(scope, existing.id);
  }

  private async entry(scope: WikiScope, canvasId: string): Promise<WikiPageEntry> {
    const page = (await this.pagesIn(scope, true)).find((candidate) => candidate.canvasId === canvasId);
    if (!page) throw new AppError('Wiki page not found in this scope', 404);
    return page;
  }

  private index(scope: WikiScope, canvasId: string): void {
    void vespaQueue
      .addJob({
        schema: fileSchema,
        jobType: 'feed',
        docId: canvasId,
        userId: scope.actorUserId,
        workspaceId: scope.workspaceId,
        app: SubApp.CANVAS,
      })
      .catch((error) => {
        logger.warn('[SDLC] failed to enqueue wiki page indexing', {
          canvasId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

export const sdlcWikiPageStore = new SdlcWikiPageStore();
