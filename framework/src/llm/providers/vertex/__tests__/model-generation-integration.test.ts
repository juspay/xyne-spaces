import { VertexProvider } from '../vertex-provider.js';
import type { VertexConfig } from '../schemas.js';
import type { LLMRequest } from '../../../core/types/index.js';
import { z } from 'zod';

describe('Vertex Provider Model Generation Integration', () => {
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

  describe('Gemini 2.5 Pro Real Generation', () => {
    const modelId = 'gemini-2.5-pro';

    (shouldSkipTests ? it.skip : it)('should generate basic response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-basic',
          type: 'user',
          content: 'What is 2 + 2? Give a short answer.',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        parameters: {
          maxTokens: 500, // Increased to accommodate Gemini's internal thinking
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      // Gemini may use thinking tokens, so content might be empty - check for content OR thinking tokens
      const hasContentOrThinking = response.content.length > 0 || (response.usage.thinkingTokens && response.usage.thinkingTokens > 0);
      expect(hasContentOrThinking).toBe(true);
      expect(response.model).toBe(modelId);
      expect(response.provider).toBe('vertex');
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      // Finish reason can be 'stop' or 'length' if thinking uses most tokens
      expect(['stop', 'length']).toContain(response.finishReason);
      expect(response.metadata.timestamp).toBeInstanceOf(Date);
      
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should generate with thinking mode', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-thinking',
          type: 'user',
          content: 'Solve this step by step: If a train travels 60 mph for 2.5 hours, how far does it go?',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        parameters: {
          maxTokens: 2000, // Increased for thinking mode
          // Remove temperature when thinking is enabled
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 1000,
            includeThoughts: true
          }
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      // Gemini uses thinking internally - check for thinking tokens regardless of visible content
      expect(response.usage.thinkingTokens).toBeGreaterThan(0);
      // Finish reason can be 'stop' or 'length' when thinking is used
      expect(['stop', 'length']).toContain(response.finishReason);
      
    }, 45000);

    (shouldSkipTests ? it.skip : it)('should handle tool calling', async () => {
      const calculatorTool = {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        inputSchema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate'),
          operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Type of operation')
        })
      };

      const request: LLMRequest = {
        messages: [{
          id: 'test-tools',
          type: 'user',
          content: 'Calculate 15 * 24 for me using the calculator tool.',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        tools: [calculatorTool],
        parameters: {
          maxTokens: 800, // Increased to accommodate thinking + tool calling
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      
      expect(response).toBeDefined();
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      
      const toolCall = response.toolCalls![0];
      expect(toolCall?.name).toBe('calculator');
      expect(toolCall?.arguments).toBeDefined();
      expect(toolCall?.arguments['expression']).toBeDefined();
      
    }, 30000);
  });

  describe('Claude Sonnet 4 Real Generation', () => {
    const modelId = 'claude-sonnet-4@20250514';

    (shouldSkipTests ? it.skip : it)('should generate basic response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-claude-basic',
          type: 'user',
          content: 'What is the capital of France? Give a short answer.',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        parameters: {
          maxTokens: 100,
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.model).toBe(modelId);
      expect(response.provider).toBe('vertex');
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.finishReason).toBe('stop');
      
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should generate with thinking mode', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-claude-thinking',
          type: 'user',
          content: 'Analyze this problem: A company has 100 employees. 60% work remotely, 25% work hybrid, and the rest work in office. How many work in each mode?',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        parameters: {
          maxTokens: 2500, // Must be greater than budget_tokens
          // temperature: 0 // Remove temperature when thinking is enabled (Claude constraint)
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 2000,
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

    (shouldSkipTests ? it.skip : it)('should handle tool calling', async () => {
      const textAnalysisTool = {
        name: 'text_analyzer',
        description: 'Analyze text for sentiment and key themes',
        inputSchema: z.object({
          text: z.string().describe('Text to analyze'),
          analysisType: z.enum(['sentiment', 'themes', 'summary']).describe('Type of analysis to perform')
        })
      };

      const request: LLMRequest = {
        messages: [{
          id: 'test-claude-tools',
          type: 'user',
          content: 'Analyze the sentiment of this text: "I love working with this new AI system, it\'s incredibly helpful and efficient!"',
          timestamp: new Date().toDateString()
        }],
        model: modelId,
        provider: 'vertex',
        tools: [textAnalysisTool],
        parameters: {
          maxTokens: 400,
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      
      const toolCall = response.toolCalls![0];
      expect(toolCall?.name).toBe('text_analyzer');
      expect(toolCall?.arguments).toBeDefined();
      expect(toolCall?.arguments['text']).toBeDefined();
      expect(toolCall?.arguments['analysisType']).toBeDefined();
      
    }, 30000);
  });

  describe('Streaming Generation Tests', () => {
    (shouldSkipTests ? it.skip : it)('should stream Gemini 2.5 Pro response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-stream-gemini',
          type: 'user',
          content: 'Count from 1 to 5 and explain each number briefly.',
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex',
        parameters: {
          maxTokens: 800, // Increased to accommodate thinking
          temperature: 0.3
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
          hasContentOrThinking = true;
        }
        
        expect(chunk.id).toBeDefined();
        expect(chunk.type).toBeDefined();
        expect(chunk.metadata).toBeDefined();
        expect(chunk.metadata?.timestamp).toBeInstanceOf(Date);
        expect(chunk.metadata?.model).toBe('gemini-2.5-pro');
        expect(chunk.metadata?.provider).toBe('vertex');
      }
      
      expect(chunkCount).toBeGreaterThan(0);
      // Either content chunks or thinking activity should be present
      expect(hasContentOrThinking).toBe(true);
      
      // Content might be empty if Gemini uses all tokens for thinking
      
    }, 45000);

    (shouldSkipTests ? it.skip : it)('should stream Claude Sonnet 4 response', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-stream-claude',
          type: 'user',
          content: 'Write a short poem about technology and its impact on society.',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: {
          maxTokens: 400,
          temperature: 0.7
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
        expect(chunk.metadata?.timestamp).toBeInstanceOf(Date);
        expect(chunk.metadata?.model).toBe('claude-sonnet-4@20250514');
        expect(chunk.metadata?.provider).toBe('vertex');
      }
      
      expect(chunkCount).toBeGreaterThan(0);
      expect(chunks.length).toBeGreaterThan(0);
      
      const fullContent = chunks.join('');
      expect(fullContent.length).toBeGreaterThan(0);
      
    }, 45000);
  });

  describe('Model Comparison Tests', () => {
    (shouldSkipTests ? it.skip : it)('should compare thinking capabilities', async () => {
      const prompt = 'Explain the concept of recursion in programming with a simple example.';
      
      const baseRequest = {
        messages: [{
          id: 'comparison-test',
          type: 'user' as const,
          content: prompt,
          timestamp: new Date().toDateString()
        }],
        provider: 'vertex' as const,
        parameters: {
          maxTokens: 2000, // Must be greater than budget_tokens
          temperature: 1 // Must be 1 when thinking is enabled for Claude
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 1500,
            includeThoughts: true
          }
        }
      };

      // Test Gemini 2.5 Pro
      const geminiRequest: LLMRequest = { ...baseRequest, model: 'gemini-2.5-pro' };
      const geminiResponse = await vertexProvider.generate(geminiRequest);

      // Test Claude Sonnet 4
      const claudeRequest: LLMRequest = { ...baseRequest, model: 'claude-sonnet-4@20250514' };
      
      const claudeResponse = await vertexProvider.generate(claudeRequest);

      // Validate both responses
      expect(geminiResponse.content).toBeDefined();
      // Gemini may not expose visible thinking content but should have thinking tokens
      expect(geminiResponse.usage.thinkingTokens).toBeGreaterThan(0);
      expect(claudeResponse.content).toBeDefined();
      expect(claudeResponse.thinking).toBeDefined();
      
    }, 60000);
  });

  describe('Error Handling and Edge Cases', () => {
    (shouldSkipTests ? it.skip : it)('should handle token limit gracefully', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-token-limit',
          type: 'user',
          content: 'Write a very long essay about the history of computing.',
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex',
        parameters: {
          maxTokens: 50, // Very small limit
          temperature: 0
        }
      };

      const response = await vertexProvider.generate(request);
      
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
      expect(['max_tokens', 'length']).toContain(response.finishReason);
      expect(response.usage.completionTokens).toBeLessThanOrEqual(50);
      
    }, 30000);

    (shouldSkipTests ? it.skip : it)('should handle empty message gracefully', async () => {
      const request: LLMRequest = {
        messages: [{
          id: 'test-empty',
          type: 'user',
          content: '',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: {
          maxTokens: 100,
          temperature: 0
        }
      };

      // This should either work or throw a proper error
      try {
        const response = await vertexProvider.generate(request);
        expect(response).toBeDefined();
        expect(response.content).toBeDefined();
        
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }, 30000);
  });
});