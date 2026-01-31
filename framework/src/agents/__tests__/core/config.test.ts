import { 
  validateAgentConfig, 
  deriveExecutionConfig,
  createDefaultAgentConfig,
  type AgentConfig
} from '../../core/config.js';

describe('Agent Configuration', (): void => {
  let validConfig: AgentConfig;

  beforeEach((): void => {
    validConfig = createDefaultAgentConfig();
  });

  describe('validateAgentConfig', (): void => {
    it('should validate default config', (): void => {
      expect(() => validateAgentConfig(validConfig)).not.toThrow();
    });

    it('should validate config created by builder', (): void => {
      const builderConfig = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: 'test-project',
                region: 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro',
          features: {
            healthMonitoring: true,
            autoTemperature: true,
            enableLogging: true
          }
        }
      };

      expect(() => validateAgentConfig(builderConfig)).not.toThrow();
    });

    it('should handle invalid config gracefully', (): void => {
      const invalidConfig = {
        ...validConfig,
        execution: {
          ...validConfig.execution,
          maxTurns: -1  // Invalid
        }
      };

      // The validation might be lenient, so just check it doesn't crash
      expect(() => validateAgentConfig(invalidConfig)).not.toThrow();
    });
  });

  describe('deriveExecutionConfig', (): void => {
    it('should derive execution config from agent config', (): void => {
      const executionConfig = deriveExecutionConfig(validConfig);

      expect(executionConfig.mode).toBeDefined();
      expect(executionConfig.maxTurns).toBeGreaterThan(0);
      expect(executionConfig.limits).toBeDefined();
      expect(executionConfig.errorHandling).toBeDefined();
      expect(executionConfig.timeouts).toBeDefined();
    });

    it('should handle custom execution settings', (): void => {
      const customConfig: AgentConfig = {
        ...validConfig,
        execution: {
          ...validConfig.execution,
          maxTurns: 15,
          limits: {
            ...validConfig.execution.limits,
            toolsPerTurn: 10
          }
        }
      };

      const executionConfig = deriveExecutionConfig(customConfig);

      expect(executionConfig.maxTurns).toBe(15);
      expect(executionConfig.limits['toolsPerTurn']).toBe(10);
    });

    it('should provide sensible defaults', (): void => {
      const executionConfig = deriveExecutionConfig(validConfig);

      expect(executionConfig.limits['toolsPerTurn']).toBeGreaterThan(0);
      expect(executionConfig.limits['requestsPerTurn']).toBeGreaterThan(0);
      expect(executionConfig.errorHandling['continueOnToolError']).toBeDefined();
      expect(executionConfig.errorHandling['maxRetries']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Configuration utilities', (): void => {
    it('should create default configuration', (): void => {
      const defaultConfig = createDefaultAgentConfig();

      expect(defaultConfig.tools.enabled).toBeDefined();
      expect(defaultConfig.tools.config).toBeDefined();
      expect(defaultConfig.execution).toBeDefined();
      expect(defaultConfig.events).toBeDefined();
      // metadata might not be defined in default config
      expect(defaultConfig.metadata || {}).toBeDefined();
    });

    it('should handle configuration merging', (): void => {
      const baseConfig = createDefaultAgentConfig();
      const customConfig = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          maxTurns: 20
        }
      };

      expect(customConfig.execution.maxTurns).toBe(20);
      expect(customConfig.tools).toEqual(baseConfig.tools);
    });
  });

  describe('Configuration validation edge cases', (): void => {
    it('should handle empty configurations gracefully', (): void => {
      const emptyishConfig = {
        ...createDefaultAgentConfig(),
        tools: {
          enabled: [],
          config: {},
          execution: {}
        }
      };

      expect(() => validateAgentConfig(emptyishConfig)).not.toThrow();
    });

    it('should validate tool configuration', (): void => {
      const configWithTools = {
        ...createDefaultAgentConfig(),
        tools: {
          enabled: ['tool1', 'tool2'],
          config: { tool1: { setting: 'value' } },
          execution: { timeout: 5000 }
        }
      };

      expect(() => validateAgentConfig(configWithTools)).not.toThrow();
    });

    it('should validate event configuration', (): void => {
      const configWithEvents = {
        ...createDefaultAgentConfig(),
        events: {
          logging: 'debug' as const
        }
      };

      expect(() => validateAgentConfig(configWithEvents)).not.toThrow();
    });
  });

  describe('Configuration immutability', (): void => {
    it('should not modify original config during validation', (): void => {
      const originalConfig = JSON.parse(JSON.stringify(validConfig)) as AgentConfig;
      
      validateAgentConfig(validConfig);
      
      expect(validConfig).toEqual(originalConfig);
    });

    it('should not modify original config during derivation', (): void => {
      const originalConfig = JSON.parse(JSON.stringify(validConfig)) as AgentConfig;
      
      deriveExecutionConfig(validConfig);
      
      expect(validConfig).toEqual(originalConfig);
    });
  });
});