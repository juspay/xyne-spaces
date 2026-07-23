import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const EXCLUDED_MODEL_PATTERNS = /^(claude|gemini)/i;

class ModelSyncService {
  async syncWithLiteLLM(): Promise<void> {
    try {
      const credential = await orgLLMCredentialService.getCredentialByWorkspaceId(
        config.defaultWorkspaceId,
        OrgLLMServiceAccountPurpose.DEFAULT,
      );
      if (!credential) {
        throw new Error(`No active DEFAULT LiteLLM service account credential for default workspace ${config.defaultWorkspaceId}`);
      }

      logger.info('Fetching models from LiteLLM...');
      const response = await fetch(`${credential.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${credential.apiKey}` },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models from LiteLLM: ${response.statusText}`);
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      const allModelIds = data.data?.map((model) => model.id) || [];
      
      const modelIds = allModelIds.filter((modelId) => !modelId.match(EXCLUDED_MODEL_PATTERNS));
      logger.info(`Fetched ${allModelIds.length} models from LiteLLM, syncing ${modelIds.length} hosted models (filtered out Claude/Gemini)`);

      // Delete all existing litellm-api models
      await db.model.deleteMany({
        where: { provider: 'litellm-api' }
      });

      // Create fresh models with userDefinedId as "modelName-litellm-api"
      await db.model.createMany({
        data: modelIds.map(modelId => ({
          userDefinedId: `${modelId}-litellm-api`,
          name: modelId,
          provider: 'litellm-api',
          credentials: JSON.stringify({}),
          workspaceId: config.defaultWorkspaceId,
        })),
      });

      logger.info(`Model sync completed: ${modelIds.length} models synced`);
    } catch (error) {
      logger.error('Error syncing models from LiteLLM:', error);
      throw error;
    }
  }
}

export const modelSyncService = new ModelSyncService();
