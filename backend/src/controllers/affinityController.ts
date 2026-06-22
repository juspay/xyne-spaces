import { Request, Response } from 'express';
import { vespaService } from '@/services/vespaSearch';
import { userSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

// Keys are stored as "channel:{id}" or "user:{id}" — strip the prefix so callers
// can look up by bare ID (channelId / userId).
function vespaTensorToRecord(tensor: any, prefix: string): Record<string, number> {
    const result: Record<string, number> = {};
    if (!tensor?.cells) return result;

    const strip = (k: string) => k.startsWith(prefix) ? k.slice(prefix.length) : k;

    if (Array.isArray(tensor.cells)) {
        for (const cell of tensor.cells) {
            if (cell.address?.key !== undefined && cell.value !== undefined) {
                result[strip(cell.address.key)] = cell.value;
            }
        }
    } else if (typeof tensor.cells === 'object') {
        for (const [key, value] of Object.entries(tensor.cells)) {
            result[strip(key)] = Number(value);
        }
    }
    return result;
}

class AffinityController {
    getAffinity = async (req: Request, res: Response): Promise<void> => {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        try {
            const userDoc = await vespaService.crudService.getDocument(userId, userSchema);
            const channelWeights = vespaTensorToRecord(userDoc?.fields?.channelWeights, 'channel:');
            const userWeights = vespaTensorToRecord(userDoc?.fields?.userWeights, 'user:');
            res.json({ channelWeights, userWeights });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isNotFound = message.includes('404') || message.toLowerCase().includes('not found');
            if (isNotFound) {
                // Normal for new users who have no personalization doc yet
                logger.info('[AFFINITY] No affinity doc found for user, returning empty weights', { userId });
            } else {
                logger.warn('[AFFINITY] Failed to fetch affinity weights', { userId, error: message });
            }
            res.json({ channelWeights: {}, userWeights: {} });
        }
    };
}

export const affinityController = new AffinityController();
