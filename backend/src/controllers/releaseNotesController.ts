import { Request, Response } from 'express';
import { ReleaseNotesService } from '@/services/releaseNotes/releaseNotesService';
import { conversationService } from '@/services/conversationService';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { config } from '@/config/env';
import { BaseTicketType, isReleaseTicket } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { unifiedBotUserService } from '@/bots/unified';
import { v4 as uuidv4 } from 'uuid';
import type { BlockNoteBlock, BlockNoteInlineContent } from '@/types/blockNoteTypes';
import { db } from '@/database/client';

interface PRData {
  prId: number;
  prUrl: string;
  title: string;
  description: string | null;
  potVideoLink: string | null;
}

interface ReleaseContext {
  release: {
    ticketId: string;
    xyneId: string;
    title: string;
    description: string | null;
    channelId?: string;
    conversationId?: string;
  };
  prs: PRData[];
}


const prisma = DatabaseClient.getInstance();

export class ReleaseNotesController {
  private releaseNotesService: ReleaseNotesService;
  private ticketRepository: TicketRepository;

  constructor() {
    this.releaseNotesService = new ReleaseNotesService();
    this.ticketRepository = new TicketRepository();
  }

  generateReleaseNotes = async (req: Request, res: Response): Promise<void> => {
    try {
      const { ticketId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
        return;
      }

      const ticket = await this.ticketRepository.getTicketById(ticketId);
      if (!ticket) {
        res.status(404).json({
          success: false,
          error: 'Ticket not found',
        });
        return;
      }

      if (!isReleaseTicket(ticket.ticketType as BaseTicketType)) {
        res.status(400).json({
          success: false,
          error: 'Ticket is not a release ticket',
        });
        return;
      }

      const xyneReleaseBot = await unifiedBotUserService.getBotByBotId('xyne-release-bot');
      if (!xyneReleaseBot) {
        res.status(400).json({
          success: false,
          error: 'Xyne Release bot not found',
        });
        return;
      }

      // Set generating status to true
      await this.ticketRepository.updateTicketMetadata(ticketId, {
        isGeneratingReleaseNotes: true,
      });

      const context = await this.releaseNotesService.gatherReleaseData(ticketId);

      if (context.prs.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No pull requests found for this release ticket',
        });
        return;
      }

      const markdownContent = await this.releaseNotesService.generateReleaseNotesMarkdown(context);
      if (!markdownContent) {
        res.status(400).json({
          success: false,
          error: 'Could not able to generate release notes',
        });
        return;
      }

      const canvasViewAccessId = await this.createReleaseNotesCanvas(
        markdownContent,
        context,
        ticketId,
        xyneReleaseBot
      );

      if (!canvasViewAccessId) {
        res.status(500).json({
          success: false,
          error: 'Failed to create release notes canvas',
        });
        return;
      }

      const canvasUrl = `${config.slackFrontendUrl}/chat/canvas/${canvasViewAccessId}`;

      await this.ticketRepository.updateTicketMetadata(ticketId, {
        releaseNotesCanvasUrl: canvasUrl,
        releaseNotesGeneratedAt: new Date().toISOString(),
        isGeneratingReleaseNotes: false,
      });

      if (ticket.conversationId) {
        const messageContent = `**📝 Release Notes Generated**

Release notes have been generated for **${ticket.title}**

[View Release Notes →](${canvasUrl})`;

        await conversationService.addMessageToConversation({
          conversationId: ticket.conversationId,
          userId: xyneReleaseBot.id,
          content: messageContent,
          msgType: 'SYSTEM',
          metadata: {
            messageSubtype: 'release_notes_generated',
            canvasUrl,
            releaseTicketId: ticket.id,
            releaseTicketXyneId: ticket.xyneId,
            contentFormat: 'markdown'
          },
        });

        logger.info(`[ReleaseNotesController] Posted release notes message to conversation ${ticket.conversationId}`);
      }

      res.status(200).json({
        success: true,
        data: {
          canvasUrl,
          markdownContent,
        },
      });
    } catch (error) {
      logger.error('[ReleaseNotesController] Error generating release notes:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate release notes',
      });
    } finally {
      const { ticketId } = req.params;
      await this.ticketRepository.updateTicketMetadata(ticketId, {
        isGeneratingReleaseNotes: false,
      });
    }
  };

  private async createReleaseNotesCanvas(
    markdown: string,
    context: ReleaseContext,
    ticketId: string,
    botUser: { id: string; email: string; workspaceId: string | null; role: string | null }
  ): Promise<string | null> {
    try {
      const now = new Date();
      const canvasId = uuidv4();
      const viewAccessId = uuidv4();
      const participantId = uuidv4();

      const dateStr = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const finalTitle = `📝 Release Notes: ${context.release.title} - ${dateStr}`;

      const blocks = this.buildReleaseNotesBlocks(markdown, context);

      await prisma.canvas.create({
        data: {
          id: canvasId,
          title: finalTitle,
          content: blocks as any,
          createdBy: botUser.id,
          viewAccessId,
          editAccessId: null,
          visibility: 'PUBLIC',
          isTemplate: false,
          isCollaborative: false,
          lastEditedBy: botUser.id,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          channelId: context.release.channelId || null,
          metadata: {
            source: 'release_notes',
            releaseTicketId: ticketId,
            releaseTicketXyneId: context.release.xyneId,
            generatedAt: now.toISOString(),
            ...(context.release.conversationId && { conversationId: context.release.conversationId }),
          },
        },
      });

      await prisma.canvasParticipant.create({
        data: {
          id: participantId,
          canvasId,
          userId: botUser.id,
          role: 'VIEWER',
          joinedAt: now,
          updatedAt: now,
        },
      });

      logger.info(`[CanvasService] Created release notes canvas ${canvasId} for ticket ${context.release.xyneId}`);

      // Email is globally unique in orgMember, single lookup is sufficient
      const orgMember = await db.orgMember.findUnique({
        where: { email: botUser.email },
      });
      if (!orgMember) {
        throw new Error(`Bot ${botUser.id} is not a member of any organization`);
      }

      const canvasHandler = new CanvasSideEffectHandler({
        userID: botUser.id,
        workspaceId: botUser.workspaceId!,
        role: botUser.role ?? 'MEMBER',
        memberId: orgMember.memberId,
        orgRole: orgMember.role,
      });
      canvasHandler.onInsert({
        entityId: canvasId,
        entityType: 'canvases',
        operation: 'insert'
      }).catch(err => logger.error('[CanvasService] Canvas side-effect handler error:', err));

      return viewAccessId;
    } catch (error) {
      logger.error('[CanvasService] Failed to create release notes canvas:', error);
      return null;
    }
  }

  private buildReleaseNotesBlocks(markdown: string, context: ReleaseContext): BlockNoteBlock[] {
    const blocks: BlockNoteBlock[] = [];

    const prMap = new Map<number, PRData>();
    const ticketToPrMap = new Map<string, PRData>();

    for (const pr of context.prs) {
      prMap.set(pr.prId, pr);
      const ticketMatch = pr.title.match(/(XYNE-\d+)/);
      if (ticketMatch) {
        ticketToPrMap.set(ticketMatch[1], pr);
      }
    }

    const lines = markdown.split('\n');
    let currentItem: { title: string; description: string; prId?: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('## ')) {
        if (blocks.length > 0) {
          blocks.push({
            id: uuidv4(),
            type: 'divider',
            content: undefined,
          });
        }

        const categoryName = trimmedLine.replace('## ', '');
        blocks.push({
          id: uuidv4(),
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'text', text: categoryName, styles: {} }],
        });
        currentItem = null;
        continue;
      }

      if (trimmedLine.startsWith('### ')) {
        if (blocks.length > 0) {
          const lastBlock = blocks[blocks.length - 1];
          const isAfterCategoryHeading = lastBlock.type === 'heading' && lastBlock.props?.level === 2;
          if (!isAfterCategoryHeading) {
            blocks.push({
              id: uuidv4(),
              type: 'paragraph',
              content: [],
            });
          }
        }

        currentItem = { title: trimmedLine.replace('### ', ''), description: '' };
        blocks.push({
          id: uuidv4(),
          type: 'heading',
          props: { level: 3 },
          content: [{ type: 'text', text: currentItem.title, styles: {} }],
        });
        continue;
      }

      if (trimmedLine.startsWith('Ticket:')) {
        const ticketMatch = trimmedLine.match(/Ticket:\s*([A-Z]+-\d+)/);
        const potMatch = trimmedLine.match(/POT:\s*Video/i);

        let prId: number | undefined;
        let pr: PRData | undefined
        if (ticketMatch) {
          const xyneId = ticketMatch[1];
          pr = ticketToPrMap.get(xyneId);
          if (pr) {
            prId = pr.prId;
          }
        }

        if (prId && currentItem) {
          currentItem.prId = prId;
        }

        const content: BlockNoteInlineContent[] = [];

        if (ticketMatch) {
          const xyneId = ticketMatch[1];
          const ticketUrl = `${config.slackFrontendUrl}/chat/${context.release.channelId}?tab=tickets&ticketId=${context.release.ticketId}&conversationId=${context.release.conversationId}`;
          content.push(
            { type: 'text', text: 'Ticket: ', styles: { bold: true } },
            { type: 'link', href: ticketUrl, content: [{ type: 'text', text: xyneId, styles: {} }] }
          );
        }

        if (potMatch && currentItem?.prId) {
          pr = prMap.get(currentItem.prId);
          if (pr && pr.potVideoLink) {
            if (content.length > 0) {
              content.push({ type: 'text', text: ' | ', styles: {} });
            }
            content.push(
              { type: 'link', href: pr.potVideoLink, content: [{ type: 'text', text: 'Video', styles: { bold: true } }] }
            );
          }
        }

        if (content.length > 0) {
          blocks.push({
            id: uuidv4(),
            type: 'paragraph',
            content,
          });
        }
        continue;
      }


      if (trimmedLine && !trimmedLine.startsWith('---')) {
        const content = this.parseMarkdownInline(trimmedLine);
        blocks.push({
          id: uuidv4(),
          type: 'paragraph',
          content,
        });
      }
    }

    return blocks;
  }

  private parseMarkdownInline(text: string): BlockNoteInlineContent[] {
    const content: BlockNoteInlineContent[] = [];

    // Pattern to match **bold** and *italic*
    const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        content.push({
          type: 'text',
          text: text.slice(lastIndex, match.index),
          styles: {},
        });
      }

      // Add the styled text
      if (match[1]) {
        // **bold**
        content.push({
          type: 'text',
          text: match[2],
          styles: { bold: true },
        });
      } else if (match[3]) {
        // *italic*
        content.push({
          type: 'text',
          text: match[4],
          styles: { italic: true },
        });
      }

      lastIndex = pattern.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      content.push({
        type: 'text',
        text: text.slice(lastIndex),
        styles: {},
      });
    }

    return content.length > 0 ? content : [{ type: 'text', text, styles: {} }];
  }
}
