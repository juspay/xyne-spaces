import { redisService } from '@/services/redisService';
import { createVespaService, type VespaDependencies } from '@/vespa/src';
import config from '@/vespa/src/config';
import { userSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

// Create dependencies
const dependencies: VespaDependencies = {
    logger: logger,
    config: config
};

// Create vespa service instance
const vespaService = createVespaService(dependencies);


export class PersonalizationSyncWorker {
    // Configuration
    private readonly MIN_SIGNAL_THRESHOLD = 0.01; // Drop signals below this weight
    private readonly BATCH_SIZE = 100; // Process users in batches
    private readonly MAX_SIGNAL_WEIGHT = 100; // Max weight for any signal  

    /**
     * Main sync function - processes all users with pending signals
     */
    async syncAllUsers(): Promise<void> {
        logger.info('[PERSONALIZATION_WORKER] Starting sync...');

        try {
            const startTime = Date.now();

            // Get all users with pending signals
            const userKeys = await this.getUsersWithPendingSignals();
            logger.info(`[PERSONALIZATION_WORKER] Found ${userKeys.length} users with pending signals`);

            if (userKeys.length === 0) {
                logger.info('[PERSONALIZATION_WORKER] No users to sync');
                return;
            }

            // Extract unique user IDs
            const userIds = userKeys.map(key => this.extractUserIdFromKey(key));
            const uniqueUserIds = [...new Set(userIds)];

            logger.info(`[PERSONALIZATION_WORKER] Processing ${uniqueUserIds.length} unique users`);

            // Process users in batches
            let successCount = 0;
            let failureCount = 0;

            for (let i = 0; i < uniqueUserIds.length; i += this.BATCH_SIZE) {
                const batch = uniqueUserIds.slice(i, i + this.BATCH_SIZE);

                const results = await Promise.allSettled(
                    batch.map(userId => this.syncUserSignals(userId))
                );

                results.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        successCount++;
                    } else {
                        failureCount++;
                        logger.error(
                            `[PERSONALIZATION_WORKER] Failed to sync user ${batch[index]}:`,
                            result.reason
                        );
                    }
                });

                logger.info(
                    `[PERSONALIZATION_WORKER] Batch ${Math.floor(i / this.BATCH_SIZE) + 1} completed: ` +
                    `${successCount} success, ${failureCount} failures`
                );
            }

            const duration = Date.now() - startTime;
            logger.info(
                `[PERSONALIZATION_WORKER] Sync completed in ${duration}ms. ` +
                `Success: ${successCount}, Failures: ${failureCount}`
            );
        } catch (error) {
            logger.error('[PERSONALIZATION_WORKER] Fatal error during sync:', error);
            throw error;
        }
    }

    /**
     * Sync signals for a single user
     */
    private async syncUserSignals(userId: string): Promise<void> {
        try {
            // 1. Extract deltas from Redis
            const { channelDeltas, userDeltas } = await this.extractDeltas(userId);

            if (channelDeltas.size === 0 && userDeltas.size === 0) {
                logger.info(`[PERSONALIZATION_WORKER] No signals to sync for user ${userId}`);
                return;
            }

            logger.info(
                `[PERSONALIZATION_WORKER] User ${userId}: ` +
                `${channelDeltas.size} channel deltas, ${userDeltas.size} user deltas`
            );

            // 2. Fetch current Vespa state (weights + timestamps)
            const currentState = await this.getCurrentVespaSignals(userId);

            // 3. Apply per-signal time-based decay
            const now = Date.now();
            const decayedChannelSignals = this.applyPerSignalDecay(
                currentState.channelSignals,
            );

            const decayedUserSignals = this.applyPerSignalDecay(
                currentState.userSignals,
            );

            // 4. Merge new deltas with decayed signals
            const mergedChannelSignals = this.mergeSignals(decayedChannelSignals, channelDeltas);
            const mergedUserSignals = this.mergeSignals(decayedUserSignals, userDeltas);

            // 5. Update timestamps for signals that received new deltas
            const updatedChannelTimestamps = this.updateTimestamps(
                currentState.channelTimestamps,
                channelDeltas,
                now
            );

            const updatedUserTimestamps = this.updateTimestamps(
                currentState.userTimestamps,
                userDeltas,
                now
            );

            // 6. Update Vespa
            await this.updateVespaSignals(
                userId,
                mergedChannelSignals,
                mergedUserSignals,
                updatedChannelTimestamps,
                updatedUserTimestamps
            );

            // 7. Clear Redis deltas
            await this.clearDeltas(userId);

            logger.info(
                `[PERSONALIZATION_WORKER] Successfully synced user ${userId}: ` +
                `${mergedChannelSignals.size} channels, ${mergedUserSignals.size} users`
            );
        } catch (error) {
            logger.error(`[PERSONALIZATION_WORKER] Error syncing user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Get all users with pending signals from Redis
     */
    private async getUsersWithPendingSignals(): Promise<string[]> {
        const redis = redisService.getClient();

        // Get all keys matching user:*:deltas pattern
        const channelDeltaKeys = await redis.keys('user:*:deltas');
        const userDeltaKeys = await redis.keys('user:*:user_deltas');

        // Combine and deduplicate
        return [...new Set([...channelDeltaKeys, ...userDeltaKeys])];
    }

    /**
     * Extract user ID from Redis key
     * Example: "user:123:deltas" -> "123"
     */
    private extractUserIdFromKey(key: string): string {
        const match = key.match(/^user:([^:]+):/);
        if (!match) {
            throw new Error(`Invalid Redis key format: ${key}`);
        }
        return match[1];
    }

    /**
     * Extract signal deltas from Redis for a user
     */
    private async extractDeltas(userId: string): Promise<{
        channelDeltas: Map<string, number>;
        userDeltas: Map<string, number>;
    }> {
        const redis = redisService.getClient();

        // Use pipeline for efficiency
        const pipeline = redis.pipeline();
        pipeline.zrange(`user:${userId}:deltas`, 0, -1, 'WITHSCORES');
        pipeline.zrange(`user:${userId}:user_deltas`, 0, -1, 'WITHSCORES');

        const results = await pipeline.exec();

        if (!results) {
            return {
                channelDeltas: new Map(),
                userDeltas: new Map()
            };
        }

        return {
            channelDeltas: this.parseRedisSignals(results[0]?.[1] as string[] || []),
            userDeltas: this.parseRedisSignals(results[1]?.[1] as string[] || [])
        };
    }

    /**
     * Parse Redis ZRANGE result into Map
     * Redis returns: [member1, score1, member2, score2, ...]
     */
    private parseRedisSignals(rawData: string[]): Map<string, number> {
        const signals = new Map<string, number>();

        if (!rawData || rawData.length === 0) {
            return signals;
        }

        for (let i = 0; i < rawData.length; i += 2) {
            const entityId = rawData[i];
            const weight = parseFloat(rawData[i + 1]);

            if (!isNaN(weight)) {
                signals.set(entityId, weight);
            }
        }

        return signals;
    }

    /**
     * Fetch current signal weights and timestamps from Vespa
     */
    private async getCurrentVespaSignals(userId: string): Promise<{
        channelSignals: Map<string, number>;
        userSignals: Map<string, number>;
        channelTimestamps: Map<string, number>;
        userTimestamps: Map<string, number>;
        lastSyncTime: number;
    }> {
        try {
            const response = await vespaService.crudService.getDocument(userId, userSchema);

            if (!response || !response.fields) {
                // User document doesn't exist or has no personalization data
                return {
                    channelSignals: new Map(),
                    userSignals: new Map(),
                    channelTimestamps: new Map(),
                    userTimestamps: new Map(),
                    lastSyncTime: 0
                };
            }

            return {
                channelSignals: this.vespaTensorToMap(response.fields.channelWeights),
                userSignals: this.vespaTensorToMap(response.fields.userWeights),
                channelTimestamps: this.vespaTensorToMap(response.fields.channelTimestamps),
                userTimestamps: this.vespaTensorToMap(response.fields.userTimestamps),
                lastSyncTime: response.fields.personalizationLastUpdated || 0
            };
        } catch (error) {
            logger.error(`[PERSONALIZATION_WORKER] Failed to fetch Vespa state for user ${userId}:`, error);
            // Return empty state on error
            return {
                channelSignals: new Map(),
                userSignals: new Map(),
                channelTimestamps: new Map(),
                userTimestamps: new Map(),
                lastSyncTime: 0
            };
        }
    }

    /**
     * Convert Vespa tensor to Map
     */
    private vespaTensorToMap(tensor: any): Map<string, number> {
        const map = new Map<string, number>();

        if (!tensor || !tensor.cells) {
            return map;
        }

        if (Array.isArray(tensor.cells)) {
            // Handle array format (long form)
            for (const cell of tensor.cells) {
                const key = cell.address?.key;
                const value = cell.value;

                if (key !== undefined && value !== undefined) {
                    map.set(key, value);
                }
            }
        } else if (typeof tensor.cells === 'object') {
            // Handle object format (short form)
            for (const [key, value] of Object.entries(tensor.cells)) {
                if (value !== undefined) {
                    map.set(key, Number(value));
                }
            }
        }

        return map;
    }

    /**
     * Apply time-based decay to signals based on their individual timestamps
     */
    private applyPerSignalDecay(
        signals: Map<string, number>,
    ): Map<string, number> {
        const decayedSignals = new Map<string, number>();

        for (const [entityId, weight] of signals) {
            const decayedWeight = weight * 0.9;
            // Only keep signals above threshold
            if (decayedWeight >= this.MIN_SIGNAL_THRESHOLD) {
                decayedSignals.set(entityId, decayedWeight);
            }
        }

        return decayedSignals;
    }

    /**
     * Merge new deltas with decayed signals
     */
    private mergeSignals(
        decayedSignals: Map<string, number>,
        newDeltas: Map<string, number>
    ): Map<string, number> {
        const merged = new Map(decayedSignals);

        for (const [entityId, deltaWeight] of newDeltas) {
            const currentWeight = merged.get(entityId) || 0;
            merged.set(entityId, Math.min(currentWeight + deltaWeight,this.MAX_SIGNAL_WEIGHT));
        }

        return merged;
    }

    /**
     * Update timestamps for signals that received new deltas
     */
    private updateTimestamps(
        existingTimestamps: Map<string, number>,
        newDeltas: Map<string, number>,
        currentTime: number
    ): Map<string, number> {
        const updatedTimestamps = new Map(existingTimestamps);

        // Update timestamp for signals that received new deltas
        for (const entityId of newDeltas.keys()) {
            updatedTimestamps.set(entityId, currentTime);
        }

        return updatedTimestamps;
    }

    /**
     * Update Vespa with new weights and timestamps
     */
    private async updateVespaSignals(
        userId: string,
        channelSignals: Map<string, number>,
        userSignals: Map<string, number>,
        channelTimestamps: Map<string, number>,
        userTimestamps: Map<string, number>
    ): Promise<void> {
        const updateFields = {
            channelWeights: this.mapToVespaTensor(channelSignals),
            userWeights: this.mapToVespaTensor(userSignals),
            channelTimestamps: this.mapToVespaTensor(channelTimestamps),
            userTimestamps: this.mapToVespaTensor(userTimestamps),
            personalizationLastUpdated: Date.now()
        };

        // Cast to any since personalization fields may not be in base type yet
        await vespaService.crudService.update(userId, updateFields as any, userSchema);
    }

    /**
     * Convert Map to Vespa tensor format
     */
    private mapToVespaTensor(signals: Map<string, number>): any {
        const cells = [];

        for (const [key, value] of signals.entries()) {
            cells.push({
                address: { key },
                value
            });
        }

        return { cells };
    }

    /**
     * Clear processed deltas from Redis
     */
    private async clearDeltas(userId: string): Promise<void> {
        const redis = redisService.getClient();

        // Use pipeline for atomic deletion
        const pipeline = redis.pipeline();
        pipeline.del(`user:${userId}:deltas`);
        pipeline.del(`user:${userId}:user_deltas`);

        await pipeline.exec();
    }
}

// Export singleton instance
export const personalizationSyncWorker = new PersonalizationSyncWorker();
