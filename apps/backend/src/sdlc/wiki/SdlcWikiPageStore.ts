
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
import { requireSdlcLinks, sdlcLinkMarkers } from '../sdlcLinks';
import { ensureHubWikiFolder, ensureRepositoryWikiFolder } from '../hubFolders';
import { mutateMarkdownSection } from '../markdownSection';
import { isSdlcHubAdmin } from '../sdlcChannelMembership';
import { SDLC_AGENT_STEP_TYPE } from '@/workflowsV2/agents/sdlc-agent-provider';
import { sdlcActorOfExecution } from '@/workflowsV2/agents/sdlc-dispatch';
import { TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';
import { leafStepId } from '@xyne/workflow-sdk';
import { HUB_CORRECTOR_STEP_ID, HUB_GENERATOR_STEP_ID } from './wikiPlanStep';

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
  /** Absent for the Hub Wiki. */
  repoId?: string;
}

export interface WikiPageEntry {
  canvasId: string;
  title: string;
  folderPath: string;
  /** Mermaid diagrams on the page. */
  diagrams: number;
  /** Only with includeArchived. */
  archived?: boolean;
}

interface PagesFilter {
  includeArchived?: boolean | undefined;
  /** Only pages whose "Relevant source files" name one of these paths or a folder that holds one. */
  changedPaths?: string[] | undefined;
  canvasId?: string | undefined;
}

export type PageAction<T extends SdlcWikiPageAction['action']> = Extract<SdlcWikiPageAction, { action: T }>;

function splitFolderPath(folderPath: string | undefined): string[] {
  return (folderPath ?? '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

interface Block {
  type?: string;
  props?: { level?: number; language?: string };
  content?: unknown;
  children?: Block[];
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item: { text?: string; content?: unknown }) => item.text ?? textOf(item.content))
    .join('');
}

/** The paths under a page's "Relevant source files" heading and its Mermaid diagram count, read from the stored blocks. */
export function pageFacts(content: unknown): { sourcePaths: string[]; diagrams: number } {
  const blocks: Block[] = [];
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const block of list as Block[]) {
      blocks.push(block);
      walk(block.children);
    }
  };
  walk(content);
  const sourcePaths: string[] = [];
  let inSources = false;
  for (const block of blocks) {
    if (block.type === 'heading') {
      inSources = /^relevant source files$/i.test(textOf(block.content).trim());
    } else if (inSources && block.type === 'bulletListItem') {
      const path = textOf(block.content).trim().replace(/^`|`$/g, '');
      if (/^\S+$/.test(path)) sourcePaths.push(path);
    }
  }
  const diagrams = blocks.filter((block) => block.type === 'codeBlock' && block.props?.language === 'mermaid').length;
  return { sourcePaths: [...new Set(sourcePaths)], diagrams };
}

/** A page path names a changed file itself, or a folder that holds it. */
function touches(sourcePaths: string[], changedPaths: string[]): boolean {
  return sourcePaths.some((source) => {
    const folder = source.replace(/\/+$/, '');
    return changedPaths.some((changed) => changed === folder || changed.startsWith(`${folder}/`));
  });
}

const HUB_STEP_IDS: ReadonlySet<string> = new Set([HUB_GENERATOR_STEP_ID, HUB_CORRECTOR_STEP_ID]);

const NUMBERED_TITLE = /^\d+(\.\d+)+ \S/;
const NUMBERED_FOLDER = /^\d+(\.\d+)* \S/;
const OVERVIEW_TITLE = '1 Overview';

/** The Wiki's numbered outline, checked on every write. Each problem names exactly what to send instead. */
export function outlineProblems(page: { title?: string | undefined; folderPath?: string | undefined; markdown?: string | undefined }): string[] {
  const problems: string[] = [];
  const folders = splitFolderPath(page.folderPath);
  for (const folder of folders) {
    if (!NUMBERED_FOLDER.test(folder)) {
      problems.push(`Folder "${folder}" needs its number: name it "<next free section number> ${folder}", such as "2 ${folder}".`);
    }
  }
  if (page.title !== undefined) {
    const section = /^(\d+(?:\.\d+)*) /.exec(folders.at(-1) ?? '')?.[1];
    if (page.title === OVERVIEW_TITLE) {
      if (folders.length) problems.push(`"${OVERVIEW_TITLE}" belongs at the root: move it with folderPath "".`);
    } else if (folders.length && page.title === folders.at(-1)) {
      // A folder's own page, which the sidebar opens from the folder name.
    } else if (!folders.length) {
      problems.push(`Only "${OVERVIEW_TITLE}" sits at the root: put "${page.title}" in a numbered section folder such as "2 Architecture".`);
    } else if (!NUMBERED_TITLE.test(page.title)) {
      problems.push(`Title "${page.title}" needs its number: use "${section ?? '<section>'}.<next free number> ${page.title}".`);
    } else if (section && !page.title.startsWith(`${section}.`)) {
      problems.push(`Title "${page.title}" is in folder "${folders.at(-1)}": number it "${section}.<next free number> ...", or move it to the folder its number names.`);
    }
  }
  if (page.markdown !== undefined && /^\s*# /.test(page.markdown)) {
    problems.push('Remove the "# " heading: the Wiki shows the title above the page.');
  }
  if (page.markdown !== undefined && !page.markdown.split('\n').some((line) => /^##\s+relevant source files\s*$/i.test(line.trim()))) {
    problems.push('Add "## Relevant source files" just before "## See also": a bullet list of the paths the page documents.');
  }
  return problems;
}

function requireOutline(page: Parameters<typeof outlineProblems>[0]): void {
  const problems = outlineProblems(page);
  if (problems.length) throw new AppError(problems.join(' '), 400);
}

export function versionName(action: string, commitSha: string | undefined): string {
  return commitSha ? `Wiki ${commitSha.slice(0, 12)}: ${action}` : `Wiki: ${action}`;
}

export class SdlcWikiPageStore {
  constructor(readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async listPages(input: WikiScopeInput & PagesFilter): Promise<WikiPageEntry[]> {
    return this.pagesIn(await this.scope(input, true), input);
  }

  // Reads every page's content: the stored blocks are the truth after a person edits a page.
  private async pagesIn(scope: WikiScope, filter: PagesFilter): Promise<WikiPageEntry[]> {
    const tree = await this.tree(scope);
    const ids = [...tree.canvasParents.keys()];
    const canvases = await this.prisma.canvas.findMany({
      where: { id: filter.canvasId ? filter.canvasId : { in: ids }, channelId: scope.channelId },
      select: { id: true, title: true, content: true, sdlcArtifact: { select: { artifactStatus: true } } },
    });
    const changedPaths = filter.changedPaths;
    return canvases
      .filter((canvas) => tree.canvasParents.has(canvas.id))
      .filter((canvas) => filter.includeArchived || canvas.sdlcArtifact?.artifactStatus !== 'ARCHIVED')
      .flatMap((canvas) => {
        const facts = pageFacts(canvas.content);
        if (changedPaths && !touches(facts.sourcePaths, changedPaths)) return [];
        return [{
          canvasId: canvas.id,
          title: canvas.title,
          folderPath: tree.folderPath(tree.canvasParents.get(canvas.id)!),
          diagrams: facts.diagrams,
          ...(filter.includeArchived ? { archived: canvas.sdlcArtifact?.artifactStatus === 'ARCHIVED' } : {}),
        }];
      })
      .sort((left, right) =>
        // Numeric: "10 Operations" comes after "2 Architecture".
        `${left.folderPath}/${left.title}`.localeCompare(`${right.folderPath}/${right.title}`, undefined, { numeric: true })
      );
  }

  /** `agent`: an agent's write, held to the numbered outline. People editing in the dashboard are not. */
  async write(input: WriteSdlcWikiPageInput, { agent = false } = {}): Promise<WikiPageEntry> {
    if (
      !(await this.isGenerationRun(input))
      && !(await isSdlcHubAdmin(this.prisma, { userId: input.actorUserId }, input.channelId))
    ) {
      throw new AppError('Only hub admins can edit the Wiki', 403);
    }
    const scope = await this.scope(input);
    const { page } = input;
    if (agent && (page.action === 'create' || page.action === 'move')) requireOutline({ title: page.title, folderPath: page.folderPath });
    switch (page.action) {
      case 'create':
        return this.create(scope, page, input.generationCommit, agent);
      case 'update':
      case 'replace_section':
      case 'insert_section':
      case 'remove_section':
        return this.edit(scope, page, input.generationCommit, agent);
      case 'move':
        return this.move(scope, page, agent);
    }
  }

  /** Wiki generation runs as the workflow author, who may not be an admin: trust the commit only if that run is live. */
  async isGenerationRun(input: Pick<WriteSdlcWikiPageInput, 'channelId' | 'actorUserId' | 'repoId' | 'generationCommit'>): Promise<boolean> {
    const commit = input.generationCommit;
    // Hub Wiki steps describe no single commit: a Hub Wiki write is theirs while one waits on its agent.
    const hubWrite = !commit && !input.repoId;
    if (!commit && !hubWrite) return false;
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
    const live = await this.prisma.workflowExecution.findMany({
      where: { workflowId: link.targetId, status: { notIn: [...TERMINAL_EXECUTION_STATUSES] } },
      select: { id: true },
    });
    // Only runs acting as this user: whoever started it, else the workflow author.
    const executions = [];
    for (const execution of live) {
      if ((await sdlcActorOfExecution(execution.id, workflow?.metadata ?? null, this.prisma)) === input.actorUserId) executions.push(execution);
    }
    if (!executions.length) return false;
    // A dispatched SDLC agent step waits in EXTERNAL_WAIT with its resolved config as `input`.
    const steps = await this.prisma.workflowStep.findMany({
      where: {
        workflowExecutionId: { in: executions.map((execution) => execution.id) },
        status: 'EXTERNAL_WAIT',
        data: { contains: commit ?? SDLC_AGENT_STEP_TYPE },
      },
      select: { data: true, stepName: true },
    });
    return steps.some((step) => {
      try {
        const data = JSON.parse(step.data ?? '{}') as { type?: unknown; input?: { generationCommit?: unknown } };
        if (data.type !== SDLC_AGENT_STEP_TYPE) return false;
        if (hubWrite) return HUB_STEP_IDS.has(leafStepId(step.stepName ?? ''));
        // No repoId: window steps carry none, and a sha only names a commit of its own repository.
        return data.input?.generationCommit === commit;
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
      folderId = await ensureRepositoryWikiFolder(this.prisma, actor, input.channelId, repo);
    } else {
      folderId = await ensureHubWikiFolder(this.prisma, actor, input.channelId);
    }
    return {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      channelId: input.channelId,
      projectId: channel.projectId,
      folderId,
      ...(input.repoId ? { repoId: input.repoId } : {}),
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
    commitSha: string | undefined,
    agent: boolean
  ): Promise<WikiPageEntry> {
    const markdown = await this.prepareMarkdown(scope, page.markdown, commitSha, agent, true, `${scope.folderId}/${page.title}`);
    const [parentId, typeFolderId] = await Promise.all([
      this.ensureFolderPath(scope, page.folderPath),
      this.wikiTypeFolderId(scope),
    ]);
    const content = await convertMarkdownToBlockNote(markdown);
    const actor = { workspaceId: scope.workspaceId, userId: scope.actorUserId };
    const canvasId = await commitAndSyncCanvasArtifact(
      () => createTx(this, scope, { ...page, markdown }, content, typeFolderId, commitSha, actor, parentId),
      syncToYSweet,
      scope.actorUserId
    );
    this.index(scope, canvasId);
    return this.entry(scope, canvasId);
  }

  private async edit(
    scope: WikiScope,
    page: PageAction<'update' | 'replace_section' | 'insert_section' | 'remove_section'>,
    commitSha: string | undefined,
    agent: boolean
  ): Promise<WikiPageEntry> {
    const existing = await this.requirePage(scope, page.canvasId);
    let markdown: string;
    if (page.action === 'update') {
      markdown = page.markdown;
    } else {
      markdown = mutateMarkdownSection({
        markdown: sdlcLinkMarkers(await readCanvasMarkdown(existing)),
        action: page.action,
        heading: page.heading,
        ...(page.action === 'remove_section' ? {} : { sectionMarkdown: page.markdown }),
      });
    }
    // Section edits leave the rest of a page alone, including pages written before the outline rules.
    markdown = await this.prepareMarkdown(scope, markdown, commitSha, agent, page.action === 'update', existing.id);
    if (agent && page.action === 'update' && page.title) {
      requireOutline({ title: page.title, folderPath: (await this.entry(scope, existing.id)).folderPath });
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

  private async move(scope: WikiScope, page: PageAction<'move'>, agent: boolean): Promise<WikiPageEntry> {
    const existing = await this.requirePage(scope, page.canvasId);
    if (agent && !page.title) requireOutline({ title: existing.title, folderPath: page.folderPath });
    const parentId = await this.ensureFolderPath(scope, page.folderPath);
    await moveTx(this, scope, existing, parentId, page);
    return this.entry(scope, existing.id);
  }

  /** For agents: checks the outline and builds the marked links, code ones pinned to the commit the page describes. */
  private async prepareMarkdown(
    scope: WikiScope,
    markdown: string,
    commitSha: string | undefined,
    agent: boolean,
    wholePage: boolean,
    /** The page, for the rejected-write count: a new page's folder and title, else its canvas id. */
    key: string
  ): Promise<string> {
    if (!agent) return markdown;
    if (wholePage) requireOutline({ markdown });
    const repo = scope.repoId && commitSha
      ? await this.prisma.repo.findFirst({ where: { id: scope.repoId }, select: { canonicalUrl: true, url: true } })
      : null;
    return requireSdlcLinks({
      markdown,
      workspaceId: scope.workspaceId,
      channelId: scope.channelId,
      code: repo && commitSha ? { url: repo.canonicalUrl ?? repo.url, ref: commitSha } : null,
      key: `wiki:${key}`,
    });
  }

  private async entry(scope: WikiScope, canvasId: string): Promise<WikiPageEntry> {
    const [page] = await this.pagesIn(scope, { includeArchived: true, canvasId });
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
