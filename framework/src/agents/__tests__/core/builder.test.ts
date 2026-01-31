import { AgentBuilder } from '../../core/builder.js';
import { Agent } from '../../core/agent.js';

describe('AgentBuilder', (): void => {
  let builder: AgentBuilder;

  beforeEach((): void => {
    builder = new AgentBuilder();
  });

  describe('Model configuration', (): void => {
    it('should configure Vertex model', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project', 'us-central1')
        .getConfig();

      expect(config.model.defaultModel).toBe('gemini-2.5-pro');
      expect(config.model.provider.type).toBe('vertex');
    });

    it('should configure LiteLLM model', (): void => {
      const config = builder
        .litellmModel('gpt-4', 'test-api-key', 'https://api.openai.com')
        .getConfig();

      expect(config.model.defaultModel).toBe('gpt-4');
      expect(config.model.provider.type).toBe('litellm');
    });

    it('should configure LiteLLM model without baseUrl', (): void => {
      const config = builder
        .litellmModel('gpt-4', 'test-api-key')
        .getConfig();

      expect(config.model.defaultModel).toBe('gpt-4');
      expect(config.model.provider.type).toBe('litellm');
    });
  });

  describe('Tool configuration', (): void => {
    beforeEach((): void => {
      builder.vertexModel('gemini-2.5-pro', 'test-project');
    });

    it('should configure tools', (): void => {
      const config = builder
        .tools(['tool1', 'tool2'])
        .getConfig();

      expect(config.tools.enabled).toEqual(['tool1', 'tool2']);
    });

    it('should add individual tools', (): void => {
      const config = builder
        .addTool('tool1')
        .addTool('tool2')
        .getConfig();

      expect(config.tools.enabled).toEqual(['tool1', 'tool2']);
    });

    it('should prevent duplicate tools', (): void => {
      const config = builder
        .addTool('tool1')
        .addTool('tool1')
        .getConfig();

      expect(config.tools.enabled).toEqual(['tool1']);
    });

    it('should configure individual tool settings', (): void => {
      const config = builder
        .addTool('tool1', { param: 'value' })
        .getConfig();

      expect(config.tools.enabled).toEqual(['tool1']);
      expect(config.tools.config['tool1']).toEqual({ param: 'value' });
    });

    it('should configure tool-specific settings', (): void => {
      const config = builder
        .toolConfig('tool1', { setting: 'value' })
        .getConfig();

      expect(config.tools.config['tool1']).toEqual({ setting: 'value' });
    });

    it('should configure tool timeout', (): void => {
      const config = builder
        .toolTimeout(10000)
        .getConfig();

      expect(config.tools.execution.timeout).toBe(10000);
    });
  });

  describe('Execution configuration', (): void => {
    beforeEach((): void => {
      builder.vertexModel('gemini-2.5-pro', 'test-project');
    });

    it('should configure max turns', (): void => {
      const config = builder
        .maxTurns(5)
        .getConfig();

      expect(config.execution.maxTurns).toBe(5);
    });

    it('should configure execution mode', (): void => {
      const singleConfig = builder
        .mode('single')
        .getConfig();

      expect(singleConfig.execution.mode).toBe('single');

      const continuousConfig = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', 'test-project')
        .mode('continuous')
        .getConfig();

      expect(continuousConfig.execution.mode).toBe('continuous');

      const interactiveConfig = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', 'test-project')
        .mode('interactive')
        .getConfig();

      expect(interactiveConfig.execution.mode).toBe('interactive');
    });

    it('should configure timeouts', (): void => {
      const config = builder
        .turnTimeout(30000)
        .llmTimeout(25000)
        .getConfig();

      expect(config.execution.timeouts.turn).toBe(30000);
      expect(config.execution.timeouts.llm).toBe(25000);
    });

    it('should configure execution limits', (): void => {
      const config = builder
        .limits({
          toolsPerTurn: 5,
          requestsPerTurn: 3,
          messageLength: 1000
        })
        .getConfig();

      expect(config.execution.limits.toolsPerTurn).toBe(5);
      expect(config.execution.limits.requestsPerTurn).toBe(3);
      expect(config.execution.limits.messageLength).toBe(1000);
    });

    it('should configure error handling', (): void => {
      const config = builder
        .errorHandling({
          continueOnToolError: false,
          maxRetries: 3,
          retryDelay: 1000
        })
        .getConfig();

      expect(config.execution.errorHandling.continueOnToolError).toBe(false);
      expect(config.execution.errorHandling.maxRetries).toBe(3);
      expect(config.execution.errorHandling.retryDelay).toBe(1000);
    });
  });

  describe('Fluent interface', (): void => {
    it('should chain method calls', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools(['tool1', 'tool2'])
        .maxTurns(3)
        .mode('continuous')
        .limits({ toolsPerTurn: 2 })
        .errorHandling({ continueOnToolError: true })
        .getConfig();

      expect(config.model.defaultModel).toBe('gemini-2.5-pro');
      expect(config.tools.enabled).toEqual(['tool1', 'tool2']);
      expect(config.execution.maxTurns).toBe(3);
      expect(config.execution.mode).toBe('continuous');
      expect(config.execution.limits.toolsPerTurn).toBe(2);
      expect(config.execution.errorHandling.continueOnToolError).toBe(true);
    });

    it('should return builder instance from each method', (): void => {
      const result1 = builder.vertexModel('gemini-2.5-pro', 'test-project');
      const result2 = result1.tools(['tool']);
      const result3 = result2.maxTurns(5);

      expect(result1).toBe(builder);
      expect(result2).toBe(builder);
      expect(result3).toBe(builder);
    });
  });

  describe('Configuration validation', (): void => {
    it('should validate config', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .validateConfig();

      expect(config.model.defaultModel).toBe('gemini-2.5-pro');
    });

    it('should handle validation errors gracefully', (): void => {
      // Builder with no model should potentially pass validation as it has defaults
      expect(() => {
        new AgentBuilder().validateConfig();
      }).not.toThrow();
    });
  });

  describe('Agent creation', (): void => {
    it('should create agent from builder', async (): Promise<void> => {
      const agent = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools(['tool1'])
        .maxTurns(3)
        .build();

      expect(agent).toBeInstanceOf(Agent);
      
      // Clean up
      await agent.dispose();
    });
  });

  describe('Builder utilities', (): void => {
    it('should clone builder', (): void => {
      const original = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools(['tool1']);

      const cloned = original.clone();
      
      expect(cloned).not.toBe(original);
      expect(cloned.getConfig()).toEqual(original.getConfig());
    });

    it('should reset builder', (): void => {
      builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools(['tool1'])
        .reset();

      const config = builder.getConfig();
      
      // After reset, should have default config (no model configured)
      expect(config.tools.enabled).toEqual([]);
    });
  });

  describe('Edge cases', (): void => {
    it('should handle empty tools array', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools([])
        .getConfig();

      expect(config.tools.enabled).toEqual([]);
    });

    it('should override previous configurations', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'project1')
        .vertexModel('gemini-2.0-flash', 'project2')
        .tools(['tool1'])
        .tools(['tool2'])
        .maxTurns(3)
        .maxTurns(5)
        .getConfig();

      expect(config.model.defaultModel).toBe('gemini-2.0-flash');
      expect(config.tools.enabled).toEqual(['tool2']);
      expect(config.execution.maxTurns).toBe(5);
    });

    it('should handle complex nested configurations', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project', 'europe-west1')
        .tools(['tool1', 'tool2'])
        .toolTimeout(30000)
        .toolConfig('tool1', { apiKey: 'test-key' })
        .maxTurns(10)
        .mode('interactive')
        .turnTimeout(60000)
        .llmTimeout(45000)
        .limits({
          toolsPerTurn: 5,
          requestsPerTurn: 3,
          messageLength: 2000
        })
        .errorHandling({
          continueOnToolError: true,
          maxRetries: 2,
          retryDelay: 500
        })
        .getConfig();

      expect(config.model.defaultModel).toBe('gemini-2.5-pro');
      expect(config.tools.enabled).toContain('tool1');
      expect(config.tools.execution.timeout).toBe(30000);
      expect(config.tools.config['tool1']).toEqual({ apiKey: 'test-key' });
      expect(config.execution.maxTurns).toBe(10);
      expect(config.execution.mode).toBe('interactive');
      expect(config.execution.timeouts.turn).toBe(60000);
      expect(config.execution.timeouts.llm).toBe(45000);
      expect(config.execution.limits.toolsPerTurn).toBe(5);
      expect(config.execution.errorHandling.maxRetries).toBe(2);
    });
  });

  describe('Default configuration', (): void => {
    it('should have sensible defaults', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .getConfig();

      expect(config.tools.enabled).toEqual([]);
      expect(config.tools.config).toEqual({});
      expect(['single', 'continuous', 'interactive']).toContain(config.execution.mode);
      expect(config.execution.maxTurns).toBeGreaterThan(0);
      expect(config.execution.limits).toBeDefined();
      expect(config.execution.errorHandling).toBeDefined();
      expect(config.execution.timeouts).toBeDefined();
    });
  });

  describe('Compacting configuration', (): void => {
    it('should enable compacting with default settings', (): void => {
      const config = builder
        .enableCompacting()
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(true);
      expect(config.execution.compacting?.threshold).toBe(95);
      expect(config.execution.compacting?.systemPrompt).toContain('Summarize this conversation');
      expect(config.execution.compacting?.contextMonitoring?.enabled).toBe(true);
      expect(config.execution.compacting?.contextMonitoring?.minThreshold).toBe(70);
    });

    it('should enable compacting with custom threshold and prompt', (): void => {
      const customPrompt = 'Custom compacting prompt for testing';
      const config = builder
        .enableCompacting(80, customPrompt)
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(true);
      expect(config.execution.compacting?.threshold).toBe(80);
      expect(config.execution.compacting?.systemPrompt).toBe(customPrompt);
    });

    it('should disable compacting', (): void => {
      const config = builder
        .enableCompacting() // First enable it
        .disableCompacting() // Then disable it
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(false);
      expect(config.execution.compacting?.threshold).toBeDefined();
      expect(config.execution.compacting?.systemPrompt).toBeDefined();
    });

    it('should configure compacting with detailed options', (): void => {
      const config = builder
        .compacting({
          enabled: true,
          threshold: 85,
          systemPrompt: 'Detailed compacting prompt',
          contextMonitoring: {
            enabled: false,
            minThreshold: 60,
          },
        })
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(true);
      expect(config.execution.compacting?.threshold).toBe(85);
      expect(config.execution.compacting?.systemPrompt).toBe('Detailed compacting prompt');
      expect(config.execution.compacting?.contextMonitoring?.enabled).toBe(false);
      expect(config.execution.compacting?.contextMonitoring?.minThreshold).toBe(60);
    });

    it('should configure context monitoring independently', (): void => {
      const config = builder
        .contextMonitoring(true, 75)
        .getConfig();

      expect(config.execution.compacting?.contextMonitoring?.enabled).toBe(true);
      expect(config.execution.compacting?.contextMonitoring?.minThreshold).toBe(75);
      expect(config.execution.compacting?.enabled).toBe(false); // Should default to false
    });

    it('should build agent with compacting enabled', async (): Promise<void> => {
      const agent = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .enableCompacting(90)
        .build();

      expect(agent).toBeInstanceOf(Agent);
      
      const status = agent.getStatus();
      expect(status.config.execution.compacting?.enabled).toBe(true);
      expect(status.config.execution.compacting?.threshold).toBe(90);
      
      await agent.dispose();
    });

    it('should chain compacting methods fluently', (): void => {
      const config = builder
        .vertexModel('gemini-2.5-pro', 'test-project')
        .enableCompacting(85, 'Custom prompt')
        .contextMonitoring(true, 65)
        .maxTurns(15)
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(true);
      expect(config.execution.compacting?.threshold).toBe(85);
      expect(config.execution.compacting?.systemPrompt).toBe('Custom prompt');
      expect(config.execution.compacting?.contextMonitoring?.enabled).toBe(true);
      expect(config.execution.compacting?.contextMonitoring?.minThreshold).toBe(65);
      expect(config.execution.maxTurns).toBe(15);
    });

    it('should handle partial compacting configuration', (): void => {
      const config = builder
        .compacting({
          enabled: true,
          threshold: 88,
          // systemPrompt not provided - should use default
          // contextMonitoring not provided - should use defaults
        })
        .getConfig();

      expect(config.execution.compacting?.enabled).toBe(true);
      expect(config.execution.compacting?.threshold).toBe(88);
      expect(config.execution.compacting?.systemPrompt).toContain('Summarize this conversation');
      expect(config.execution.compacting?.contextMonitoring?.enabled).toBe(true);
      expect(config.execution.compacting?.contextMonitoring?.minThreshold).toBe(70);
    });
  });
});