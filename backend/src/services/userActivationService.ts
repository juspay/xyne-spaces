import { UserStatus, PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { DatabaseClient } from '@/database/client';

export interface BulkStatusUpdateResult {
  successful: string[];
  failed: { userId: string; error: string }[];
}

/**
 * User Activation Service
 *
 * Handles bulk user activation/deactivation
 */
export class UserActivationService {
  private static instance: UserActivationService;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  public static getInstance(): UserActivationService {
    if (!UserActivationService.instance) {
      UserActivationService.instance = new UserActivationService();
    }
    return UserActivationService.instance;
  }

  /**
   * Sleep/delay helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create batches of specified size
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Update status for multiple users in batches of 10
   * All users in a batch must exist for the batch to succeed
   * 1 minute delay between batches
   * @param userIds - Array of user IDs to update
   * @param status - Target status (ACTIVE or INACTIVE)
   * @returns Result with successful updates and failures
   */
  async bulkUpdateUserStatus(userIds: string[], status: UserStatus): Promise<BulkStatusUpdateResult> {
    const result: BulkStatusUpdateResult = {
      successful: [],
      failed: []
    };

    // Split into batches of 10
    const batches = this.createBatches(userIds, 10);
    logger.info(`[bulkUpdateUserStatus] Processing ${userIds.length} users in ${batches.length} batches`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNumber = i + 1;

      logger.info(`[bulkUpdateUserStatus] Processing batch ${batchNumber}/${batches.length} with ${batch.length} users`);

      try {
        // Step 1: Verify all users in batch exist
        const existingUsers = await this.prisma.user.findMany({
          where: { id: { in: batch } },
          select: { id: true }
        });

        const existingUserIds = new Set(existingUsers.map(u => u.id));
        const missingUserIds = batch.filter(id => !existingUserIds.has(id));

        if (missingUserIds.length > 0) {
          // Fail entire batch if any user doesn't exist
          const errorMsg = `Batch failed: Users not found: ${missingUserIds.join(', ')}`;
          logger.error(`[bulkUpdateUserStatus] ${errorMsg}`);

          for (const userId of batch) {
            result.failed.push({
              userId,
              error: missingUserIds.includes(userId)
                ? 'User not found'
                : `Batch failed due to missing users: ${missingUserIds.join(', ')}`
            });
          }
          continue; // Move to next batch
        }

        // Step 2: All users exist, perform batch update in transaction
        await this.prisma.$transaction(async (tx) => {
          await tx.user.updateMany({
            where: { id: { in: batch } },
            data: {
              status,
              leftAt: status === UserStatus.INACTIVE ? new Date() : null
            }
          });

          // When deactivating, remove the users from every user group in the
          // workspace and tear down their assignment-related state. These tables
          // are keyed by userId, so deleting by userId clears the rows across all
          // groups. The auto-assignment engine builds its candidate pool from
          // user_group_mappings (and gates on user_assignment_states), so removing
          // these rows takes the user out of all auto-assignment routing.
          if (status === UserStatus.INACTIVE) {
            await tx.userGroupMapping.deleteMany({
              where: { userId: { in: batch } }
            });
            await tx.userAssignmentState.deleteMany({
              where: { userId: { in: batch } }
            });
            await tx.userExpertiseMapping.deleteMany({
              where: { userId: { in: batch } }
            });
          }
        });

        // Mark all as successful
        for (const userId of batch) {
          result.successful.push(userId);
        }

        logger.info(`[bulkUpdateUserStatus] Batch ${batchNumber} completed successfully: ${batch.length} users updated`);

      } catch (error) {
        // Transaction failed - fail entire batch
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[bulkUpdateUserStatus] Batch ${batchNumber} failed:`, error);

        for (const userId of batch) {
          result.failed.push({ userId, error: `Batch failed: ${errorMessage}` });
        }
      }

      // Step 3: Delay 1 minute before next batch (except after last batch)
      if (i < batches.length - 1) {
        logger.info(`[bulkUpdateUserStatus] Waiting 1 minute before next batch...`);
        await this.sleep(60000);
      }
    }

    logger.info(`[bulkUpdateUserStatus] Completed: ${result.successful.length} successful, ${result.failed.length} failed`);
    return result;
  }
}

export const userActivationService = UserActivationService.getInstance();
