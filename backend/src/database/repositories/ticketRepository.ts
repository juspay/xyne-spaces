import { TicketStatusV2, TicketPriority, Prisma, ActivityType, PRStatusEvent, PrismaClient } from '@prisma/client';
import { CreateTicketRequest, ActivitySource } from '../../types/ticket';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { BaseTicketType, PRActivityValue } from '@xyne/shared';
//import { queueTicketIngestion } from '@/queues/vespaQueue';

const prisma = DatabaseClient.getInstance();

// Type for Prisma transaction client
type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export class TicketRepository {

  /**
   * Create a ticket (repository method - database access only)
   * NOTE: For creating tickets with conversations, use TicketService.createTicketWithConversation()
   * This method expects conversationId and xyneId to be provided
   * @param data - Ticket data
   * @param tx - Optional transaction client for atomic operations
   */
  async createTicket(data: CreateTicketRequest & { xyneId: string }, tx?: PrismaTransaction) {
    const db = tx || prisma; // Use transaction if provided, else default prisma

    // Validate required fields
    if (!data.conversationId) {
      throw new Error('conversationId is required');
    }

    if (!data.xyneId) {
      throw new Error('xyneId is required');
    }

    if (!data.boardId) {
      throw new Error('boardId is required');
    }

    if (!data.channelId) {
      throw new Error('channelId is required');
    }

    // Fetch all stages of the board
    const stages = await db.stage.findMany({
      where: {
        boardId: data.boardId
      },
      orderBy: {
        sequenceNumber: 'asc'
      }
    });

    if (!stages || stages.length === 0) {
      throw new Error(`No stages found for board ${data.boardId}. Board must have at least one stage.`);
    }

    // Get the stage - use provided stageName if it exists in stages, otherwise use first stage
    let selectedStage = stages[0]; // Default to first stage

    if (data.stageName) {
      const foundStage = stages.find(stage => stage.name === data.stageName);
      if (foundStage) {
        selectedStage = foundStage;
      }
    }

    // Calculate total ETA by summing only stages with ETA (in hours)
    const totalEtaHours = stages.reduce((sum, stage) => sum + (stage.eta || 0), 0);

    // Calculate ETA deadline only if at least one stage has ETA
    const etaDeadline = totalEtaHours > 0 ? calculateETADeadline(new Date(), totalEtaHours) : null;

    // Upsert merchant if merchantId is provided
    if (data.merchantId) {
      await db.merchant.upsert({
        where: { mid: data.merchantId },
        update: {}, // No update needed if exists
        create: {
          mid: data.merchantId,
        }
      });
      logger.info(`[TicketRepository] Upserted merchant with mid: ${data.merchantId}`);
    }

    // Create ticket with the conversationId, auto-assigned stageName, and calculated ETA
    const ticket = await db.ticket.create({
      data: {
        title: data.title,
        description: data.description,
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
        assignedTo: data.assignedTo,
        conversationId: data.conversationId,
        channelId: data.channelId,
        xyneId: data.xyneId,
        projectId: data.projectId,
        userGroupId: data.userGroupId,
        boardId: data.boardId,
        stageName: selectedStage.name,
        statusV2: data.statusV2 || TicketStatusV2.TODO,
        priority: data.priority || TicketPriority.LOW,
        ...(etaDeadline && { eta: etaDeadline }),
        metadata: data.metadata as Prisma.InputJsonValue,
        closedAt: data.closedAt,
        closedBy: data.closedBy,
        merchantId: data.merchantId,
        ticketType: data.ticketType,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }
    });

    const stageEnteredAt = new Date();
    // Only create TicketStageEta entry if the selected stage has ETA
    if (selectedStage.eta !== null && selectedStage.eta > 0) {
      const stageEtaDeadline = calculateETADeadline(stageEnteredAt, selectedStage.eta);
      await db.ticketStageEta.create({
        data: {
          ticketId: ticket.id,
          stageId: selectedStage.id,
          stageEnteredAt: stageEnteredAt,
          stageLeftAt: null,
          stageEta: stageEtaDeadline,
          updatedBy: data.createdBy,
        }
      });
    }

    const isHotFix = ticket.ticketType === BaseTicketType.Hotfix
    // If it's a hotfix, add 'hotfix' tag to the ticket
    if (isHotFix) {
      await db.ticketTag.create({
        data: {
          ticketId: ticket.id,
          name: 'hotfix'
        }
      })
      logger.info(`Hotfix tag added to ticket ${ticket.id}`);
    }
    // Track user activity using Redis Set - O(1) operation, no DB query
    websocketService.trackUserActivity(data.createdBy)
      .catch(err => logger.error('Failed to track user activity after ticket creation:', err));

    // Queue ticket for Vespa ingestion with complete data
    // try {
    //   // Run all independent database queries concurrently
    //   const [workflow, subTicketMapping, createdByUser, conversation] = await Promise.all([
    //     // Get workflow for this ticket
    //     prisma.workflow.findFirst({
    //       where: { ticketId: ticket.id },
    //       orderBy: { createdAt: 'desc' }
    //     }),
    //     // Check if this ticket is a sub-ticket to find its parent
    //     prisma.ticketSubTicketMapping.findFirst({
    //       where: { subTicketId: ticket.id }
    //     }),
    //     // Get createdBy user's email for ownerEmail and name for createdBy
    //     prisma.user.findUnique({
    //       where: { id: ticket.createdBy },
    //       select: { email: true, name: true }
    //     }),
    //     // Get conversation to fetch channelId for Vespa reference
    //     ticket.conversationId ? prisma.conversation.findUnique({
    //       where: { conversationId: ticket.conversationId },
    //       select: { channelId: true }
    //     }) : Promise.resolve(null)
    //   ]);

    //   const channelId = conversation?.channelId || '';

    //   const ticketWithAdditionalData = {
    //     ...ticket,
    //     createdBy: createdByUser?.email, // Send email instead of ID
    //     workflowType: workflow?.workflowType || 'default',
    //     parentTicketId: subTicketMapping?.ticketId || '',
    //     ownerEmail: createdByUser?.email || '',
    //     channelId, // Include channelId for Vespa channelRef
    //   };

    //   await queueTicketIngestion(ticketWithAdditionalData, 'feed');
    // } catch (error) {
    //   logger.error(`[VESPA-FLOW] Failed to queue ticket for Vespa: ${ticket.id}`, error);
    //   // Don't throw - ticket is still created in DB
    // }

    return ticket;
  }

  /**
   * Update ticket stage
   * @param ticketId - The ticket ID to update
   * @param newStageName - The new stage name
   * @param updatedBy - User ID who triggered the update
   * @param source - Source of the update (INTERNAL or WEBHOOK)
   * @param prActivityData - Optional PR activity data (only used when source is WEBHOOK)
   */
  async updateTicketStage(
    ticketId: string,
    newStageName: string,
    updatedBy: string,
    source: ActivitySource = ActivitySource.INTERNAL,
    prActivityData?: {
      prEvent: PRStatusEvent;
      prId: number;
      prUrl: string;
      repoName: string;
      sourceBranchName: string;
      destinationBranchName: string;
      prAuthor?: string;
      remainingOpenPRs?: number;
    }
  ) {

    // Get current ticket to capture old stage name, boardId, and statusV2
    const currentTicket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { stageName: true, boardId: true, statusV2: true, conversationId: true }
    });

    if (!currentTicket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const oldStageName = currentTicket.stageName;
    const oldStatusV2 = currentTicket.statusV2;
    const stageChanged = oldStageName !== newStageName;

    // Fetch current and target stages to determine movement direction
    const [currentStage, targetStage] = await Promise.all([
      prisma.stage.findFirst({
        where: { boardId: currentTicket.boardId, name: oldStageName },
        select: { id: true, sequenceNumber: true, defaultTicketStatusV2: true }
      }),
      prisma.stage.findFirst({
        where: { boardId: currentTicket.boardId, name: newStageName },
        select: { id: true, sequenceNumber: true, defaultTicketStatusV2: true, eta: true }
      })
    ]);

    if (!targetStage) {
      throw new Error(`Target stage "${newStageName}" not found in board ${currentTicket.boardId}`);
    }

    const isForwardMovement = !currentStage || targetStage.sequenceNumber > currentStage.sequenceNumber;
    const now = new Date();

    if (isForwardMovement) {
      // FORWARD MOVEMENT: Mark old stage as left, create/reactivate new stage entry

      // 1. Mark current stage as left (if exists)
      if (currentStage) {
        await prisma.ticketStageEta.updateMany({
          where: {
            ticketId: ticketId,
            stageId: currentStage.id,
            stageLeftAt: null // Only update active entry
          },
          data: {
            stageLeftAt: now,
            updatedAt: now,
            updatedBy: updatedBy
          }
        });
      }

      // 2. Check if target stage entry already exists (re-entry case)
      const existingEntry = await prisma.ticketStageEta.findFirst({
        where: {
          ticketId: ticketId,
          stageId: targetStage.id
        }
      });

      if (existingEntry) {
        // Re-entering a stage - reactivate it
        await prisma.ticketStageEta.update({
          where: { id: existingEntry.id },
          data: {
            stageEnteredAt: now, // Update entered time to now
            stageLeftAt: null, // Mark as active
            updatedAt: now,
            updatedBy: updatedBy
          }
        });
      } else {
        // First time entering this stage - create new entry only if stage has ETA
        if (targetStage.eta !== null && targetStage.eta > 0) {

          const stageEtaDeadline = calculateETADeadline(now, targetStage.eta);

          await prisma.ticketStageEta.create({
            data: {
              ticketId: ticketId,
              stageId: targetStage.id,
              stageEnteredAt: now,
              stageLeftAt: null,
              stageEta: stageEtaDeadline,
              updatedBy: updatedBy
            }
          });
        }
      }
    } else {
      // BACKWARD MOVEMENT: Delete all forward stage entries, reactivate target

      // 1. Get all stageIds with sequenceNumber > target
      const forwardStages = await prisma.stage.findMany({
        where: {
          boardId: currentTicket.boardId,
          sequenceNumber: { gt: targetStage.sequenceNumber }
        },
        select: { id: true }
      });

      const forwardStageIds = forwardStages.map(s => s.id);

      // 2. Delete all entries for those forward stages
      if (forwardStageIds.length > 0) {
        await prisma.ticketStageEta.deleteMany({
          where: {
            ticketId: ticketId,
            stageId: { in: forwardStageIds }
          }
        });

      }

      // 3. Reactivate target stage (set stageLeftAt to null)
      const targetEntry = await prisma.ticketStageEta.findFirst({
        where: {
          ticketId: ticketId,
          stageId: targetStage.id
        }
      });

      if (targetEntry) {
        // Entry exists - reactivate it
        await prisma.ticketStageEta.update({
          where: { id: targetEntry.id },
          data: {
            stageLeftAt: null,
            updatedAt: now,
            updatedBy: updatedBy
          }
        });
      } else {
        // Entry doesn't exist (edge case - create it)
        if (targetStage.eta !== null && targetStage.eta > 0) {
          const stageEtaDeadline = calculateETADeadline(now, targetStage.eta);
          await prisma.ticketStageEta.create({
            data: {
              ticketId: ticketId,
              stageId: targetStage.id,
              stageEnteredAt: now,
              stageLeftAt: null,
              stageEta: stageEtaDeadline,
              updatedBy: updatedBy
            }
          });
        }
      }
    }

    const newStatusV2 = targetStage?.defaultTicketStatusV2;
    const statusChanged = newStatusV2 && newStatusV2 !== oldStatusV2;

    // Update the ticket stage and status (synced with stage's default status)
    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        stageName: newStageName,
        ...(newStatusV2 && { statusV2: newStatusV2 }),
        updatedBy: updatedBy,
        updatedAt: new Date()
      }
    });

    // Create activity record for the stage change
    if (source === ActivitySource.WEBHOOK && prActivityData) {
      // For WEBHOOK source: Create PR activity with stage change info
      // Align stage change with base activity structure (field, oldValue, newValue)
      const activityValue: PRActivityValue = {
        action: this.getActionTextForPREvent(prActivityData.prEvent),
        prId: prActivityData.prId,
        prUrl: prActivityData.prUrl,
        repoName: prActivityData.repoName,
        sourceBranch: prActivityData.sourceBranchName,
        destinationBranch: prActivityData.destinationBranchName,
        ...(prActivityData.prAuthor ? { authorName: prActivityData.prAuthor } : {}),
        ...(stageChanged ? {
          // Stage change info - aligned with base activity structure
          field: 'stageName',
          oldValue: oldStageName ?? undefined,
          newValue: newStageName,
        } : {}),
        ...(prActivityData.remainingOpenPRs && prActivityData.remainingOpenPRs > 0 ? {
          remainingOpenPRs: prActivityData.remainingOpenPRs
        } : {})
      };

      await prisma.ticketActivity.create({
        data: {
          ticketId: ticketId,
          updatedBy: updatedBy,
          activityType: ActivityType.PR,
          value: activityValue as Prisma.InputJsonValue
        }
      });

      logger.info(
        `[TicketRepository] Created PR activity for ticket ${ticketId}, PR ${prActivityData.prId} ` +
        `(action: ${prActivityData.prEvent}, author: ${prActivityData.prAuthor || 'unknown'})`
      );
    } else if (source === ActivitySource.INTERNAL) {
      // For INTERNAL source: Create STAGE_NAME activity
      await prisma.ticketActivity.create({
        data: {
          ticketId: ticketId,
          updatedBy: updatedBy,
          activityType: ActivityType.STAGE_NAME,
          value: {
            field: 'stageName',
            oldValue: oldStageName,
            newValue: newStageName,
            source: source  // Store source for audit trail
          } as Prisma.InputJsonValue
        }
      });

      logger.info(
        `[TicketRepository] Created STAGE_NAME activity for ticket ${ticketId}: ${oldStageName} → ${newStageName}`
      );
    }

    // Create STATUS activity if status changed (for both WEBHOOK and INTERNAL sources)
    if (statusChanged) {
      await prisma.ticketActivity.create({
        data: {
          ticketId: ticketId,
          updatedBy: updatedBy,
          activityType: ActivityType.STATUS,
          value: {
            field: 'statusV2',
            oldValue: oldStatusV2,
            newValue: newStatusV2,
            source: source
          } as Prisma.InputJsonValue
        }
      });

      logger.info(
        `[TicketRepository] Created STATUS activity for ticket ${ticketId}: ${oldStatusV2} → ${newStatusV2}`
      );

      // Create system message for status change
      if (currentTicket.conversationId) {
        // Get user name for the message
        const user = await prisma.user.findUnique({
          where: { id: updatedBy },
          select: { name: true }
        });

        const userName = user?.name || 'System';
        const statusMessage = `${userName} changed status from ${oldStatusV2} to ${newStatusV2}`;

        await prisma.message.create({
          data: {
            conversationId: currentTicket.conversationId,
            senderId: updatedBy,
            content: statusMessage,
            msgType: 'SYSTEM',
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            metadata: {
              activityType: 'STATUS',
              isTicketActivity: true
            } as Prisma.InputJsonValue
          }
        });

        logger.info(
          `[TicketRepository] Created status change message for ticket ${ticketId} in conversation ${currentTicket.conversationId}`
        );
      }
    }

    // Track user activity using Redis Set - O(1) operation, no DB query
    websocketService.trackUserActivity(updatedBy)
      .catch(err => logger.error('Failed to track user activity after ticket stage update:', err));

    // Queue ticket update for Vespa ingestion with complete data
    // try {
    //   // Run all independent database queries concurrently
    //   const [workflow, subTicketMapping, createdByUser, conversation] = await Promise.all([
    //     // Get workflow for this ticket
    //     prisma.workflow.findFirst({
    //       where: { ticketId: updatedTicket.id },
    //       orderBy: { createdAt: 'desc' }
    //     }),
    //     // Check if this ticket is a sub-ticket to find its parent
    //     prisma.ticketSubTicketMapping.findFirst({
    //       where: { subTicketId: updatedTicket.id }
    //     }),
    //     // Get createdBy user's email for ownerEmail and name for createdBy
    //     prisma.user.findUnique({
    //       where: { id: updatedTicket.createdBy },
    //       select: { email: true, name: true }
    //     }),
    //     // Get conversation to fetch channelId for Vespa reference
    //     updatedTicket.conversationId ? prisma.conversation.findUnique({
    //       where: { conversationId: updatedTicket.conversationId },
    //       select: { channelId: true }
    //     }) : Promise.resolve(null)
    //   ]);

    //   const channelId = conversation?.channelId || '';

    //   const ticketWithAdditionalData = {
    //     ...updatedTicket,
    //     createdBy: createdByUser?.name,
    //     workflowType: workflow?.workflowType || 'default',
    //     parentTicketId: subTicketMapping?.ticketId || '',
    //     ownerEmail: createdByUser?.email || '',
    //     channelId, // Include channelId for Vespa channelRef
    //   };

    //   await queueTicketIngestion(ticketWithAdditionalData, 'update');
    // } catch (error) {
    //   logger.error(`[VESPA-FLOW] Failed to queue ticket update for Vespa: ${updatedTicket.id}`, error);
    //   // Don't throw - ticket is still updated in DB
    // }

    return updatedTicket;
  }

  /**
   * Get ticket by ID with board information
   */
  async getTicketWithBoard(ticketId: string) {
    return await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        boardId: true,
        stageName: true,
        updatedBy: true
      }
    });
  }
  /**
   * Find ticket by conversation ID with minimal fields for meet callback
   */
  async findByConversationIdForMeet(conversationId: string) {
    return await prisma.ticket.findFirst({
      where: { conversationId },
      select: { xyneId: true, metadata: true },
    });
  }

  /**
   * Find ticket by xyneId with minimal fields for meet callback
   */
  async findByXyneIdForMeet(xyneId: string) {
    return await prisma.ticket.findFirst({
      where: { xyneId },
      select: {
        id: true,
        conversationId: true,
        title: true,
      },
    });
  }

  /**
   * Get human-readable action text for PR event
   * @private
   */
  private getActionTextForPREvent(event: PRStatusEvent): string {
    const actionMap: Record<PRStatusEvent, string> = {
      [PRStatusEvent.CREATED]: 'raised',
      [PRStatusEvent.UPDATED]: 'updated',
      [PRStatusEvent.MERGED]: 'merged',
      [PRStatusEvent.DECLINED]: 'declined',
    };
    return actionMap[event] || 'updated';
  }

  /**
   * Get ticket by XYNE ID (e.g., "XYNE-123")
   */
  async getTicketByXyneId(xyneId: string) {
    return await prisma.ticket.findUnique({
      where: { xyneId }
    });
  }

  /**
   * Get ticket by ID with id and xyneId selection
   */
  async getTicketById(ticketId: string) {
    return await prisma.ticket.findUnique({
      where: { id: ticketId }
    });
  }


  /**
   * Get hotfix sub-tickets for a parent ticket
   */
  async getHotfixSubTickets(parentTicketId: string) {
    const mappings = await prisma.ticketSubTicketMapping.findMany({
      where: {
        ticketId: parentTicketId,
        subTicket: {
          mappedTicket: {
            ticketType: BaseTicketType.Hotfix
          }
        }
      },
      include: {
        subTicket: {
          include: {
            mappedTicket: true
          }
        }
      }
    });

    return mappings.map(m => m.subTicket);
  }

  async updateTicketAssignee(ticketId: string, newAssigneeId: string, updatedBy: string): Promise<void> {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedTo: newAssigneeId,
        updatedBy: updatedBy,
        updatedAt: new Date(),
      }
    });
  }

  async assignUserGroupToTicket(ticketId: string, groupId: string, updatedBy: string): Promise<void> {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        userGroupId: groupId,
        updatedBy: updatedBy,
        updatedAt: new Date(),
      }
    });
  } 

  async updateTicketMetadata(ticketId: string, metadata: Record<string, any>): Promise<void> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { metadata: true }
    });

    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }

    const existingMetadata = (ticket.metadata as Record<string, any>) || {};

    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        metadata: {
          ...existingMetadata,
          ...metadata
        }
      }
    });
  }
}
