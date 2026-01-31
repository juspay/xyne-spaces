import { VertexProvider } from '../vertex-provider.js';
import type { VertexConfig } from '../schemas.js';
import type { LLMRequest } from '../../../core/types/index.js';

describe('Vertex Provider Basic Generation', () => {
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

  describe('Gemini 2.5 Pro', () => {
    (shouldSkipTests ? it.skip : it)('should generate basic response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-basic-gemini',
          type: 'user',
          content: 'What is 2 + 2? Answer briefly.',
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex',
        parameters: {
          maxTokens: 200,
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.model).toBe('gemini-2.5-pro');
      expect(response.provider).toBe('vertex');
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.finishReason).toBe('stop');
      
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should generate with thinking mode', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-thinking-gemini',
          type: 'user',
          content: 'Calculate 15 × 8 step by step.',
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex',
        parameters: {
          maxTokens: 1500,
          temperature: 0
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 500,
            includeThoughts: true
          }
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      // Note: Gemini automatically uses thinking internally; visible content may vary
      // Since Gemini 2.5 uses thinking internally, we should check for thinking tokens
      expect(response.usage.thinkingTokens).toBeGreaterThan(0);
      // Finish reason can be 'stop' or 'length' if thinking uses all tokens
      expect(['stop', 'length']).toContain(response.finishReason);
      
    }, 45000);
  });

  describe('Claude Sonnet 4', () => {
    (shouldSkipTests ? it.skip : it)('should generate basic response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-basic-claude',
          type: 'user',
          content: 'What is the capital of Japan? Answer briefly.',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: {
          maxTokens: 200,
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.model).toBe('claude-sonnet-4@20250514');
      expect(response.provider).toBe('vertex');
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.finishReason).toBe('stop');
      
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should generate with thinking mode', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-thinking-claude',
          type: 'user',
          content: 'Solve: If I have 12 apples and eat 3, how many are left? Think through this step by step.',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: {
          maxTokens: 2048, // Must be greater than budget_tokens
          temperature: 0
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 1024, // Minimum required by Claude
            includeThoughts: true
          }
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.thinking).toBeDefined();
      expect(response.thinking!.length).toBeGreaterThan(0);
      expect(response.usage.thinkingTokens).toBeGreaterThan(0);
      expect(response.finishReason).toBe('stop');
      
    }, 45000);
  });

  describe('Streaming Tests', () => {
    (shouldSkipTests ? it.skip : it)('should stream Gemini 2.5 Pro response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-stream-gemini',
          type: 'user',
          content: 'Say: 1, 2, 3',
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex',
        parameters: {
          maxTokens: 300,
          temperature: 0
        }
      };

      const chunks: string[] = [];
      let chunkCount = 0;
      let hasContentOrThinking = false;
      
      for await (const chunk of vertexProvider.generateStream(request)) {
        chunkCount++;
        
        if (chunk.type === 'content' && chunk.content) {
          chunks.push(chunk.content);
          hasContentOrThinking = true;
        } else if (chunk.type === 'thinking') {
          // Count thinking chunks as valid streaming responses
          hasContentOrThinking = true;
        }
        
        expect(chunk.id).toBeDefined();
        expect(chunk.type).toBeDefined();
        expect(chunk.metadata).toBeDefined();
      }
      
      expect(chunkCount).toBeGreaterThan(0);
      expect(hasContentOrThinking).toBe(true); // Should have either content or thinking
      
      // Content might be empty if model only used thinking tokens
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should stream Claude Sonnet 4 response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-stream-claude',
          type: 'user',
          content: 'List three colors.',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: {
          maxTokens: 100,
          temperature: 0
        }
      };

      const chunks: string[] = [];
      let chunkCount = 0;
      
      for await (const chunk of vertexProvider.generateStream(request)) {
        chunkCount++;
        if (chunk.type === 'content' && chunk.content) {
          chunks.push(chunk.content);
        }
        
        expect(chunk.id).toBeDefined();
        expect(chunk.type).toBeDefined();
        expect(chunk.metadata).toBeDefined();
      }
      
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
      
      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);
      
    }, 30000);
  });
});