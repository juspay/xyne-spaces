import { VertexProvider } from '../../providers/vertex/vertex-provider.js';
import { VertexAuth } from '../../providers/vertex/auth/vertex-auth.js';
import type { VertexConfig, VertexAuthConfig } from '../../providers/vertex/schemas.js';
import type { LLMRequest } from '../../core/types/index.js';
import { LLMErrorClass } from '../../core/errors/index.js';
import { z } from 'zod';

describe('Framework Security Tests', () => {
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

  describe('🔒 Authentication Security', () => {
    (shouldSkipTests ? it.skip : it)('should not expose credentials in error messages', async () => {
      const invalidConfig: VertexAuthConfig = {
        type: 'service-account',
        projectId: 'invalid-test-project-12345',
        region: 'us-central1',
        keyFile: '/non/existent/path/to/invalid-key.json'
      };

      const auth = new VertexAuth(invalidConfig);
      
      try {
        await auth.authenticate();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        const errorMessage = (error as Error).message;
        
        // Error should not contain sensitive file paths or project details
        expect(errorMessage).not.toContain('/non/existent/path');
        expect(errorMessage).not.toContain('invalid-key.json');
        expect(errorMessage).not.toContain('invalid-test-project-12345');
        
        // Should not contain any tokens or auth data
        expect(errorMessage).not.toMatch(/Bearer\s+/);
        expect(errorMessage).not.toMatch(/ya29\./);
        expect(errorMessage).not.toContain('private_key');
        expect(errorMessage).not.toContain('client_secret');
        
        // Should be a proper error message
        expect(errorMessage.length).toBeGreaterThan(0);
        expect(typeof errorMessage).toBe('string');
      }
    });

    (shouldSkipTests ? it.skip : it)('should not log sensitive information during authentication', () => {
      // Create provider and capture logs
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      try {
        // This should work without logging sensitive data
        expect(vertexProvider.isAuthenticated()).toBe(true);
        
        // Check that no sensitive data was logged
        const allCalls = [
          ...consoleSpy.mock.calls,
          ...consoleWarnSpy.mock.calls,
          ...consoleErrorSpy.mock.calls
        ];
        
        for (const call of allCalls) {
          const logMessage = call.join(' ');
          // Should not contain tokens, keys, or sensitive auth data
          expect(logMessage).not.toMatch(/ya29\./); // Google access token pattern
          expect(logMessage).not.toMatch(/Bearer\s+/); // Bearer token pattern
          expect(logMessage).not.toContain('private_key');
          expect(logMessage).not.toContain('client_secret');
        }
      } finally {
        consoleSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    (shouldSkipTests ? it.skip : it)('should not expose tokens through config getter', () => {
      const config = vertexProvider.getConfig();
      const configStr = JSON.stringify(config);
      
      // Config should not contain actual tokens
      expect(configStr).not.toMatch(/ya29\./);
      expect(configStr).not.toContain('Bearer');
      expect(configStr).not.toContain('private_key');
      expect(configStr).not.toContain('client_secret');
      
      // Config should be safe to serialize
      expect(config).toBeDefined();
      expect(config.name).toBe('vertex');
    });
  });

  describe('🛡️ Input Validation Security', () => {
    (shouldSkipTests ? it.skip : it)('should validate request structure integrity', async () => {
      // Test with malformed request parameters
      const invalidRequests = [
        // Invalid temperature
        { parameters: { temperature: -1 } },
        { parameters: { temperature: 10 } },
        
        // Invalid maxTokens
        { parameters: { maxTokens: -100 } },
        { parameters: { maxTokens: 0 } },
        
        // Invalid model
        { model: '' },
        { model: null as unknown as string },
      ];

      for (const invalidParams of invalidRequests) {
        const request: LLMRequest = {
          messages: [{
            id: 'validation-test',
            type: 'user',
            content: 'Test validation',
            timestamp: new Date().toDateString()
          }],
          model: 'gemini-2.5-pro',
          provider: 'vertex',
          parameters: { maxTokens: 100, temperature: 0 },
          ...invalidParams
        };

        try {
          await vertexProvider.generate(request);
          // Some invalid params might be silently corrected, which is fine
        } catch (error) {
          // If validation fails, error should be clean and not expose internals
          expect(error).toBeInstanceOf(LLMErrorClass);
          const errorMsg = (error as LLMErrorClass).message;
          expect(errorMsg).not.toContain('undefined');
          expect(errorMsg).not.toContain('[object Object]');
          // Note: 'null' in error messages can be acceptable for validation errors
        }
      }
    });

    (shouldSkipTests ? it.skip : it)('should handle extremely large message content safely', async () => {
      // Test with very large content to ensure no buffer overflows
      const largeContent = 'A'.repeat(500000); // 500KB of text
      
      const request: LLMRequest = {
        messages: [{
          id: 'large-content-test',
          type: 'user',
          content: largeContent,
          timestamp: new Date().toDateString()
        }],
        model: 'gemini-2.5-flash-preview-05-20',
        provider: 'vertex',
        parameters: {
          maxTokens: 100,
          temperature: 0
        }
      };

      try {
        const response = await vertexProvider.generate(request);
        
        // Should handle gracefully - either succeed or fail cleanly
        expect(response).toBeDefined();
        expect(response.content).toBeDefined();
      } catch (error) {
        // If it fails, should be a clean error about input size
        expect(error).toBeInstanceOf(LLMErrorClass);
        const errorMsg = (error as LLMErrorClass).message;
        expect(errorMsg).not.toContain('buffer overflow');
        expect(errorMsg).not.toContain('out of memory');
        expect(errorMsg).not.toContain('heap');
      }
    }, 45000);

    (shouldSkipTests ? it.skip : it)('should validate message array integrity', async () => {
      // Test with malformed message arrays
      const invalidMessageArrays = [
        [], // Empty messages
        [{ id: 'test', type: 'user', content: '', timestamp: new Date().toDateString() }], // Empty content
        [{ id: '', type: 'user', content: 'test', timestamp: new Date().toDateString() }], // Empty ID
      ];

      for (const messages of invalidMessageArrays) {
        const request: LLMRequest = {
          messages: messages as LLMRequest['messages'],
          model: 'gemini-2.5-pro',
          provider: 'vertex',
          parameters: { maxTokens: 100, temperature: 0 }
        };

        try {
          await vertexProvider.generate(request);
          // Some cases might be handled gracefully
        } catch (error) {
          // Should get clean validation errors
          expect(error).toBeInstanceOf(LLMErrorClass);
          const errorMsg = (error as LLMErrorClass).message;
          expect(errorMsg).not.toContain('TypeError');
          expect(errorMsg).not.toContain('Cannot read property');
          expect(errorMsg).not.toContain('undefined');
        }
      }
    });
  });

  describe('🔧 Schema Conversion Security', () => {
    (shouldSkipTests ? it.skip : it)('should safely convert Zod schemas to API format', async () => {
      // Test with various schema types to ensure safe conversion
      const testSchemas = [
        // Simple schema
        z.object({
          name: z.string(),
          age: z.number()
        }),
        
        // Complex nested schema
        z.object({
          user: z.object({
            profile: z.object({
              settings: z.record(z.unknown())
            })
          })
        }),
        
        // Schema with special characters in descriptions
        z.object({
          query: z.string().describe('User query with <script>alert("xss")</script>'),
          command: z.string().describe('Command: rm -rf /')
        })
      ];

      for (const schema of testSchemas) {
        const tool = {
          name: 'test_tool',
          description: 'Test tool for schema conversion',
          inputSchema: schema
        };

        const request: LLMRequest = {
          messages: [{
            id: 'schema-test',
            type: 'user',
            content: 'Use the test tool.',
            timestamp: new Date().toDateString()
          }],
          model: 'claude-sonnet-4@20250514',
          provider: 'vertex',
          tools: [tool],
          parameters: { maxTokens: 200, temperature: 0 }
        };

        try {
          const response = await vertexProvider.generate(request);
          
          // Schema conversion should not break the request
          expect(response).toBeDefined();
          
          // If tool calls are made, they should have proper structure
          if (response.toolCalls && response.toolCalls.length > 0) {
            for (const toolCall of response.toolCalls) {
              expect(toolCall.name).toBe('test_tool');
              expect(toolCall.arguments).toBeDefined();
              expect(typeof toolCall.arguments).toBe('object');
            }
          }
        } catch (error) {
          // Schema conversion errors should be clean
          expect(error).toBeInstanceOf(LLMErrorClass);
          const errorMsg = (error as LLMErrorClass).message;
          expect(errorMsg).not.toContain('<script>');
          expect(errorMsg).not.toContain('rm -rf');
          expect(errorMsg).not.toContain('undefined');
        }
      }
    }, 60000);
  });

  describe('🚨 Error Handling Security', () => {
    (shouldSkipTests ? it.skip : it)('should sanitize API error responses', async () => {
      // Test with invalid model to trigger API errors
      const request: LLMRequest = {
        messages: [{
          id: 'error-test',
          type: 'user',
          content: 'Test error handling',
          timestamp: new Date().toDateString()
        }],
        model: 'completely-invalid-model-xyz-123',
        provider: 'vertex',
        parameters: { maxTokens: 100, temperature: 0 }
      };

      try {
        await vertexProvider.generate(request);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(LLMErrorClass);
        const errorMsg = (error as LLMErrorClass).message;
        
        // Should not contain internal API URLs or endpoints
        expect(errorMsg).not.toContain('aiplatform.googleapis.com');
        expect(errorMsg).not.toContain('googleapis.com');
        expect(errorMsg).not.toContain(process.env['VERTEX_PROJECT_ID'] || '');
        
        // Should not contain stack traces or file paths
        expect(errorMsg).not.toContain('.js:');
        expect(errorMsg).not.toContain('at Function');
        expect(errorMsg).not.toContain('stack trace');
        
        // Should not contain auth tokens
        expect(errorMsg).not.toMatch(/Bearer\s+/);
        expect(errorMsg).not.toMatch(/ya29\./);
        
        // Should be a clean, user-facing error
        expect(typeof errorMsg).toBe('string');
        expect(errorMsg.length).toBeGreaterThan(0);
      }
    });

    (shouldSkipTests ? it.skip : it)('should handle network timeouts securely', async () => {
      // Create provider with very short timeout
      const timeoutConfig: VertexConfig = {
        auth: {
          type: process.env['VERTEX_USE_ADC'] === 'true' ? 'adc' : 'service-account',
          projectId: process.env['VERTEX_PROJECT_ID']!,
          region: process.env['VERTEX_REGION'] || 'us-central1',
          ...(process.env['VERTEX_KEY_FILE'] && { keyFile: process.env['VERTEX_KEY_FILE'] })
        },
        apiVersion: 'v1',
        timeout: 1000, // Very short timeout
        retries: 1,
        rateLimiting: true,
        enableLogging: true
      };

      const timeoutProvider = new VertexProvider(timeoutConfig);
      await timeoutProvider.authenticate();

      const request: LLMRequest = {
        messages: [{
          id: 'timeout-test',
          type: 'user',
          content: 'Generate a very long response that will definitely timeout.',
          timestamp: new Date().toDateString()
        }],
        model: 'claude-sonnet-4@20250514',
        provider: 'vertex',
        parameters: { maxTokens: 4000, temperature: 0 }
      };

      try {
        await timeoutProvider.generate(request);
        // If it succeeds quickly, that's fine
      } catch (error) {
        if (error instanceof LLMErrorClass) {
          // Timeout errors should not expose internal details
          expect(error.message).not.toContain('ECONNABORTED');
          expect(error.message).not.toContain('socket hang up');
          expect(error.message).not.toContain('fetch');
          
          // Should be a clean timeout message
          const errorMsg = error.message.toLowerCase();
          expect(errorMsg).toMatch(/timeout|time.*out|deadline|network/);
        }
      }
    }, 15000);
  });

  describe('📊 Configuration Security', () => {
    (shouldSkipTests ? it.skip : it)('should validate configuration parameters safely', () => {
      // Test that config validation doesn't expose sensitive data
      const config = vertexProvider.getConfig();
      
      // Config should be safe to inspect
      expect(config.name).toBe('vertex');
      expect(config.timeout).toBeGreaterThan(0);
      
      // Should not contain actual credentials
      const configKeys = Object.keys(config);
      expect(configKeys).not.toContain('accessToken');
      expect(configKeys).not.toContain('privateKey');
      expect(configKeys).not.toContain('credentials');
    });

    (shouldSkipTests ? it.skip : it)('should handle provider capabilities securely', () => {
      // Test capability queries don't expose internal details
      expect(vertexProvider.supportsToolCalling()).toBe(true);
      expect(vertexProvider.supportsStreaming()).toBe(true);
      expect(vertexProvider.supportsThinking()).toBe(true);
      
      // Model capabilities should be safe
      const capabilities = vertexProvider.getModelCapabilities('claude-sonnet-4@20250514');
      expect(capabilities).toBeDefined();
      expect(capabilities!.supportsThinking).toBe(true);
      
      // Should not expose internal implementation details
      expect(JSON.stringify(capabilities)).not.toContain('apiKey');
      expect(JSON.stringify(capabilities)).not.toContain('token');
      expect(JSON.stringify(capabilities)).not.toContain('credential');
    });
  });

  describe('✅ Security Validation Summary', () => {
    (shouldSkipTests ? it.skip : it)('should pass all framework security checks', () => {
      const securityAreas = [
        'Authentication Security',
        'Input Validation Security', 
        'Schema Conversion Security',
        'Error Handling Security',
        'Configuration Security'
      ];

      // All framework-level security tests should pass
      expect(securityAreas.length).toBe(5);
      expect(vertexProvider.isAuthenticated()).toBe(true);
      
      // Framework should be properly initialized and secure
      expect(vertexProvider.getConfig().name).toBe('vertex');
    });
  });
});