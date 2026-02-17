import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { config } from '@/config/env';

const EXCLUDED_MODEL_PATTERNS = /^(claude|gemini)/i;

class ModelSyncService {
  async syncWithLiteLLM(): Promise<void> {
    try {
      const baseUrl = config.litellm.baseUrl;
      const apiKey = config.litellm.apiKey;

      logger.info('Fetching models from LiteLLM...');
      const response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models from LiteLLM: ${response.statusText}`);
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      const allModelIds = data.data?.map((model) => model.id) || [];
      
      const modelIds = allModelIds.filter((modelId) => !modelId.match(EXCLUDED_MODEL_PATTERNS));
      logger.info(`Fetched ${allModelIds.length} models from LiteLLM, syncing ${modelIds.length} hosted models (filtered out Claude/Gemini)`);

      for (const modelId of modelIds) {
        try {
          await repositories.models.upsert(modelId, {
            userDefinedId: modelId,
            name: modelId,
            provider: 'litellm',
            credentials: JSON.stringify({}),
          });
        } catch (error) {
          logger.debug(`Failed to sync model ${modelId}: ${error}`);
        }
      }

      logger.info(`Model sync completed successfully`);
    } catch (error) {
      logger.error('Error syncing models from LiteLLM:', error);
      throw error;
    }
  }
}

export const modelSyncService = new ModelSyncService();