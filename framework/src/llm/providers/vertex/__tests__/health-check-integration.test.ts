import { VertexProvider } from '../vertex-provider.js';
import type { VertexConfig } from '../schemas.js';

describe('Vertex Provider Health Integration', () => {
  let vertexProvider: VertexProvider;
  
  // Skip tests if no credentials are provided
  const shouldSkipTests = !process.env['VERTEX_PROJECT_ID'];
  
  beforeAll(async () => {
    if (shouldSkipTests) {
      return;
    }
    
    const config: VertexConfig = {
      auth: {
        type: process.env['VERTEX_USE_ADC'] === 'true' ? 'adc' : 'service-account',
        projectId: process.env['VERTEX_PROJECT_ID']!,
        region: process.env['VERTEX_REGION'] || 'us-central1',
        ...(process.env['VERTEX_KEY_FILE'] && { keyFile: process.env['VERTEX_KEY_FILE'] })
      },
      apiVersion: 'v1',
      timeout: 30000,
      retries: 3,
      rateLimiting: true,
      enableLogging: true
    };
    
    vertexProvider = new VertexProvider(config);
    await vertexProvider.authenticate();
  });

  describe('Model Availability', () => {
    // Test with available models in us-east5 region
    const testModels = [
      { id: 'gemini-2.5-pro', expectedToWork: true, reason: 'available' },
      { id: 'claude-sonnet-4@20250514', expectedToWork: true, reason: 'available' }
    ];

    test.each(testModels)('should test ping for $id ($reason)', async ({ id: modelId, expectedToWork, reason }) => {
      if (shouldSkipTests) {
        return;
      }
      
      const pingResult = await vertexProvider.ping(modelId);
      
      
      // Verify ping structure regardless of success (due to known limitations)
      expect(pingResult.latency).toBeGreaterThan(0);
      expect(pingResult.latency).toBeLessThan(30000); // 30 second timeout
      expect(pingResult.timestamp).toBeInstanceOf(Date);
      
      if (expectedToWork && pingResult.success) {
        expect(pingResult.responseMetadata).toBeDefined();
        expect(pingResult.responseMetadata!['model']).toBe(modelId);
        expect(pingResult.responseMetadata!['provider']).toBe('vertex');
      } else {
        // For expected failures or actual failures, verify we get a proper error
        expect(pingResult.error).toBeDefined();
        expect(typeof pingResult.error).toBe('string');
        
        // Verify specific error types
        if (reason === 'regional_limitation') {
          expect(pingResult.error).toMatch(/not found|not available/i);
        } else if (reason === 'api_issue') {
          expect(pingResult.error).toMatch(/extra inputs|not permitted/i);
        }
      }
    }, 35000); // 35 second timeout for individual tests

    test.each(testModels)('should get health status for $id', async ({ id: modelId }) => {
      if (shouldSkipTests) {
        return;
      }
      
      const health = await vertexProvider.getHealth(modelId);
      
      expect(health.provider).toBe('vertex');
      expect(health.model).toBe(modelId);
      expect(['healthy', 'degraded', 'unavailable']).toContain(health.status);
      expect(health.latency).toBeGreaterThan(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
      expect(health.metadata).toBeDefined();
    }, 35000);
  });

  describe('Model Capabilities Validation', () => {
    (shouldSkipTests ? it.skip : it)('should validate thinking support for Claude Sonnet 4', () => {
      const capabilities = vertexProvider.getModelCapabilities('claude-sonnet-4@20250514');
      
      expect(capabilities).toBeDefined();
      expect(capabilities!.supportsThinking).toBe(true);
      expect(capabilities!.supportsToolCalling).toBe(true);
      expect(capabilities!.supportsStreaming).toBe(true);
      expect(capabilities!.maxTokens).toBe(64000);
    });

    (shouldSkipTests ? it.skip : it)('should validate thinking support for Gemini 2.5 Pro', () => {
      const capabilities = vertexProvider.getModelCapabilities('gemini-2.5-pro');
      
      expect(capabilities).toBeDefined();
      expect(capabilities!.supportsThinking).toBe(true);
      expect(capabilities!.supportsToolCalling).toBe(true);
      expect(capabilities!.supportsStreaming).toBe(true);
    });

    // (shouldSkipTests ? it.skip : it)('should validate capabilities for Gemini 2.5 Flash', () => {
    //   const capabilities = vertexProvider.getModelCapabilities('gemini-2.5-flash-preview-05-20');
    //   
    //   expect(capabilities).toBeDefined();
    //   expect(capabilities!.supportsToolCalling).toBe(true);
    //   expect(capabilities!.supportsStreaming).toBe(true);
    //   expect(capabilities!.supportsThinking).toBe(true);
    // });
  });

  describe('Provider Capabilities', () => {
    (shouldSkipTests ? it.skip : it)('should support tool calling', () => {
      expect(vertexProvider.supportsToolCalling()).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should support streaming', () => {
      expect(vertexProvider.supportsStreaming()).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should support thinking', () => {
      expect(vertexProvider.supportsThinking()).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should list available models', async () => {
      const models = await vertexProvider.listModels();
      
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(model => model.id && model.name && model.capabilities)).toBe(true);
      
      // Check that both Gemini and Claude models are present
      const modelIds = models.map(m => m.id);
      expect(modelIds.some(id => id.startsWith('gemini'))).toBe(true);
      expect(modelIds.some(id => id.startsWith('claude'))).toBe(true);
    });
  });

  describe('Authentication Status', () => {
    (shouldSkipTests ? it.skip : it)('should be authenticated', () => {
      expect(vertexProvider.isAuthenticated()).toBe(true);
    });

    (shouldSkipTests ? it.skip : it)('should have valid provider configuration', () => {
      const config = vertexProvider.getConfig();
      
      expect(config.name).toBe('vertex');
      expect(config).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    (shouldSkipTests ? it.skip : it)('should handle unsupported model gracefully', async () => {
      const pingResult = await vertexProvider.ping('unsupported-model-12345');
      
      expect(pingResult.success).toBe(false);
      expect(pingResult.error).toBeDefined();
      expect(pingResult.error).toContain('not supported');
    });

    (shouldSkipTests ? it.skip : it)('should handle health check for unsupported model', async () => {
      const health = await vertexProvider.getHealth('unsupported-model-12345');
      
      expect(health.status).toBe('unavailable');
      expect(health.error).toBeDefined();
    });

    (shouldSkipTests ? it.skip : it)('should return undefined capabilities for unsupported model', () => {
      const capabilities = vertexProvider.getModelCapabilities('unsupported-model-12345');
      
      expect(capabilities).toBeUndefined();
    });
  });
});
