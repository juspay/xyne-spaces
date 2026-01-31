import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ConversationCompactor } from '../conversation-compactor.js';
import type { LLMClientConfig } from '../../../core/types/config.js';
import type { Message } from '../../../core/types/messages.js';

// Mock the LLMClient
jest.mock('../../../client/llm-client.js');

describe('ConversationCompactor', () => {
  let compactor: ConversationCompactor;
  let mockConfig: LLMClientConfig;

  beforeEach(() => {
    mockConfig = {
      provider: {
        type: 'vertex',
        config: {
          auth: {
            type: 'adc',
            projectId: 'test-project',
            region: 'us-central1'
          },
          apiVersion: 'v1',
          timeout: 30000,
          retries: 3,
          rateLimiting: true,
          enableLogging: false
        }
      },
      defaultModel: 'gemini-2.5-pro'
    };

    compactor = new ConversationCompactor(mockConfig, 'gemini-2.5-pro');
  });

  afterEach(() => {
    compactor.dispose();
  });

  describe('getTokenCount', () => {
    it('should return token count for messages', async () => {
      const messages: Message[] = [
        { type: 'user', content: 'Hello', id: '1', timestamp: '2024-01-01T00:00:00Z' },
        { type: 'assistant', content: 'Hi there!', id: '2', timestamp: '2024-01-01T00:01:00Z' }
      ];

      const [_, tokenCount] = await compactor.getTokenUsagePercentage(messages, [], 1000);
      expect(typeof tokenCount).toBe('number');
      expect(tokenCount).toBeGreaterThan(0);
    });
  });

  describe('getTokenUsagePercentage', () => {
    it('should calculate usage percentage correctly', async () => {
      const messages: Message[] = [
        { type: 'user', content: 'Hello', id: '1', timestamp: '2024-01-01T00:00:00Z' }
      ];

      const [percentage, _] = await compactor.getTokenUsagePercentage(messages, [], 1000);
      expect(typeof percentage).toBe('number');
      expect(percentage).toBeGreaterThanOrEqual(0);
      expect(percentage).toBeLessThanOrEqual(100);
    });
  });

  describe('getTokenCountingInfo', () => {
    it('should return token counting capabilities', () => {
      const info = compactor.getTokenCountingInfo();
      
      expect(info).toHaveProperty('supportsNativeCounting');
      expect(info).toHaveProperty('contextWindow');
      expect(info).toHaveProperty('provider');
      expect(info).toHaveProperty('model');
      
      expect(typeof info.supportsNativeCounting).toBe('boolean');
      expect(typeof info.contextWindow).toBe('number');
      expect(info.provider).toBe('vertex');
      expect(info.model).toBe('gemini-2.5-pro');
    });
  });
});

describe('ConversationCompactor Integration', () => {
  it('should handle different provider configurations', () => {
    const vertexConfig: LLMClientConfig = {
      provider: {
        type: 'vertex',
        config: {
          auth: {
            type: 'adc',
            projectId: 'test-project',
            region: 'us-central1'
          },
          apiVersion: 'v1',
          timeout: 30000,
          retries: 3,
          rateLimiting: true,
          enableLogging: false
        }
      },
      defaultModel: 'gemini-2.5-pro'
    };

    const litellmConfig: LLMClientConfig = {
      provider: {
        type: 'litellm',
        config: {
          apiKey: 'test-key',
          timeout: 30000,
          retries: 3,
          rateLimiting: true,
          enableLogging: false
        }
      },
      defaultModel: 'gpt-4'
    };

    const vertexCompactor = new ConversationCompactor(vertexConfig, 'gemini-2.5-pro');
    const litellmCompactor = new ConversationCompactor(litellmConfig, 'gpt-4');

    expect(vertexCompactor.getTokenCountingInfo().provider).toBe('vertex');
    expect(litellmCompactor.getTokenCountingInfo().provider).toBe('litellm');

    vertexCompactor.dispose();
    litellmCompactor.dispose();
  });
});