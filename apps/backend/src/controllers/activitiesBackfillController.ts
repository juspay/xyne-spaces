import { Request, Response } from 'express';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { extractGroupMentionsFromContent, extractSpecialMentions } from '@/utils/mentionUtils';

interface GroupMention {
  groupId: string;
  groupName: string;
}

/**
 * Admin controller for activities backfill operations
 * Provides endpoints to backfill actorAction for group mentions
 */
export class ActivitiesBackfillController {
  private static readonly BATCH_SIZE = 100;
  private static readonly BATCH_DELAY_MS = 100; // 1000ms delay between batches

  /**
   * Sleep utility to add delay between batches
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if a user is a member of any mentioned groups
   */
  private static async isUserInMentionedGroups(
    userId: string,
    groupMentions: GroupMention[],
  ): Promise<boolean> {
    // Resolve legacy mentions to group IDs
    const allGroupIds = groupMentions.map(g => g.groupId);
    
    if (allGroupIds.length === 0) return false;
    
    // Check if user is in any of these groups
    const userGroupMapping = await db.userGroupMapping.findFirst({
      where: {
        userId,
        userGroupId: { in: allGroupIds },
      },
    });
    
    return !!userGroupMapping;
  }

  /**
   * Backfill actorAction for group mentions
   */
  public static async backfillGroupMentionActorAction(): Promise<{
    totalUpdated: number;
    totalSkipped: number;
    activityIdsToUpdate: string[];
  }> {
    logger.info('🔍 Starting backfill for group mention actorAction...');

    let totalUpdated = 0;
    let totalSkipped = 0;
    const activityIdsToUpdate: string[] = [];
    let skip = 0;
    let iter = 0;

    logger.info('📊 Fetching activities with actorAction="mentioned_user"...');

    while (iter < 1000) {

      const activities = await db.activity.findMany({
        where: {
          actorAction: 'mentioned_user',
          actionSource: 'message',
          messageId: { not: null },
        },
        select: {
          id: true,
          userId: true,
          messageId: true,
        },
        skip,
        take: this.BATCH_SIZE,
      });

      if (activities.length === 0) {
        break;
      }
      logger.info(`Processing batch: ${skip + 1}-${skip + activities.length}...`);

      // Process the batch
      const messageIds = [...new Set(activities.map(a => a.messageId).filter(Boolean))] as string[];
      
      // Fetch all messages for this batch
      const messages = await db.message.findMany({
        where: { messageId: { in: messageIds } },
        select: { messageId: true, content: true, conversation: { select: { channel: { select: { workspaceId: true } } } } },
      });

      const messageMap = new Map(messages.map(m => [m.messageId, { content: m.content, workspaceId: m.conversation.channel.workspaceId }]));

      // Process each activity
      for (const activity of activities) {
        if (!activity.messageId) {
          totalSkipped++;
          continue;
        }

        const msgData = messageMap.get(activity.messageId);
        if (!msgData) {
          totalSkipped++;
          continue;
        }
        const { content, workspaceId } = msgData;

        // Extract group mentions from message content
        const groupMentions = await extractGroupMentionsFromContent(content, workspaceId);
        const specialMentions = extractSpecialMentions(content);

        // Check if user is in any of the mentioned groups
        const isGroupMention = await this.isUserInMentionedGroups(
          activity.userId,
          groupMentions,
        );
        
        if (isGroupMention || specialMentions.hasChannel || specialMentions.hasHere) {
          activityIdsToUpdate.push(activity.id);
          totalUpdated++;
        } else {
          totalSkipped++;
        }
      }
      
      skip += this.BATCH_SIZE;
      
      // Add delay between batches to avoid overwhelming the database
      await this.sleep(this.BATCH_DELAY_MS);
      iter++;
    }

    logger.info(`📈 Summary: Activities to update: ${totalUpdated}, Activities to skip: ${totalSkipped}`);

    // Step 3: Update activities
    if (activityIdsToUpdate.length > 0) {
      logger.info('💾 Updating activities...');
      const result = await db.activity.updateMany({
        where: { id: { in: activityIdsToUpdate } },
        data: { actorAction: 'group_mention' },
      });
      
      logger.info(`✅ Successfully updated ${result.count} activities`);
    } else {
      logger.info('ℹ️  No activities need updating');
    }

    logger.info('✅ Migration complete!');

    return { totalUpdated, totalSkipped, activityIdsToUpdate };
  }

  /**
   * @route POST /api/admin/activities-backfill
   * @desc Trigger backfill for group mention actorAction
   * @access Authenticated users
   */
  static async triggerBackfill(_req: Request, res: Response<ApiResponse>) {
    try {

      logger.info(`[ActivitiesBackfill] Starting backfill...`);

      const result = await ActivitiesBackfillController.backfillGroupMentionActorAction();

      const response: ApiResponse = {
        success: true,
        message: `Backfill complete. Updated ${result.totalUpdated} activities.`,
        data: {
          totalToUpdate: result.totalUpdated,
          totalSkipped: result.totalSkipped,
          sampleIds: result.activityIdsToUpdate.slice(0, 10),
        },
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      logger.error('[ActivitiesBackfill] Error during backfill:', error);
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger backfill',
        timestamp: new Date().toISOString(),
      };
      res.status(500).json(response);
    }
  }
}