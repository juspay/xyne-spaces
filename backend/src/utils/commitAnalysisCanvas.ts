import { DatabaseClient } from "@/database/client";
import { BlockNoteBlock, BlockNoteInlineContent } from "@/types/blockNoteTypes";
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { CommitAnalysisResult } from "@/services/commitAnalysisService";
import { AffectedApplicationInfo } from "@/services/release/core";
import { config } from '@/config/env';
import { UserRepository } from "@/database/repositories/users";
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { db } from '@/database/client';

const prisma = DatabaseClient.getInstance();


function parseEnvChanges(
  envChanges: Array<{ filePath: string; fileName: string; newValue: string }> | undefined
): Array<{ name: string; status: string }> {
  if (!envChanges || envChanges.length === 0) {
    return [];
  }

  const envVarRegex = /^([+-])\s*([A-Z][A-Z0-9_]*)(?:\s*=|\s*:)/gm;
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

export async function createCommitAnalysisCanvas(
  results: CommitAnalysisResult[],
  affectedApplications: AffectedApplicationInfo[],
  envChanges: Array<{ filePath: string; fileName: string; newValue: string }> | undefined,
  migrationLinks: Array<{ filePath: string; diffUrl: string }> | undefined,
  createdByUserId: string,
  metadata: CommitAnalysisCanvasMetadata
): Promise<string | null> {
  try {
    const now = new Date();

    // Generate IDs
    const canvasId = uuidv4();
    const viewAccessId = uuidv4();
    const participantId = uuidv4();

    const dateStr = now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const finalTitle = `📦 Release Analysis: ${metadata.workspace}/${metadata.repoSlug} - ${dateStr}`;

    // Format analysis to BlockNote content
    const { blocks: content, mentionedUserIds } = await formatCommitAnalysisToBlockNote(
      results,
      affectedApplications,
      envChanges,
      migrationLinks,
      metadata,
      finalTitle
    );

    // Create the canvas with PUBLIC visibility (read-only)
    await prisma.canvas.create({
      data: {
        id: canvasId,
        title: finalTitle,
        content: content as any,
        createdBy: createdByUserId,
        viewAccessId,
        editAccessId: null,
        visibility: 'PUBLIC',
        isTemplate: false,
        isCollaborative: false,
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
          commitCount: results.length,
          affectedApplicationCount: metadata.affectedApplicationCount,
          migrationCount: metadata.migrationCount,
          envChangeCount: metadata.envChangeCount,
          mentionedUserIds,
          ...(metadata.projectId && { projectId: metadata.projectId }),
          ...(metadata.conversationId && { conversationId: metadata.conversationId }),
        },
      },
    });

    // (read-only canvas)
    await prisma.canvasParticipant.create({
      data: {
        id: participantId,
        canvasId,
        userId: createdByUserId,
        role: 'VIEWER',
        joinedAt: now,
        updatedAt: now,
      },
    });

    logger.info(
      `[CanvasService] Created commit analysis canvas ${canvasId} with ${results.length} commits for ${metadata.workspace}/${metadata.repoSlug}`
    );

    // Fetch complete context for the user to pass to side-effect handler
    const user = await db.user.findUnique({
      where: { id: createdByUserId },
      select: { id: true, email: true, workspaceId: true, role: true },
    });
    if (!user || !user.workspaceId) {
      throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
    }
    // Email is globally unique in orgMember, single lookup is sufficient
    const orgMember = await db.orgMember.findUnique({
      where: { email: user.email },
    });
    if (!orgMember) {
      throw new Error(`User ${createdByUserId} is not a member of any organization`);
    }

    // Manually call canvas handler for activities and notifications
    // (Canvas is created via Prisma, not Zero mutator, so handler won't auto-trigger)
    const canvasHandler = new CanvasSideEffectHandler({
      userID: user.id,
      workspaceId: user.workspaceId,
      role: user.role,
      memberId: orgMember.memberId,
      orgRole: orgMember.role,
    });
    canvasHandler.onInsert({
      entityId: canvasId,
      entityType: 'canvases',
      operation: 'insert'
    }).catch(err => logger.error('[CanvasService] Canvas side-effect handler error:', err));

    // Queue Vespa indexing for the canvas
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId: createdByUserId,
        workspaceId: user.workspaceId,
        app: SubApp.CANVAS,
      });
      logger.info(`[CanvasService] Queued Vespa indexing for commit analysis canvas ${canvasId}`);
    } catch (vespaError) {
      logger.error(`[CanvasService] Failed to queue Vespa job for commit analysis canvas ${canvasId}:`, vespaError);
    }

    return viewAccessId;
  } catch (error) {
    logger.error('[CanvasService] Failed to create commit analysis canvas:', error);
    return null;
  }
}

async function formatCommitAnalysisToBlockNote(
  results: Array<{
    commitId: string;
    pullRequest: { id: number; title: string; url: string; author: { displayName: string; emailAddress?: string } } | null;
    ticket: { id: string; xyneId: string; title: string; status: string } | null;
    filePaths: string[];
  }>,
  affectedApplications: Array<{
    id: string;
    name: string;
    subTicketId?: string;
    subTicketXyneId?: string;
    mappedTicketId?: string;
    matchedFiles: string[];
  }>,
  envChanges: Array<{ filePath: string; fileName: string; newValue: string }> | undefined,
  migrationLinks: Array<{ filePath: string; diffUrl: string }> | undefined,
  metadata: CommitAnalysisCanvasMetadata,
  title: string
): Promise<{ blocks: BlockNoteBlock[]; mentionedUserIds: string[] }> {
  const blocks: BlockNoteBlock[] = [];
  const mentionedUserIds = new Set<string>();

  const userLookupCache = new Map<string, { userId: string; username: string; userEmail: string; userPicture: string } | null>();
  const userRepository = new UserRepository();

  const lookupUserByEmail = async (email: string | undefined, workspaceId: string): Promise<{ userId: string; username: string; userEmail: string; userPicture: string } | null> => {
    if (!email) return null;

    // Check cache first
    if (userLookupCache.has(email)) {
      return userLookupCache.get(email)!;
    }

    try {
      const user = await userRepository.findByEmail(email, workspaceId);
      if (user) {
        const userData = {
          userId: user.id,
          username: user.name,
          userEmail: user.email,
          userPicture: user.picture || '',
        };
        userLookupCache.set(email, userData);
        return userData;
      }
    } catch (error) {
      logger.warn(`[CanvasService] Failed to lookup user by email ${email}:`, error);
    }

    userLookupCache.set(email, null);
    return null;
  };

  const envVarList = parseEnvChanges(envChanges);
  const envVariableCount = envVarList.length;

  const totalCommits = results.length;
  const commitsWithPR = results.filter((r) => r.pullRequest !== null).length;
  const commitsWithTicket = results.filter((r) => r.ticket !== null).length;

  // Main title
  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: title, styles: { bold: true } }],
  });

  // Repository info
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Repository: ', styles: { bold: true } },
      { type: 'text', text: `${metadata.workspace}/${metadata.repoSlug}`, styles: {} },
    ],
  });

  // Commit range
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Commit Range: ', styles: { bold: true } },
      { type: 'text', text: `${metadata.deployedCommitId.slice(0, 8)}...${metadata.newCommitId.slice(0, 8)}`, styles: { code: true } },
    ],
  });

  // Summary statistics
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

  // Services to deploy
  if (affectedApplications.length > 0) {
    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '🚀 Services to be Deployed', styles: {} }],
    });

    for (const app of affectedApplications) {
      const content: BlockNoteInlineContent[] = [
        { type: 'text', text: app.name, styles: { bold: true } },
      ];

      // Add ticket link if mappedTicketId exists
      if (app.mappedTicketId && metadata.channelId) {
        const ticketUrl = `${config.slackFrontendUrl}/chat/${metadata.channelId}?tab=tickets&ticketId=${app.mappedTicketId}&conversationId=${metadata.conversationId || ''}`;
        content.push({ type: 'text', text: ' - ', styles: {} });
        content.push({ type: 'link', href: ticketUrl, content: [{ type: 'text', text: 'Ticket', styles: {} }] });
      }

      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content,
      });
    }
  }

  // Environment and Migration changes
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

  // Pull Requests and Tickets section
  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 2 },
    content: [{ type: 'text', text: '🔀 Pull Requests & Tickets', styles: {} }],
  });

  // Group results by PR (unique PRs only)
  const uniquePRs = new Map<number, typeof results[0]>();
  for (const result of results) {
    if (result.pullRequest) {
      if (!uniquePRs.has(result.pullRequest.id)) {
        uniquePRs.set(result.pullRequest.id, result);
      }
    }
  }

  const envChangesByPath = new Map<string, { fileName: string; newValue: string }>();
  if (envChanges) {
    for (const change of envChanges) {
      if (change.filePath && change.fileName && change.newValue) {
        envChangesByPath.set(change.filePath, { fileName: change.fileName, newValue: change.newValue });
      }
    }
  }

  // Group migration links by PR (commit) to avoid cross-contamination
  // A file like schema.prisma can appear in multiple PRs, each with different commit IDs
  const migrationLinksByCommit = new Map<string, Map<string, string>>();
  if (migrationLinks) {
    for (const link of migrationLinks) {
      // Extract commit ID from the diffUrl
      const commitMatch = link.diffUrl.match(/commits\/([a-f0-9]+)/);
      if (commitMatch) {
        const commitId = commitMatch[1];
        if (!migrationLinksByCommit.has(commitId)) {
          migrationLinksByCommit.set(commitId, new Map());
        }
        migrationLinksByCommit.get(commitId)!.set(link.filePath, link.diffUrl);
      }
    }
  }

  for (const [, result] of uniquePRs) {
    if (!result.pullRequest) continue;

    const pr = result.pullRequest;

    // PR Title as heading
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

    // Author - with mention if user found
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
      // Track mentioned user for notifications
      mentionedUserIds.add(authorUser.userId);
    } else {
      // display username if not found
      authorContent.push({ type: 'text', text: pr.author.displayName, styles: {} });
    }

    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: authorContent,
    });

    // Ticket info if present
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

    // Display env changes for this PR
    const prEnvChanges = result.filePaths.filter(fp => envChangesByPath.has(fp));
    if (prEnvChanges.length > 0) {
      blocks.push({
        id: uuidv4(),
        type: 'paragraph',
        content: [{ type: 'text', text: 'Environment Changes:', styles: { bold: true } }],
      });

      const envVarStatusMap = new Map<string, { added: boolean; removed: boolean }>();
      const envVarRegex = /^([+-])\s*([A-Z][A-Z0-9_]*)(?:\s*=|\s*:)/gm;

      prEnvChanges.forEach((filePath) => {
        const change = envChangesByPath.get(filePath);
        if (change?.newValue) {
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
      });

      const envVarList = Array.from(envVarStatusMap.entries())
        .map(([name, flags]) => {
          let status = 'MODIFIED';
          if (flags.added && !flags.removed) status = 'ADDED';
          else if (!flags.added && flags.removed) status = 'DELETED';
          return { name, status };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

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

    // Look up migration links specific to this PR's commit
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

    // Spacing
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [],
    });
  }
  return { blocks, mentionedUserIds: [...mentionedUserIds] };
}