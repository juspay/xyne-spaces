import { DatabaseClient } from "@/database/client";
import { BlockNoteBlock, BlockNoteInlineContent } from "@/types/blockNoteTypes";
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { CommitAnalysisResult } from "@/services/commitAnalysisService";
import { AffectedApplicationInfo } from "@/services/release/core";
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { config } from '@/config/env';
import { UserRepository } from "@/database/repositories/users";
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { readFromYSweetStrict, syncToYSweet } from '@/utils/ysweetUtils';

const prisma = DatabaseClient.getInstance();

// Distinct H2 heading that marks the hotfix block range inside the canvas. The
// upsert logic slices the content on this exact text, so keep it stable —
// changing it would orphan hotfix sections written by older builds.
const HOTFIX_HEADING_TEXT = '🔥 Hotfix PRs';


// Single source of truth for parsing env-var names + add/remove status from a
// raw diff's `newValue` (leading +/- markers still present). Mirrors the
// dashboard's render-time parser in dashboard/src/components/Release/envVars.ts
// (which reads cleaned values without +/- prefixes) — both allow lower/upper
// case keys so canvas counts and dashboard badges agree.
function parseEnvChanges(
  envChanges: Array<{ newValue: string }> | undefined
): Array<{ name: string; status: string }> {
  if (!envChanges || envChanges.length === 0) {
    return [];
  }

  const envVarRegex = /^([+-])\s*([A-Za-z][A-Za-z0-9_]*)(?:\s*=|\s*:)/gm;
  const envVarStatusMap = new Map<string, { added: boolean; removed: boolean }>();

  for (const change of envChanges) {
    if (change.newValue) {
      let match;
      envVarRegex.lastIndex = 0;
      while ((match = envVarRegex.exec(change.newValue)) !== null) {
        const sign = match[1];
        const varName = match[2];
        if (!envVarStatusMap.has(varName)) {
          envVarStatusMap.set(varName, { added: false, removed: false });
        }
        const status = envVarStatusMap.get(varName)!;
        if (sign === '+') status.added = true;
        if (sign === '-') status.removed = true;
      }
    }
  }

  return Array.from(envVarStatusMap.entries())
    .map(([name, flags]) => {
      let status = 'MODIFIED';
      if (flags.added && !flags.removed) status = 'ADDED';
      else if (!flags.added && flags.removed) status = 'DELETED';
      return { name, status };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CommitAnalysisCanvasMetadata {
  projectId?: string | null;
  conversationId?: string;
  channelId?: string;
  workspace: string;
  repoSlug: string;
  deployedCommitId: string;
  newCommitId: string;
  affectedApplicationCount: number;
  migrationCount: number;
  envChangeCount: number;
  workspaceId?: string;
}

export interface CommitAnalysisRepoSlice {
  workspace: string;
  repoSlug: string;
  deployedCommitId: string;
  newCommitId: string;
  results: CommitAnalysisResult[];
  affectedApplications?: AffectedApplicationInfo[];
}

type CanvasEnvChange = { filePath: string; fileName: string; newValue: string; commitId?: string; applicationId?: string };
type CanvasMigrationLink = { filePath: string; diffUrl: string; applicationId?: string };

// A "result" shape narrowed to what the PR/env/migration renderers read. Both
// the main analysis and the hotfix delta feed the same renderers.
type PrResult = {
  commitId: string;
  pullRequest: { id: number; title: string; url: string; author: { displayName: string; emailAddress?: string } } | null;
  ticket: { id: string; xyneId: string; title: string; status: string } | null;
  filePaths: string[];
};

// -------------------------------------------------------------------------
// User lookup (email → workspace user) with per-build cache, so a PR author
// resolves to a @mention once regardless of how many PRs they touched.
// -------------------------------------------------------------------------
type UserLookupResult = { userId: string; username: string; userEmail: string; userPicture: string } | null;
type UserLookup = (email: string | undefined, workspaceId: string) => Promise<UserLookupResult>;

function makeUserLookup(): UserLookup {
  const cache = new Map<string, UserLookupResult>();
  const userRepository = new UserRepository();
  return async (email, workspaceId) => {
    if (!email) return null;
    if (cache.has(email)) return cache.get(email)!;
    try {
      const user = await userRepository.findByEmail(email, workspaceId);
      if (user) {
        const userData = {
          userId: user.id,
          username: user.name,
          userEmail: user.email,
          userPicture: user.picture || '',
        };
        cache.set(email, userData);
        return userData;
      }
    } catch (error) {
      logger.warn(`[CanvasService] Failed to lookup user by email ${email}:`, error);
    }
    cache.set(email, null);
    return null;
  };
}

// Index env changes primarily by `${commitId}::${filePath}` so two commits that
// touch the SAME env file (e.g. a main PR and a later hotfix both editing
// .env.prod) don't collapse to one entry. A path-only key is also stored as a
// fallback for changes that lack a commitId (the run-accumulated summary).
function indexEnvChangesByPath(
  envChanges: CanvasEnvChange[] | undefined
): Map<string, { fileName: string; newValue: string }> {
  const map = new Map<string, { fileName: string; newValue: string }>();
  if (envChanges) {
    for (const change of envChanges) {
      // newValue may legitimately be '' (emptied env file)
      if (change.filePath && change.fileName) {
        const entry = { fileName: change.fileName, newValue: change.newValue };
        if (change.commitId) map.set(`${change.commitId}::${change.filePath}`, entry);
        if (!map.has(change.filePath)) map.set(change.filePath, entry);
      }
    }
  }
  return map;
}

// Group migration links by commit so a file like schema.prisma touched by
// multiple PRs resolves to the right per-commit diff.
function indexMigrationLinksByCommit(
  migrationLinks: CanvasMigrationLink[] | undefined
): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  if (migrationLinks) {
    for (const link of migrationLinks) {
      const commitMatch = link.diffUrl.match(/commits?\/([a-f0-9]+)/);
      if (commitMatch) {
        const commitId = commitMatch[1];
        if (!map.has(commitId)) map.set(commitId, new Map());
        map.get(commitId)!.set(link.filePath, link.diffUrl);
      }
    }
  }
  return map;
}

function resultsForApplication(results: PrResult[], matchedFiles: string[]): PrResult[] {
  if (matchedFiles.length === 0) return [];
  const matched = new Set(matchedFiles);
  return results
    .map(result => ({ ...result, filePaths: result.filePaths.filter(fp => matched.has(fp)) }))
    .filter(result => result.filePaths.length > 0);
}

function uniqueMigrationsByPath(links: CanvasMigrationLink[]): CanvasMigrationLink[] {
  const seen = new Map<string, CanvasMigrationLink>();
  for (const link of links) {
    if (!seen.has(link.filePath)) seen.set(link.filePath, link);
  }
  return [...seen.values()];
}

type AppScope = { results: PrResult[]; label?: string };
function appScopes(
  affectedApplications: AffectedApplicationInfo[],
  repoSlices: CommitAnalysisRepoSlice[] | undefined,
  allResults: PrResult[],
): Map<string, AppScope> {
  const scopes = new Map<string, AppScope>();
  const multiRepo = (repoSlices?.length ?? 0) > 1;
  for (const slice of repoSlices ?? []) {
    const scope: AppScope = {
      results: slice.results,
      ...(multiRepo ? { label: `${slice.workspace}/${slice.repoSlug}` } : {}),
    };
    for (const app of slice.affectedApplications ?? []) scopes.set(app.id, scope);
  }
  for (const app of affectedApplications) {
    if (!scopes.has(app.id)) scopes.set(app.id, { results: allResults });
  }
  return scopes;
}

const countLabel = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// PR-less commits are keyed by commit so they can't poison the claimed set.
const resultKey = (result: PrResult): number | string => result.pullRequest?.id ?? result.commitId;

function uniquePrResults(results: PrResult[]): PrResult[] {
  const seen = new Map<number, PrResult>();
  for (const result of results) {
    if (result.pullRequest && !seen.has(result.pullRequest.id)) {
      seen.set(result.pullRequest.id, result);
    }
  }
  return [...seen.values()];
}

// Render one PR into `blocks`. Shared by the main "Pull Requests & Tickets"
// section and the "Hotfix PRs" section so both render identically.
async function appendPullRequestBlocks(
  blocks: BlockNoteBlock[],
  result: PrResult,
  metadata: CommitAnalysisCanvasMetadata,
  mentionedUserIds: Set<string>,
  lookupUserByEmail: UserLookup,
  envChangesByPath: Map<string, { fileName: string; newValue: string }>,
  migrationLinksByCommit: Map<string, Map<string, string>>,
): Promise<void> {
  if (!result.pullRequest) return;
  const pr = result.pullRequest;

  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 3 },
    content: [
      { type: 'text', text: `PR #${pr.id}: `, styles: { bold: true } },
      { type: 'text', text: pr.title, styles: {} },
    ],
  });

  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: 'URL: ', styles: { bold: true } },
      { type: 'link', href: pr.url, content: [{ type: 'text', text: pr.url, styles: {} }] },
    ],
  });

  const authorUser = metadata.workspaceId
    ? await lookupUserByEmail(pr.author.emailAddress, metadata.workspaceId)
    : null;
  const authorContent: BlockNoteInlineContent[] = [
    { type: 'text', text: 'Author: ', styles: { bold: true } },
  ];
  if (authorUser) {
    authorContent.push({
      type: 'mention',
      props: {
        userId: authorUser.userId,
        username: authorUser.username,
        userEmail: authorUser.userEmail,
        userPicture: authorUser.userPicture,
      },
    });
    mentionedUserIds.add(authorUser.userId);
  } else {
    authorContent.push({ type: 'text', text: pr.author.displayName, styles: {} });
  }
  blocks.push({ id: uuidv4(), type: 'paragraph', content: authorContent });

  if (result.ticket && metadata.channelId) {
    const ticketUrl = `${config.slackFrontendUrl}/chat/${metadata.channelId}?tab=tickets&ticketId=${result.ticket.id}&conversationId=${metadata.conversationId || ''}`;
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ticket: ', styles: { bold: true } },
        { type: 'link', href: ticketUrl, content: [{ type: 'text', text: `${result.ticket.xyneId}`, styles: {} }] },
        { type: 'text', text: ` - ${result.ticket.title} (${result.ticket.status})`, styles: {} },
      ],
    });
  }

  // Env changes for this PR — look up by (commit, path) first so this PR shows
  // ITS OWN env diff, falling back to path-only for commit-less changes.
  const prEnvChangeList = result.filePaths
    .map((filePath) => envChangesByPath.get(`${result.commitId}::${filePath}`) ?? envChangesByPath.get(filePath))
    .filter((c): c is { fileName: string; newValue: string } => !!c);
  if (prEnvChangeList.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [{ type: 'text', text: 'Environment Changes:', styles: { bold: true } }],
    });
    for (const item of parseEnvChanges(prEnvChangeList)) {
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [
          { type: 'text', text: item.name, styles: { code: true } },
          { type: 'text', text: ` [${item.status}]`, styles: { bold: true } },
        ],
      });
    }
  }

  // Migration changes specific to this PR's commit
  const prMigrationLinks = migrationLinksByCommit.get(result.commitId);
  const prMigrationChanges = prMigrationLinks
    ? result.filePaths.filter(fp => prMigrationLinks.has(fp))
    : [];
  if (prMigrationChanges.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [{ type: 'text', text: 'Migration Changes:', styles: { bold: true } }],
    });
    for (const filePath of prMigrationChanges) {
      const fileName = filePath.split('/').pop() || filePath;
      const diffUrl = prMigrationLinks!.get(filePath);
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [
          { type: 'link', href: diffUrl!, content: [{ type: 'text', text: 'View Diff → ', styles: {} }] },
          { type: 'text', text: fileName, styles: { code: true } },
        ],
      });
    }
  }

  blocks.push({ id: uuidv4(), type: 'paragraph', content: [] });
}

// -------------------------------------------------------------------------
// Content builders
// -------------------------------------------------------------------------

// Builds every block ABOVE the hotfix section: title, repo, range, summary,
// services, config changes, env vars and the "🔀 Pull Requests & Tickets" list.
async function buildMainAnalysisBlocks(
  results: PrResult[],
  affectedApplications: AffectedApplicationInfo[],
  envChanges: CanvasEnvChange[] | undefined,
  migrationLinks: CanvasMigrationLink[] | undefined,
  metadata: CommitAnalysisCanvasMetadata,
  title: string,
  repoSlices?: CommitAnalysisRepoSlice[],
): Promise<{ blocks: BlockNoteBlock[]; mentionedUserIds: string[] }> {
  const blocks: BlockNoteBlock[] = [];
  const mentionedUserIds = new Set<string>();
  const lookupUserByEmail = makeUserLookup();

  const envVarList = parseEnvChanges(envChanges);
  const envVariableCount = envVarList.length;

  const totalCommits = results.length;
  const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
  const commitsWithTicket = results.filter((r) => r.ticket !== null).length;

  const multiRepo = (repoSlices?.length ?? 0) > 1;

  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: title, styles: { bold: true } }],
  });

  if (multiRepo && repoSlices) {
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Repositories ', styles: { bold: true } },
        { type: 'text', text: `(${repoSlices.length})`, styles: {} },
      ],
    });
    for (const slice of repoSlices) {
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [
          { type: 'text', text: `${slice.workspace}/${slice.repoSlug}`, styles: { bold: true } },
          { type: 'text', text: ' — ', styles: {} },
          { type: 'text', text: `${slice.deployedCommitId.slice(0, 8)}...${slice.newCommitId.slice(0, 8)}`, styles: { code: true } },
          { type: 'text', text: ` (${slice.results.length} commits)`, styles: {} },
        ],
      });
    }
  } else {
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Repository: ', styles: { bold: true } },
        { type: 'text', text: `${metadata.workspace}/${metadata.repoSlug}`, styles: {} },
      ],
    });

    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Commit Range: ', styles: { bold: true } },
        { type: 'text', text: `${metadata.deployedCommitId.slice(0, 8)}...${metadata.newCommitId.slice(0, 8)}`, styles: { code: true } },
      ],
    });
  }

  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 2 },
    content: [{ type: 'text', text: '📊 Summary', styles: {} }],
  });

  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [{ type: 'text', text: `${totalCommits} commits analyzed • ${commitsWithPR} with PRs • ${commitsWithTicket} with tickets`, styles: {} }],
  });

  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 2 },
    content: [{ type: 'text', text: '⚙️ Configuration Changes', styles: {} }],
  });

  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Migration Changes: ', styles: { bold: true } },
      { type: 'text', text: metadata.migrationCount > 0 ? `Yes (${metadata.migrationCount} files)` : 'No', styles: {} },
    ],
  });

  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Environment Changes: ', styles: { bold: true } },
      { type: 'text', text: envVariableCount > 0 ? `Yes (${envVariableCount} variables)` : 'No', styles: {} },
    ],
  });

  const envChangesByPath = indexEnvChangesByPath(envChanges);
  const migrationLinksByCommit = indexMigrationLinksByCommit(migrationLinks);

  if (affectedApplications.length > 0) {
    type ServiceSection = {
      heading: string;
      mappedTicketId?: string;
      envVars: ReturnType<typeof parseEnvChanges>;
      migrations: CanvasMigrationLink[];
      prResults: PrResult[];
    };

    const scopes = appScopes(affectedApplications, repoSlices, results);
    const allEnvChanges = envChanges ?? [];
    const allMigrationLinks = migrationLinks ?? [];

    const sections: ServiceSection[] = affectedApplications.map(app => {
      const scope = scopes.get(app.id)!;
      return {
        heading: scope.label ? `🚀 ${app.name} — ${scope.label}` : `🚀 ${app.name}`,
        mappedTicketId: app.mappedTicketId,
        envVars: parseEnvChanges(allEnvChanges.filter(change => change.applicationId === app.id)),
        migrations: uniqueMigrationsByPath(
          allMigrationLinks.filter(link => link.applicationId === app.id),
        ),
        prResults: uniquePrResults(resultsForApplication(scope.results, app.matchedFiles)),
      };
    });

    // PR ids are repo-local, so "unclaimed" is resolved per repo.
    const unclaimedResults = (repoSlices?.length ? repoSlices : [{ results, affectedApplications }]).flatMap(slice => {
      const apps = slice.affectedApplications ?? affectedApplications;
      const claimed = new Set(
        apps.flatMap(app => resultsForApplication(slice.results, app.matchedFiles).map(resultKey)),
      );
      return uniquePrResults(slice.results.filter(result => !claimed.has(resultKey(result))));
    });
    const unclaimed: ServiceSection = {
      heading: '📦 Other changes',
      envVars: parseEnvChanges(allEnvChanges.filter(change => !change.applicationId)),
      migrations: uniqueMigrationsByPath(allMigrationLinks.filter(link => !link.applicationId)),
      prResults: unclaimedResults,
    };
    if (
      unclaimed.envVars.length > 0 ||
      unclaimed.migrations.length > 0 ||
      unclaimed.prResults.length > 0
    ) {
      sections.push(unclaimed);
    }

    for (const section of sections) {
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: section.heading, styles: {} }],
      });

      const summary: BlockNoteInlineContent[] = [
        {
          type: 'text',
          text: `${countLabel(section.prResults.length, 'PR')} • ${countLabel(section.migrations.length, 'migration')} • ${countLabel(section.envVars.length, 'env var')}`,
          styles: {},
        },
      ];
      if (section.mappedTicketId && metadata.channelId) {
        const ticketUrl = `${config.slackFrontendUrl}/chat/${metadata.channelId}?tab=tickets&ticketId=${section.mappedTicketId}&conversationId=${metadata.conversationId || ''}`;
        summary.push({ type: 'text', text: ' • ', styles: {} });
        summary.push({ type: 'link', href: ticketUrl, content: [{ type: 'text', text: 'Ticket', styles: {} }] });
      }
      blocks.push({ id: uuidv4(), type: 'paragraph', content: summary });

      for (const item of section.envVars) {
        blocks.push({
          id: uuidv4(),
          type: 'bulletListItem',
          content: [
            { type: 'text', text: '🔧 ', styles: {} },
            { type: 'text', text: item.name, styles: { code: true } },
            { type: 'text', text: ` [${item.status}]`, styles: { bold: true } },
          ],
        });
      }

      for (const link of section.migrations) {
        blocks.push({
          id: uuidv4(),
          type: 'bulletListItem',
          // BlockNote rejects code+link on one text node; keep the path outside the link.
          content: [
            { type: 'text', text: '🗃️ ', styles: {} },
            { type: 'link', href: link.diffUrl, content: [{ type: 'text', text: 'View Diff → ', styles: {} }] },
            { type: 'text', text: link.filePath, styles: { code: true } },
          ],
        });
      }

      for (const result of section.prResults) {
        await appendPullRequestBlocks(
          blocks, result, metadata, mentionedUserIds, lookupUserByEmail, envChangesByPath, migrationLinksByCommit,
        );
      }
    }
  } else {
    if (envVarList.length > 0) {
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: '🔧 Environment Variables', styles: {} }],
      });
      for (const item of envVarList) {
        blocks.push({
          id: uuidv4(),
          type: 'bulletListItem',
          content: [
            { type: 'text', text: item.name, styles: { code: true } },
            { type: 'text', text: ` [${item.status}]`, styles: { bold: true } },
          ],
        });
      }
    }

    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '🔀 Pull Requests & Tickets', styles: {} }],
    });

    if (multiRepo && repoSlices) {
      for (const slice of repoSlices) {
        const prResults = uniquePrResults(slice.results);
        if (prResults.length === 0) continue;
        blocks.push({
          id: uuidv4(),
          type: 'heading',
          props: { level: 3 },
          content: [{ type: 'text', text: `📦 ${slice.workspace}/${slice.repoSlug}`, styles: {} }],
        });
        for (const result of prResults) {
          await appendPullRequestBlocks(
            blocks, result, metadata, mentionedUserIds, lookupUserByEmail, envChangesByPath, migrationLinksByCommit,
          );
        }
      }
    } else {
      for (const result of uniquePrResults(results)) {
        await appendPullRequestBlocks(
          blocks, result, metadata, mentionedUserIds, lookupUserByEmail, envChangesByPath, migrationLinksByCommit,
        );
      }
    }
  }

  return { blocks, mentionedUserIds: [...mentionedUserIds] };
}

// Builds the "🔥 Hotfix PRs" section. Returns an empty block list when there are
// no hotfix PRs so callers can drop the section entirely.
async function buildHotfixSectionBlocks(
  results: PrResult[],
  envChanges: CanvasEnvChange[] | undefined,
  migrationLinks: CanvasMigrationLink[] | undefined,
  metadata: CommitAnalysisCanvasMetadata,
): Promise<{ blocks: BlockNoteBlock[]; mentionedUserIds: string[] }> {
  const prResults = uniquePrResults(results);
  if (prResults.length === 0) {
    return { blocks: [], mentionedUserIds: [] };
  }

  const blocks: BlockNoteBlock[] = [];
  const mentionedUserIds = new Set<string>();
  const lookupUserByEmail = makeUserLookup();

  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 2 },
    content: [{ type: 'text', text: HOTFIX_HEADING_TEXT, styles: {} }],
  });

  // metadata.deployedCommitId/newCommitId here carry the hotfix delta range
  // (frozen release head → new branch head).
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: `${prResults.length} hotfix PR${prResults.length === 1 ? '' : 's'} merged after release`, styles: { italic: true } },
      { type: 'text', text: ` (${metadata.deployedCommitId.slice(0, 8)}...${metadata.newCommitId.slice(0, 8)})`, styles: { code: true } },
    ],
  });

  const envChangesByPath = indexEnvChangesByPath(envChanges);
  const migrationLinksByCommit = indexMigrationLinksByCommit(migrationLinks);

  for (const result of prResults) {
    await appendPullRequestBlocks(
      blocks, result, metadata, mentionedUserIds, lookupUserByEmail, envChangesByPath, migrationLinksByCommit,
    );
  }

  return { blocks, mentionedUserIds: [...mentionedUserIds] };
}

// -------------------------------------------------------------------------
// Hotfix-section slicing on stored content (idempotent upserts)
// -------------------------------------------------------------------------
function findHotfixHeadingIndex(blocks: BlockNoteBlock[]): number {
  return blocks.findIndex(
    (b) =>
      b?.type === 'heading' &&
      Array.isArray(b.content) &&
      b.content.some((c: any) => c?.type === 'text' && c.text === HOTFIX_HEADING_TEXT),
  );
}
function extractHotfixSection(blocks: BlockNoteBlock[]): BlockNoteBlock[] {
  const i = findHotfixHeadingIndex(blocks);
  return i < 0 ? [] : blocks.slice(i);
}
function stripHotfixSection(blocks: BlockNoteBlock[]): BlockNoteBlock[] {
  const i = findHotfixHeadingIndex(blocks);
  return i < 0 ? blocks : blocks.slice(0, i);
}

// -------------------------------------------------------------------------
// Persistence
// -------------------------------------------------------------------------
async function fireCanvasSideEffectsAndIndex(
  canvasId: string,
  createdByUserId: string,
  isInsert: boolean,
): Promise<void> {
  // The creator is usually the xyne-release-bot user, not the human whose request
  // triggered the analysis. Under the ambient request context OrgMembersACL narrows
  // the org_members read to the caller's OWN row (for non-admin members), hiding the
  // bot's row and wrongly failing with "not a member of any organization". This is
  // workspace work, so resolve the creator under service scope (tenant boundary only).
  const { user, orgMember } = await withWorkspaceScope(async () => {
    const user = await db.user.findUnique({
      where: { id: createdByUserId },
      select: { id: true, email: true, workspaceId: true, role: true },
    });
    if (!user || !user.workspaceId) {
      throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
    }
    // Email is globally unique in orgMember, single lookup is sufficient
    const orgMember = isInsert
      ? await db.orgMember.findUnique({ where: { email: user.email } })
      : null;
    return { user, orgMember };
  });
  if (isInsert) {
    if (!orgMember) {
      throw new Error(`User ${createdByUserId} is not a member of any organization`);
    }
    const canvasHandler = new CanvasSideEffectHandler({
      userID: user.id,
      workspaceId: user.workspaceId,
      role: user.role,
      memberId: orgMember.memberId,
      orgRole: orgMember.role,
    });
    canvasHandler.onInsert({ entityId: canvasId, entityType: 'canvases', operation: 'insert' })
      .catch(err => logger.error('[CanvasService] Canvas side-effect handler error:', err));
  }

  try {
    await vespaQueue.addJob({
      schema: fileSchema,
      docId: canvasId,
      jobType: 'feed',
      userId: createdByUserId,
      workspaceId: user.workspaceId,
      app: SubApp.CANVAS,
    });
  } catch (vespaError) {
    logger.error(`[CanvasService] Failed to queue Vespa job for commit analysis canvas ${canvasId}:`, vespaError);
  }
}

// Find the single existing release-analysis canvas for a conversation.
async function findExistingAnalysisCanvas(
  conversationId: string | undefined,
  channelId: string | undefined,
) {
  if (!conversationId) return null;
  return prisma.canvas.findFirst({
    where: {
      ...(channelId ? { channelId } : {}),
      AND: [
        { metadata: { path: ['source'], equals: 'commit_analysis' } },
        { metadata: { path: ['conversationId'], equals: conversationId } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findAnalysisCanvasIdForConversation(
  conversationId: string | undefined,
  channelId: string | undefined,
): Promise<string | null> {
  const canvas = await findExistingAnalysisCanvas(conversationId, channelId);
  return canvas?.id ?? null;
}

type CanvasSection = 'main' | 'hotfix';

export interface UpsertCommitAnalysisCanvasArgs {
  section: CanvasSection;
  results: CommitAnalysisResult[];
  affectedApplications: AffectedApplicationInfo[];
  envChanges: CanvasEnvChange[] | undefined;
  migrationLinks: CanvasMigrationLink[] | undefined;
  createdByUserId: string;
  metadata: CommitAnalysisCanvasMetadata;
  repoSlices?: CommitAnalysisRepoSlice[];
}

/**
 * Create-or-update the SINGLE release-analysis canvas for a release conversation.
 *
 * One canvas per release: the canvas is located by (source='commit_analysis' +
 * conversationId) and updated in place — no new canvas is minted on re-run or on
 * a hotfix sync.
 *
 * - section='main'  rebuilds everything above the hotfix section and PRESERVES
 *   any existing "🔥 Hotfix PRs" blocks.
 * - section='hotfix' rebuilds ONLY the hotfix section and PRESERVES the existing
 *   main blocks. An empty hotfix delta removes the section.
 *
 * Returns the canvas id (stable across updates), or null on failure.
 */
export async function upsertCommitAnalysisCanvas(
  args: UpsertCommitAnalysisCanvasArgs,
): Promise<string | null> {
  const { section, results, affectedApplications, envChanges, migrationLinks, createdByUserId, metadata, repoSlices } = args;

  // Serialize the re-entrant find-then-update/create (Re-run + webhook) so
  // concurrent runs don't double-create or clobber the canvas. Fails open.
  const lockKey = metadata.conversationId
    ? `lock:release-analysis-canvas:${metadata.conversationId}`
    : null;
  const lock = lockKey ? await acquireLock(lockKey, { waitTimeoutMs: 30_000, ttlSeconds: 120 }) : null;
  if (lockKey && !lock) {
    logger.warn(`[CanvasService] Proceeding without lock ${lockKey} — held past wait window`);
  }

  try {
    const now = new Date();
    const existing = await findExistingAnalysisCanvas(metadata.conversationId, metadata.channelId);

    // Read the live document so rebuilding one section preserves the other.
    // Legacy DB-backed canvases migrate after the replacement is stored successfully.
    const existingBlocks = existing
      ? existing.isCollaborative
        ? await readFromYSweetStrict(existing.id, createdByUserId)
        : (existing.content as unknown as BlockNoteBlock[]) ?? []
      : [];

    let content: BlockNoteBlock[];
    let mentionedUserIds: string[];

    if (section === 'hotfix') {
      const hotfix = await buildHotfixSectionBlocks(results, envChanges, migrationLinks, metadata);
      if (existing) {
        content = [...stripHotfixSection(existingBlocks), ...hotfix.blocks];
      } else {
        // No canvas yet (hotfix arrived before any main analysis) — start from a
        // minimal main scaffold so the section has context.
        const scaffold = await buildMainAnalysisBlocks(
          [], [], undefined, undefined, metadata, analysisCanvasTitle(metadata, now),
        );
        content = [...scaffold.blocks, ...hotfix.blocks];
      }
      mentionedUserIds = hotfix.mentionedUserIds;
    } else {
      const title = existing?.title || analysisCanvasTitle(metadata, now);
      const main = await buildMainAnalysisBlocks(results, affectedApplications, envChanges, migrationLinks, metadata, title, repoSlices);
      const preservedHotfix = existing
        ? extractHotfixSection(existingBlocks)
        : [];
      content = [...main.blocks, ...preservedHotfix];
      mentionedUserIds = main.mentionedUserIds;
    }

    if (existing) {
      const prevMeta = (existing.metadata as Record<string, unknown>) || {};
      const prevMentions = Array.isArray(prevMeta.mentionedUserIds) ? (prevMeta.mentionedUserIds as string[]) : [];
      const synced = await syncToYSweet(existing.id, content, createdByUserId);
      if (!synced) {
        throw new Error(`Failed to save commit analysis canvas ${existing.id} to Y-Sweet`);
      }
      await prisma.canvas.update({
        where: { id: existing.id },
        data: {
          content: [],
          isCollaborative: true,
          lastEditedBy: createdByUserId,
          lastEditedAt: now,
          updatedAt: now,
          metadata: {
            ...prevMeta,
            source: 'commit_analysis',
            workspace: metadata.workspace,
            repoSlug: metadata.repoSlug,
            commitCount: results.length,
            mentionedUserIds: [...new Set([...prevMentions, ...mentionedUserIds])],
            // Only the main section owns the release range — a hotfix update
            // must not overwrite it with the hotfix delta range.
            ...(section === 'main' && {
              deployedCommitId: metadata.deployedCommitId,
              newCommitId: metadata.newCommitId,
            }),
            ...(metadata.conversationId && { conversationId: metadata.conversationId }),
            ...(metadata.projectId && { projectId: metadata.projectId }),
          },
        },
      });
      logger.info(`[CanvasService] Updated release analysis canvas ${existing.id} (section=${section}) for ${metadata.workspace}/${metadata.repoSlug}`);
      // Non-fatal side-effects (see persistNewAnalysisCanvas).
      try {
        await fireCanvasSideEffectsAndIndex(existing.id, createdByUserId, false);
      } catch (sideEffectError) {
        logger.error(`[CanvasService] Canvas ${existing.id} updated; side-effects/indexing failed (non-fatal):`, sideEffectError);
      }
      return existing.id;
    }

    // Create a fresh canvas (first analysis for this conversation).
    const canvasId = await persistNewAnalysisCanvas({
      content,
      mentionedUserIds,
      commitCount: results.length,
      createdByUserId,
      metadata,
      now,
    });
    logger.info(`[CanvasService] Created release analysis canvas ${canvasId} (section=${section}) for ${metadata.workspace}/${metadata.repoSlug}`);
    return canvasId;
  } catch (error) {
    logger.error('[CanvasService] Failed to upsert commit analysis canvas:', error);
    return null;
  } finally {
    await releaseLock(lock);
  }
}

function analysisCanvasTitle(metadata: CommitAnalysisCanvasMetadata, now: Date): string {
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `📦 Release Analysis: ${metadata.workspace}/${metadata.repoSlug} - ${dateStr}`;
}

// Shared new-canvas persistence (row + participant + side effects) for both entry points.
async function persistNewAnalysisCanvas(args: {
  content: BlockNoteBlock[];
  mentionedUserIds: string[];
  commitCount: number;
  createdByUserId: string;
  metadata: CommitAnalysisCanvasMetadata;
  now: Date;
}): Promise<string> {
  const { content, mentionedUserIds, commitCount, createdByUserId, metadata, now } = args;
  const canvasId = uuidv4();
  const finalTitle = analysisCanvasTitle(metadata, now);

  // Canvas rows carry the denormalized tenant key; resolve it from the creator
  // before insert (matches main's XYNE-17656 tenant stamping).
  const creator = await db.user.findUnique({
    where: { id: createdByUserId },
    select: { workspaceId: true },
  });
  if (!creator || !creator.workspaceId) {
    throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
  }

  const synced = await syncToYSweet(canvasId, content, createdByUserId);
  if (!synced) {
    throw new Error(`Failed to save commit analysis canvas ${canvasId} to Y-Sweet`);
  }

  await prisma.canvas.create({
    data: {
      id: canvasId,
      title: finalTitle,
      content: [],
      workspaceId: creator.workspaceId,
      createdBy: createdByUserId,
      visibility: CanvasVisibility.PUBLIC,
      isTemplate: false,
      isCollaborative: true,
      lastEditedBy: createdByUserId,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
      channelId: metadata.channelId || null,
      metadata: {
        source: 'commit_analysis',
        workspace: metadata.workspace,
        repoSlug: metadata.repoSlug,
        deployedCommitId: metadata.deployedCommitId,
        newCommitId: metadata.newCommitId,
        commitCount,
        affectedApplicationCount: metadata.affectedApplicationCount,
        migrationCount: metadata.migrationCount,
        envChangeCount: metadata.envChangeCount,
        mentionedUserIds,
        ...(metadata.projectId && { projectId: metadata.projectId }),
        ...(metadata.conversationId && { conversationId: metadata.conversationId }),
      },
    },
  });

  await prisma.canvasParticipant.create({
    data: {
      id: uuidv4(),
      canvasId,
      workspaceId: creator.workspaceId,
      userId: createdByUserId,
      role: CanvasRole.VIEWER,
      joinedAt: now,
      updatedAt: now,
    },
  });

  // Side-effects/indexing must not abort canvas creation — degrade, keep the canvasId.
  try {
    await fireCanvasSideEffectsAndIndex(canvasId, createdByUserId, true);
  } catch (sideEffectError) {
    logger.error(`[CanvasService] Canvas ${canvasId} created; side-effects/indexing failed (non-fatal):`, sideEffectError);
  }
  return canvasId;
}

/**
 * Legacy create-only entry point. Used by the sub-ticket update path, which
 * posts into a DIFFERENT (parent) conversation and intentionally gets its own
 * canvas. The main release + hotfix flows use upsertCommitAnalysisCanvas.
 */
export async function createCommitAnalysisCanvas(
  results: CommitAnalysisResult[],
  affectedApplications: AffectedApplicationInfo[],
  envChanges: CanvasEnvChange[] | undefined,
  migrationLinks: CanvasMigrationLink[] | undefined,
  createdByUserId: string,
  metadata: CommitAnalysisCanvasMetadata,
  repoSlices?: CommitAnalysisRepoSlice[]
): Promise<string | null> {
  try {
    const now = new Date();
    const { blocks: content, mentionedUserIds } = await buildMainAnalysisBlocks(
      results, affectedApplications, envChanges, migrationLinks, metadata, analysisCanvasTitle(metadata, now), repoSlices,
    );

    const canvasId = await persistNewAnalysisCanvas({
      content,
      mentionedUserIds,
      commitCount: results.length,
      createdByUserId,
      metadata,
      now,
    });
    logger.info(
      `[CanvasService] Created commit analysis canvas ${canvasId} with ${results.length} commits for ${metadata.workspace}/${metadata.repoSlug}`
    );
    return canvasId;
  } catch (error) {
    logger.error('[CanvasService] Failed to create commit analysis canvas:', error);
    return null;
  }
}
