/**
 * Context Fetcher Utilities
 *
 * Fetches canvas, ticket, and call content for direct injection into agent context.
 * Uses existing aiContextService where possible and adds formatting/content fetching on top.
 */

import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { convertBlockNoteToMarkdown } from '../../../services/canvasService.js';
import { readFromYSweet } from '../../../utils/ysweetUtils.js';
import { aiContextService } from '../../../services/aiContextService.js';
import { canvasAuthService } from '../../../services/canvasAuthService.js';
import type { Canvas, Call } from '@prisma/client';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Individual context item with ID and content
 */
export interface ProvidedContextItem {
  id: string;
  content: string;
  title?: string;       // human-readable title (canvas title, ticket title, call title)
  xyneId?: string;      // ticket xyne-id (e.g. XYNE-123)
  channelId?: string;
  conversationId?: string;
  callType?: string;    // for calls: used to identify recordings (HEADLESS)
  externalId?: string; // for calls: externalId used in /recordings/:externalId URL
}

/**
 * Provided contexts with IDs for citation mapping
 */
export interface ProvidedContexts {
  canvases: ProvidedContextItem[];
  tickets: ProvidedContextItem[];
  calls: ProvidedContextItem[];
}

// ============================================================================
// Authorization Checks
// ============================================================================

/**
 * Check if user has access to a canvas
 */
async function checkCanvasAccess(canvasId: string, userId: string): Promise<boolean> {
  const auth = await canvasAuthService.checkCanvasAccess(canvasId, userId);
  return auth.hasAccess;
}

/**
 * Check if user has access to a ticket
 * User has access if they are a participant in the ticket's channel
 */
async function checkTicketAccess(ticketId: string, userId: string): Promise<boolean> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      channelId: true,
      assignedTo: true,
      createdBy: true,
    },
  });

  if (!ticket) {
    return false;
  }

  // Creator or assignee always has access
  if (ticket.createdBy === userId || ticket.assignedTo === userId) {
    return true;
  }

  // Check if user is a participant in the ticket's channel
  const channelParticipant = await db.channelParticipant.findUnique({
    where: {
      channelId_userId: {
        channelId: ticket.channelId,
        userId,
      },
    },
  });

  return !!channelParticipant;
}

/**
 * Check if user has access to a call
 * User has access if they are a participant in the call
 */
async function checkCallAccess(callId: string, userId: string): Promise<boolean> {
  const participant = await db.callParticipant.findUnique({
    where: {
      callId_userId: {
        callId,
        userId,
      },
    },
  });

  return !!participant;
}

// ============================================================================
// Canvas Fetcher
// ============================================================================

/**
 * Fetch canvas content by ID and convert to markdown
 * IMPORTANT: Checks authorization before fetching
 *
 * Content Source Strategy:
 * - Collaborative canvases (isCollaborative=true): Fetch from Y-Sweet (real-time source), fallback to DB
 * - Non-collaborative canvases (isCollaborative=false): Fetch from DB directly (no Y-Sweet needed)
 */
async function fetchCanvasContent(canvasId: string, userId: string): Promise<ProvidedContextItem | null> {
  try {
    // Use existing service to fetch canvas metadata
    const canvas = await aiContextService.getById<Canvas>('Canvas', canvasId);

    if (!canvas) {
      logger.warn(`[ContextFetcher] Canvas not found: ${canvasId}`);
      return null;
    }

    // Authorization check: Verify user has access to this canvas
    const hasAccess = await checkCanvasAccess(canvasId, userId);
    if (!hasAccess) {
      logger.warn(`[ContextFetcher] User ${userId} denied access to canvas ${canvasId}`);
      return null;
    }

    // Get creator info
    const creator = await db.user.findUnique({
      where: { id: canvas.createdBy },
      select: { name: true, email: true },
    });

    // Format canvas metadata
    const creatorName = creator?.name || creator?.email || 'Unknown User';
    const formattedDate = canvas.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Fetch content based on isCollaborative flag
    let markdownContent = '';
    let contentStatus = 'FULL_CONTENT';

    if (canvas.isCollaborative) {
      // Collaborative canvas: Try Y-Sweet first (real-time source of truth), fallback to DB
      let ysweetSuccess = false;
      try {
        const blocks = await readFromYSweet(canvas.id);

        if (blocks && blocks.length > 0) {
          markdownContent = await convertBlockNoteToMarkdown(blocks);
          ysweetSuccess = true;
          logger.info(`[ContextFetcher] Canvas ${canvasId} - Fetched from Y-Sweet (collaborative)`);
        } else {
          logger.warn(`[ContextFetcher] Canvas ${canvasId} - No content blocks in Y-Sweet, trying DB fallback`);
        }
      } catch (ysweetError) {
        logger.warn(`[ContextFetcher] Canvas ${canvasId} - Y-Sweet failed, trying DB fallback:`, ysweetError);
      }

      // Fallback to DB content if Y-Sweet didn't return content
      if (!ysweetSuccess) {
        if (canvas.content && Array.isArray(canvas.content) && canvas.content.length > 0) {
          markdownContent = await convertBlockNoteToMarkdown(canvas.content as any);
          contentStatus = 'DB_FALLBACK';
          logger.info(`[ContextFetcher] Canvas ${canvasId} - Using DB fallback content`);
        } else {
          contentStatus = 'CONTENT_UNAVAILABLE';
          markdownContent = '⚠️ CONTENT UNAVAILABLE - No content found in Y-Sweet or database.';
          logger.warn(`[ContextFetcher] Canvas ${canvasId} - No content in Y-Sweet or DB`);
        }
      }
    } else {
      // Non-collaborative canvas: Use DB content directly (no Y-Sweet needed)
      if (canvas.content && Array.isArray(canvas.content) && canvas.content.length > 0) {
        markdownContent = await convertBlockNoteToMarkdown(canvas.content as any);
        logger.info(`[ContextFetcher] Canvas ${canvasId} - Fetched from DB (non-collaborative)`);
      } else {
        contentStatus = 'EMPTY';
        markdownContent = '⚠️ CONTENT UNAVAILABLE - Canvas is empty.';
        logger.warn(`[ContextFetcher] Canvas ${canvasId} - No content in DB`);
      }
    }

    const content = `Canvas: ${canvas.title}
Created by: ${creatorName}
Created at: ${formattedDate}
Content Status: ${contentStatus}

${markdownContent}`;

    return { id: canvasId, content, title: canvas.title };
  } catch (error) {
    // Canvas not found in database or other fatal error
    logger.error(`[ContextFetcher] Error fetching canvas ${canvasId}:`, error);
    return null;
  }
}

/**
 * Fetch multiple canvases in parallel
 */
export async function fetchCanvases(canvasIds: string[], userId: string): Promise<ProvidedContextItem[]> {
  if (!canvasIds || canvasIds.length === 0) {
    return [];
  }

  logger.info(`[ContextFetcher] Fetching ${canvasIds.length} canvases for user ${userId}`);

  const results = await Promise.all(
    canvasIds.map(id => fetchCanvasContent(id, userId))
  );

  return results.filter((item): item is ProvidedContextItem => item !== null);
}

// ============================================================================
// Ticket Fetcher
// ============================================================================

/**
 * Fetch ticket content by ID with all relevant details including subtickets
 * Extends aiContextService with relations
 * IMPORTANT: Checks authorization before fetching
 */
async function fetchTicketContent(ticketId: string, userId: string): Promise<ProvidedContextItem | null> {
  try {
    // Authorization check: Verify user has access to this ticket
    const hasAccess = await checkTicketAccess(ticketId, userId);
    if (!hasAccess) {
      logger.warn(`[ContextFetcher] User ${userId} denied access to ticket ${ticketId}`);
      return null;
    }

    // Fetch ticket with basic relations (not project/board which might have orphan references)
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        createdByUser: {
          select: { name: true, email: true },
        },
        assignedToUser: {
          select: { name: true, email: true },
        },
        tags: {
          select: { name: true },
        },
        subTicketMappings: {
          select: {
            subTicket: {
              select: {
                id: true,
                title: true,
                description: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      logger.warn(`[ContextFetcher] Ticket not found: ${ticketId}`);
      return null;
    }

    // Fetch project and board names separately to avoid orphan reference errors
    let projectName = 'Unknown Project';
    let boardName = 'Unknown Board';
    
    try {
      const [project, board] = await Promise.all([
        ticket.projectId ? db.project.findUnique({ where: { id: ticket.projectId }, select: { name: true } }) : null,
        ticket.boardId ? db.board.findUnique({ where: { id: ticket.boardId }, select: { name: true } }) : null,
      ]);
      projectName = project?.name || 'Unknown Project';
      boardName = board?.name || 'Unknown Board';
    } catch (e) {
      logger.warn(`[ContextFetcher] Failed to fetch project/board for ticket ${ticketId}:`, e);
    }

    // Format ticket content
    const creatorName = ticket.createdByUser?.name || ticket.createdByUser?.email || 'Unknown';
    const assigneeName = ticket.assignedToUser?.name || ticket.assignedToUser?.email || 'Unassigned';
    const createdDate = ticket.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const updatedDate = ticket.updatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const etaDate = ticket.eta ? ticket.eta.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not set';
    const tags = ticket.tags.map(t => t.name).join(', ') || 'None';

    let content = `Ticket: ${ticket.xyneId} - ${ticket.title}
Project: ${projectName}
Board: ${boardName}
Stage: ${ticket.stageName || 'Not set'}
Status: ${ticket.statusV2}
Priority: ${ticket.priority}
Created by: ${creatorName}
Assigned to: ${assigneeName}
Created at: ${createdDate}
Updated at: ${updatedDate}
ETA: ${etaDate}
Tags: ${tags}

Description:
${ticket.description || 'No description'}`;

    // Add subtickets if any
    if (ticket.subTicketMappings.length > 0) {
      content += '\n\nSubtickets:';
      ticket.subTicketMappings.forEach((mapping, idx) => {
        const subticket = mapping.subTicket;
        const desc = subticket.description ? ` - ${subticket.description}` : '';
        content += `\n  ${idx + 1}. ${subticket.title}${desc}`;
      });
    }

    return {
      id: ticketId,
      content,
      title: ticket.title,
      xyneId: ticket.xyneId,
      channelId: ticket.channelId,
      conversationId: ticket.conversationId || undefined,
    };
  } catch (error) {
    logger.error(`[ContextFetcher] Error fetching ticket ${ticketId}:`, error);
    return null;
  }
}

/**
 * Fetch multiple tickets in parallel
 */
export async function fetchTickets(ticketIds: string[], userId: string): Promise<ProvidedContextItem[]> {
  if (!ticketIds || ticketIds.length === 0) {
    return [];
  }

  logger.info(`[ContextFetcher] Fetching ${ticketIds.length} tickets for user ${userId}`);

  const results = await Promise.all(
    ticketIds.map(id => fetchTicketContent(id, userId))
  );

  return results.filter((item): item is ProvidedContextItem => item !== null);
}

// ============================================================================
// Call Fetcher
// ============================================================================

/**
 * Fetch call transcript by ID with metadata
 * Uses aiContextService.getById and adds formatting
 * IMPORTANT: Checks authorization before fetching
 */
async function fetchCallContent(callId: string, userId: string): Promise<ProvidedContextItem | null> {
  try {
    // Authorization check: Verify user has access to this call
    const hasAccess = await checkCallAccess(callId, userId);
    if (!hasAccess) {
      logger.warn(`[ContextFetcher] User ${userId} denied access to call ${callId}`);
      return null;
    }

    // Use existing service to fetch call (returns EnrichedCall)
    const call = await aiContextService.getById<Call>('Call', callId);

    if (!call) {
      logger.warn(`[ContextFetcher] Call not found: ${callId}`);
      return null;
    }

    // Fetch participants and their user data in parallel
    // Note: CallParticipant has no FK to User, so we need two queries
    const [participantsData, duration] = await Promise.all([
      db.callParticipant.findMany({
        where: { callId: call.id },
        select: {
          userId: true,
          joinedAt: true,
          leftAt: true,
        },
        orderBy: { joinedAt: 'asc' },
      }),
      // Calculate duration in parallel
      Promise.resolve(
        call.endedAt && call.startedAt
          ? `${Math.floor((call.endedAt.getTime() - call.startedAt.getTime()) / 60000)} minutes`
          : 'Ongoing'
      ),
    ]);

    // Fetch all user names in one query
    const userIds = participantsData.map(p => p.userId);
    const users = userIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));

    const startedDate = call.startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endedDate = call.endedAt
      ? call.endedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : 'Ongoing';

    // Format participants
    const participantList = participantsData
      .map(p => {
        const user = userMap.get(p.userId);
        const userName = user?.name || user?.email || 'Unknown User';
        const joinTime = p.joinedAt ? p.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
        const leftTime = p.leftAt
          ? p.leftAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
          : 'Still in call';
        return `  - ${userName} (joined: ${joinTime}, left: ${leftTime})`;
      })
      .join('\n');

    let content = `Call: ${call.title || 'Untitled Call'}
External ID: ${call.externalId}
Type: ${call.callType}
Status: ${call.status}
Duration: ${duration}
Started at: ${startedDate}
Ended at: ${endedDate}
Recording: ${call.recordingEnabled ? 'Enabled' : 'Disabled'}

Participants:
${participantList || '  No participants'}`;

    if (call.description) {
      content += `\n\nDescription:\n${call.description}`;
    }

    if (call.aiSummary) {
      content += `\n\nAI Summary:\n${call.aiSummary}`;
    }

    if (call.transcript) {
      content += `\n\nTranscript:\n${call.transcript}`;
    } else {
      content += '\n\nTranscript: Not available';
    }

    // Extract conversationId from call metadata (same pattern as aiContextService)
    let conversationId: string | undefined;
    if (call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)) {
      const metadata = call.metadata as Record<string, unknown>;
      if (typeof metadata.conversationId === 'string') {
        conversationId = metadata.conversationId;
      }
    }

    return {
      id: callId,
      content,
      title: call.title || 'Untitled Call',
      channelId: call.channelId ?? undefined,
      conversationId,
      callType: call.callType,
      externalId: call.externalId,
    };
  } catch (error) {
    logger.error(`[ContextFetcher] Error fetching call ${callId}:`, error);
    return null;
  }
}

/**
 * Fetch multiple calls in parallel
 */
export async function fetchCalls(callIds: string[], userId: string): Promise<ProvidedContextItem[]> {
  if (!callIds || callIds.length === 0) {
    return [];
  }

  logger.info(`[ContextFetcher] Fetching ${callIds.length} calls for user ${userId}`);

  const results = await Promise.all(
    callIds.map(id => fetchCallContent(id, userId))
  );

  return results.filter((item): item is ProvidedContextItem => item !== null);
}

// ============================================================================
// Main Fetcher
// ============================================================================

/**
 * Fetch all provided contexts (canvases, tickets, calls) in parallel
 * IMPORTANT: Performs authorization checks for each entity
 */
export async function fetchProvidedContexts(
  userId: string,
  canvasIds?: string[],
  ticketIds?: string[],
  callIds?: string[]
): Promise<ProvidedContexts> {
  const [canvases, tickets, calls] = await Promise.all([
    fetchCanvases(canvasIds || [], userId),
    fetchTickets(ticketIds || [], userId),
    fetchCalls(callIds || [], userId),
  ]);

  logger.info(`[ContextFetcher] Fetched contexts for user ${userId} - Canvases: ${canvases.length}, Tickets: ${tickets.length}, Calls: ${calls.length}`);

  return { canvases, tickets, calls };
}