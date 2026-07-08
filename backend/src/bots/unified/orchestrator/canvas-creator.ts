/**
 * Canvas creation handler for bot responses
 * Automatically creates canvases for Genius bot responses
 */

import { v4 as uuidv4 } from 'uuid';
import { getCanvasUrl } from '@/services/canvasService';
import { DatabaseClient } from '@/database/client';
import type { BotEvent } from '../types/index.js';
import {logger} from '@/utils/logger';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';


const prisma = DatabaseClient.getInstance();

/**
 * List of bot IDs that support canvas creation
 */
export const CANVAS_ENABLED_BOTS = ['genius', 'genius_deep_rca'];

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '');
}

interface CanvasCreationParams {
    botId: string;
    userId: string;
    channelId: string;
    conversationId: string;
    query: string;
    isFromCanvas?: boolean; // Whether the query originated from a canvas genius block
}

interface CreateCanvasResult {
    canvasId: string;
    viewAccessId: string;
    canvasUrl: string;
}

/**
 * Create a canvas with a Genius block containing the query
 * This is called BEFORE bot execution for DM queries
 */
export async function createCanvasWithGeniusBlock(
    params: Omit<CanvasCreationParams, 'isFromCanvas'>
): Promise<CreateCanvasResult> {
    const { botId, userId, channelId, conversationId, query } = params;
    
    const canvasId = uuidv4();
    const viewAccessId = uuidv4();
    const participantId = uuidv4();
    const now = new Date();

    // Strip HTML tags from query for cleaner display
    const cleanQuery = stripHtmlTags(query);

    // Generate bot name for title (capitalize and replace underscores)
    const botName = botId
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Build canvas content with Genius block containing the query (loading state)
    const canvasContent: any[] = [
        {
            id: uuidv4(),
            type: 'genius',
            props: {
                query: cleanQuery,
                content: '',
                isLoading: true,
                title: `${botName} Response`,
                data: '[]', // Store tool outputs as JSON string in 'data' field
            },
        },
    ];

    // Create canvas and participant
    await prisma.$transaction([
        prisma.canvas.create({
            data: {
                id: canvasId,
                title: `${botName}: ${cleanQuery.slice(0, 50)}${cleanQuery.length > 50 ? '...' : ''}`,
                content: canvasContent as any,
                channelId,
                createdBy: userId,
                viewAccessId,
                editAccessId: null,
                visibility: 'PRIVATE',
                isTemplate: false,
                lastEditedBy: userId,
                lastEditedAt: now,
                createdAt: now,
                updatedAt: now,
                metadata: {
                    source: 'genius_dm_response',
                    conversationId,
                    botId,
                    createdAt: now.toISOString(),
                },
            },
        }),
        prisma.canvasParticipant.create({
            data: {
                id: participantId,
                canvasId,
                userId,
                role: 'OWNER',
                joinedAt: now,
                updatedAt: now,
            },
        }),
    ]);

    let workspaceId: string | undefined;
    try {
        const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } });
        workspaceId = channel?.workspaceId;
    } catch (workspaceError) {
        logger.error(`[CanvasCreator] Failed to resolve workspace for channel ${channelId}:`, workspaceError);
    }

    const canvasUrl = getCanvasUrl(viewAccessId, workspaceId);
    
    logger.info(`[CanvasCreator] Created canvas ${canvasId} with Genius block for ${botId} query`);
    
    // Queue Vespa indexing for the canvas
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId,
        app: SubApp.CANVAS,
        ...(workspaceId ? { workspaceId } : {}),
      });
      logger.info(`[CanvasCreator] Queued Vespa indexing for canvas ${canvasId}`);
    } catch (vespaError) {
      logger.error(`[CanvasCreator] Failed to queue Vespa job for canvas ${canvasId}:`, vespaError);
    }
    
    return { canvasId, viewAccessId, canvasUrl };
}

/**
 * Update a canvas's Genius block with the response and tool outputs
 */
async function updateCanvasWithResponse(
    canvasId: string,
    response: string,
    isComplete: boolean,
    toolOutputs: any[] = []
): Promise<void> {
    const canvas = await prisma.canvas.findUnique({
        where: { id: canvasId },
    });

    if (!canvas) {
        logger.error(`[CanvasCreator] Canvas ${canvasId} not found for update`);
        return;
    }

    const content = canvas.content as any[];
    const geniusBlock = content.find((block: any) => block.type === 'genius');

    if (geniusBlock) {
        geniusBlock.props.content = response;
        geniusBlock.props.isLoading = !isComplete;
        geniusBlock.props.data = JSON.stringify(toolOutputs); // Store tool outputs as JSON string
        
        await prisma.canvas.update({
            where: { id: canvasId },
            data: {
                content: content as any,
                updatedAt: new Date(),
            },
        });
    }
}

/**
 * Process bot response stream and update/create canvas
 * This is called for ALL bot responses, but only creates canvas for Genius bot
 * 
 * New Workflow:
 * 1. If query from DM: Canvas already created, update with response → Share link
 * 2. If query from canvas: Show text response inline (no canvas unless >10000 chars)
 * 3. If text response > 10000 chars: Create canvas regardless of source
 */
export async function processStreamAndCreateCanvas(
    stream: AsyncGenerator<BotEvent>,
    params: CanvasCreationParams & { canvasId?: string; canvasUrl?: string }
): Promise<AsyncGenerator<BotEvent>> {
    const { botId, userId, channelId, conversationId, query, isFromCanvas, canvasId, canvasUrl } = params;

    // Only create canvas for canvas-enabled bots
    if (!CANVAS_ENABLED_BOTS.includes(botId)) {
        return stream;
    }

    // Wrap the stream to collect response data and handle canvas creation
    async function* wrappedStream() {
        let fullResponse = '';
        const collectedToolOutputs: any[] = [];
        const createdCanvasId = canvasId;
        const createdCanvasUrl = canvasUrl;

        // Collect data and optionally suppress based on source
        for await (const event of stream) {
            // Collect content
            if (event.type === 'content' && event.content) {
                fullResponse += event.content;
                
                // If we have a canvas (from DM), update it in real-time
                if (createdCanvasId && !isFromCanvas) {
                    await updateCanvasWithResponse(createdCanvasId, fullResponse, false, collectedToolOutputs);
                }
            }

            // Collect tool outputs
            if (event.type === 'tool_output' && event.toolOutput) {
                collectedToolOutputs.push(event.toolOutput);
            }

            // If from canvas, yield all events normally
            // If from DM, suppress content/tool_output events (will be in canvas)
            if (isFromCanvas) {
                yield event;
            } else if (event.type !== 'content' && event.type !== 'tool_output') {
                // From DM: only pass through non-content events
                yield event;
            }
        }

        // Determine if canvas should be created
        const shouldCreateCanvas = !isFromCanvas || fullResponse.length > 10000;

        // After stream completes, finalize canvas if needed
        if (fullResponse && shouldCreateCanvas) {
            try {
                // Finalize canvas update (set isLoading to false)
                if (createdCanvasId && !isFromCanvas) {
                    await updateCanvasWithResponse(createdCanvasId, fullResponse, true, collectedToolOutputs);
                    
                    // Yield canvas link after response is complete
                    yield {
                        type: 'content',
                        content: `📄 Canvas created: ${createdCanvasUrl}`,
                        fullContent: `📄 Canvas created: ${createdCanvasUrl}`,
                    } as BotEvent;
                    
                    logger.info(`[CanvasCreator] Updated canvas ${createdCanvasId} with response (length: ${fullResponse.length})`);
                    return;
                }

                // From canvas with long response: create new canvas
                const newCanvasId = uuidv4();
                const newViewAccessId = uuidv4();
                const newParticipantId = uuidv4();
                const now = new Date();

                // Strip HTML tags from query for cleaner display
                const cleanQuery = stripHtmlTags(query);

                // Generate bot name for title
                const botName = botId
                    .split('_')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');

                // Build canvas content with Genius block
                const canvasContent: any[] = [
                    {
                        id: uuidv4(),
                        type: 'genius',
                        props: {
                            query: cleanQuery,
                            content: fullResponse,
                            isLoading: false,
                            title: `${botName} Response`,
                            data: JSON.stringify(collectedToolOutputs), // Store tool outputs as JSON string
                        },
                    },
                ];

                // Create canvas and participant
                await prisma.$transaction([
                    prisma.canvas.create({
                        data: {
                            id: newCanvasId,
                            title: `${botName}: ${cleanQuery.slice(0, 50)}${cleanQuery.length > 50 ? '...' : ''}`,
                            content: canvasContent as any,
                            channelId,
                            createdBy: userId,
                            viewAccessId: newViewAccessId,
                            editAccessId: null,
                            visibility: 'PRIVATE',
                            isTemplate: false,
                            lastEditedBy: userId,
                            lastEditedAt: now,
                            createdAt: now,
                            updatedAt: now,
                            metadata: {
                                source: 'genius_canvas_long_response',
                                conversationId,
                                botId,
                                createdAt: now.toISOString(),
                            },
                        },
                    }),
                    prisma.canvasParticipant.create({
                        data: {
                            id: newParticipantId,
                            canvasId: newCanvasId,
                            userId,
                            role: 'OWNER',
                            joinedAt: now,
                            updatedAt: now,
                        },
                    }),
                ]);

                let workspaceId: string | undefined;
                try {
                    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true } });
                    workspaceId = channel?.workspaceId;
                } catch (workspaceError) {
                    logger.error(`[CanvasCreator] Failed to resolve workspace for channel ${channelId}:`, workspaceError);
                }

                const newCanvasUrl = getCanvasUrl(newViewAccessId, workspaceId);

                // Truncate content for message persistence
                const maxDbContentLength = 9990;
                const truncatedContent = fullResponse.length > maxDbContentLength
                    ? fullResponse.slice(0, maxDbContentLength) + '...'
                    : fullResponse;
                
                yield {
                    type: 'content',
                    content: `\n\n📄 Full response saved to canvas: ${newCanvasUrl}`,
                    fullContent: truncatedContent + `\n\n📄 Full response saved to canvas: ${newCanvasUrl}`,
                } as BotEvent;

                logger.info(`[CanvasCreator] Created canvas ${newCanvasId} for long response (length: ${fullResponse.length})`);

                // Queue Vespa indexing for the canvas
                try {
                  await vespaQueue.addJob({
                    schema: fileSchema,
                    docId: newCanvasId,
                    jobType: 'feed',
                    userId,
                    app: SubApp.CANVAS,
                    ...(workspaceId ? { workspaceId } : {}),
                  });
                  logger.info(`[CanvasCreator] Queued Vespa indexing for long response canvas ${newCanvasId}`);
                } catch (vespaError) {
                  logger.error(`[CanvasCreator] Failed to queue Vespa job for long response canvas ${newCanvasId}:`, vespaError);
                }
            } catch (error) {
                logger.error('[CanvasCreator] Failed to create/update canvas:', error);
                // If canvas update fails and from DM, yield the response as fallback
                if (!isFromCanvas && !createdCanvasId) {
                    yield {
                        type: 'content',
                        content: fullResponse,
                        fullContent: fullResponse,
                    } as BotEvent;
                }
            }
        }
    }

    return wrappedStream();
}
