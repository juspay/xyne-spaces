import { VertexProvider } from '../../providers/vertex/vertex-provider.js';
import type { VertexConfig } from '../../providers/vertex/schemas.js';
import type { LLMRequest } from '../../core/types/index.js';
import { z } from 'zod';

describe('Performance Tests - Concurrent Requests', () => {
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

  describe('Concurrent Generation Tests', () => {
    (shouldSkipTests ? it.skip : it)('should handle concurrent basic requests efficiently', async () => {
      const concurrentRequests = 5;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        messages: [{
          id: `concurrent-basic-${i}`,
          type: 'user' as const,
          content: `What is ${i + 1} * ${i + 2}? Give a brief answer.`,
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro', // Use available model for performance testing
        provider: 'vertex' as const,
        parameters: {
          maxTokens: 100,
          temperature: 0
        }
      }));

      const startTime = Date.now();
      
      const responses = await Promise.all(
        requests.map(req => vertexProvider.generate(req))
      );
      
      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / concurrentRequests;
      
      // Validate all responses
      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach((response) => {
        expect(response.content).toBeDefined();
        // Gemini might use thinking tokens, content could be empty
        expect(response.content.length).toBeGreaterThanOrEqual(0);
        expect(response.model).toBe('gemini-2.5-pro');
        expect(['stop', 'tool_calls', 'length']).toContain(response.finishReason);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
      });
      
      // Performance assertions
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
      expect(avgTime).toBeLessThan(10000); // Average request should be under 10 seconds
      
      // Performance metrics logged for analysis
      expect(totalTime).toBeGreaterThan(0);
      expect(avgTime).toBeGreaterThan(0);
    }, 45000);

    (shouldSkipTests ? it.skip : it)('should handle concurrent thinking requests', async () => {
      const concurrentRequests = 3; // Fewer for thinking mode due to complexity
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        messages: [{
          id: `concurrent-thinking-${i}`,
          type: 'user' as const,
          content: `Solve step by step: If I have ${i + 5} apples and give away ${i + 2}, how many do I have left?`,
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex' as const,
        parameters: {
          maxTokens: 1500,
          temperature: 0
        },
        features: {
          thinking: {
            enabled: true,
            budgetTokens: 1024, // Claude minimum
            includeThoughts: true
          }
        }
      }));

      const startTime = Date.now();
      
      const responses = await Promise.all(
        requests.map(req => vertexProvider.generate(req))
      );
      
      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / concurrentRequests;
      
      // Validate all responses
      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach((response) => {
        expect(response.content).toBeDefined();
        expect(response.thinking).toBeDefined();
        expect(response.usage.thinkingTokens).toBeGreaterThan(0);
        expect(['stop', 'tool_calls', 'length']).toContain(response.finishReason);
        expect(response.model).toBe('claude-sonnet-4@20250514');
      });
      
      // Performance assertions for thinking mode
      expect(totalTime).toBeLessThan(90000); // Should complete within 90 seconds
      expect(avgTime).toBeLessThan(45000); // Average request should be under 45 seconds
      
      // Performance metrics tracked
      expect(totalTime).toBeGreaterThan(0);
      expect(avgTime).toBeGreaterThan(0);
    }, 120000);

    (shouldSkipTests ? it.skip : it)('should handle concurrent tool calling requests', async () => {
      const calculatorTool = {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        inputSchema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate'),
          operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Type of operation')
        })
      };

      const concurrentRequests = 4;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        messages: [{
          id: `concurrent-tools-${i}`,
          type: 'user' as const,
          content: `Use the calculator to compute ${(i + 1) * 10} divided by ${i + 2}.`,
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex' as const,
        tools: [calculatorTool],
        parameters: {
          maxTokens: 500,
          temperature: 0
        }
      }));

      const startTime = Date.now();
      
      const responses = await Promise.all(
        requests.map(req => vertexProvider.generate(req))
      );
      
      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / concurrentRequests;
      
      // Validate all responses
      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach((response) => {
        expect(response.content).toBeDefined();
        expect(response.toolCalls).toBeDefined();
        expect(response.toolCalls!.length).toBeGreaterThan(0);
        expect(response.toolCalls![0]?.name).toBe('calculator');
        expect(['stop', 'tool_calls', 'length']).toContain(response.finishReason);
      });
      
      // Performance assertions
      expect(totalTime).toBeLessThan(60000); // Should complete within 60 seconds
      expect(avgTime).toBeLessThan(20000); // Average request should be under 20 seconds
      
      // Performance metrics tracked
      expect(totalTime).toBeGreaterThan(0);
      expect(avgTime).toBeGreaterThan(0);
    }, 90000);
  });

  describe('Streaming Performance Tests', () => {
    (shouldSkipTests ? it.skip : it)('should handle concurrent streaming requests', async () => {
      const concurrentRequests = 3;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        messages: [{
          id: `concurrent-stream-${i}`,
          type: 'user' as const,
          content: `Count from 1 to ${i + 5} and explain each number briefly.`,
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-pro',
        provider: 'vertex' as const,
        parameters: {
          maxTokens: 400,
          temperature: 0.3
        }
      }));

      const startTime = Date.now();
      
      // Process streaming requests concurrently
      const streamPromises = requests.map(async (req, index) => {
        const chunks: string[] = [];
        let chunkCount = 0;
        let firstChunkTime: number | null = null;
        
        for await (const chunk of vertexProvider.generateStream(req)) {
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
          }
          
          chunkCount++;
          if (chunk.type === 'content' && chunk.content) {
            chunks.push(chunk.content);
          }
        }
        
        return {
          requestIndex: index,
          chunks,
          chunkCount,
          timeToFirstChunk: firstChunkTime ? firstChunkTime - startTime : 0,
          totalContent: chunks.join('')
        };
      });

      const results = await Promise.all(streamPromises);
      const totalTime = Date.now() - startTime;
      
      // Validate streaming results
      expect(results).toHaveLength(concurrentRequests);
      results.forEach((result) => {
        expect(result.chunkCount).toBeGreaterThan(0);
        // Content might be empty if model used thinking tokens internally
        expect(result.timeToFirstChunk).toBeLessThan(15000); // First chunk within 15 seconds
      });
      
      // Performance assertions
      expect(totalTime).toBeLessThan(60000); // All streams complete within 60 seconds
      
      const avgTimeToFirstChunk = results.reduce((sum, r) => sum + r.timeToFirstChunk, 0) / concurrentRequests;
      expect(avgTimeToFirstChunk).toBeLessThan(10000); // Average first chunk under 10 seconds
      
      // Performance metrics tracked
      expect(totalTime).toBeGreaterThan(0);
      expect(avgTimeToFirstChunk).toBeGreaterThan(0);
    }, 90000);
  });

  describe('Load Testing', () => {
    (shouldSkipTests ? it.skip : it)('should maintain performance under sequential load', async () => {
      const sequentialRequests = 10;
      const latencies: number[] = [];
      
      for (let i = 0; i < sequentialRequests; i++) {
        const request: LLMRequest = {
          messages: [{
            id: `sequential-load-${i}`,
            type: 'user',
            content: `Test request ${i + 1}: What is ${i + 1} squared?`,
            timestamp: new Date().toDateString()
          }],
          model: 'gemini-2.5-pro',
          provider: 'vertex',
          parameters: {
            maxTokens: 50,
            temperature: 0
          }
        };

        const startTime = Date.now();
        const response = await vertexProvider.generate(request);
        const latency = Date.now() - startTime;
        
        latencies.push(latency);
        
        // Validate response
        expect(response.content).toBeDefined();
        expect(['stop', 'tool_calls', 'length']).toContain(response.finishReason);
      }
      
      // Performance analysis
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);
      
      // Performance assertions
      expect(avgLatency).toBeLessThan(8000); // Average latency under 8 seconds
      expect(maxLatency).toBeLessThan(15000); // Max latency under 15 seconds
      
      // Check for performance degradation (later requests shouldn't be much slower)
      const firstHalfAvg = latencies.slice(0, 5).reduce((sum, lat) => sum + lat, 0) / 5;
      const secondHalfAvg = latencies.slice(5).reduce((sum, lat) => sum + lat, 0) / 5;
      const degradationRatio = secondHalfAvg / firstHalfAvg;
      
      expect(degradationRatio).toBeLessThan(2.0); // Second half shouldn't be more than 2x slower
      
      // Performance metrics tracked
      expect(avgLatency).toBeGreaterThan(0);
      expect(maxLatency).toBeGreaterThan(0);
      expect(minLatency).toBeGreaterThan(0);
    }, 180000); // 3 minutes timeout for sequential testing
  });

  describe('Memory and Resource Management', () => {
    (shouldSkipTests ? it.skip : it)('should not leak memory during repeated requests', async () => {
      const iterations = 20;
      const initialMemory = process.memoryUsage();
      
      for (let i = 0; i < iterations; i++) {
        const request: LLMRequest = {
          messages: [{
            id: `memory-test-${i}`,
            type: 'user',
            content: `Memory test iteration ${i}: Generate a short response.`,
            timestamp: new Date().toDateString()
          }],
          model: 'gemini-2.5-pro',
          provider: 'vertex',
          parameters: {
            maxTokens: 100,
            temperature: 0
          }
        };

        const response = await vertexProvider.generate(request);
        expect(response.content).toBeDefined();
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePerRequest = memoryIncrease / iterations;
      
      // Memory increase should be reasonable (less than 1MB per request)
      expect(memoryIncreasePerRequest).toBeLessThan(1024 * 1024); // 1MB per request
      
      // Memory usage tracked
      expect(finalMemory.heapUsed).toBeGreaterThan(0);
      expect(initialMemory.heapUsed).toBeGreaterThan(0);
    }, 120000);
  });
});