/**
 * Example: Development Loop Workflow
 *
 * Demonstrates the research->implement->build->fix loop using the workflow framework
 */

import { createWorkflow, createInitialWorkflowState } from '../index.js';
import { AgentBuilder } from '../../agents/core/builder.js';
import type { AgentConfig } from '../../agents/core/config.js';
import type { Message } from '../../llm/core/types/index.js';

// ============================================================================
// Context Type Definition
// ============================================================================

interface DevelopmentContext {
  // Project information
  projectId: string;
  requirements: string;

  // Research phase
  research?: {
    findings: string;
    approach: string;
    technologies: string[];
  };

  // Implementation phase
  implementation?: {
    code: string;
    files: Record<string, string>;
    architecture: string;
  };

  // Build phase
  buildSuccess?: boolean;
  buildErrors?: string[];
  buildOutput?: string;
  buildArtifacts?: string[];

  // Testing phase
  testResults?: {
    passed: number;
    failed: number;
    total: number;
    allPassed: boolean;
    failureDetails: string[];
  };

  // Loop control
  maxRetries?: number;
  currentRetry?: number;
  previousErrors?: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

function createResearchAgentConfig(_state: { context: DevelopmentContext }): AgentConfig {
  return new AgentBuilder()
    .vertexModel('claude-sonnet-4@20250514', 'dev-ai-epsilon', 'us-east5')
    .tools(['web_search', 'code_analysis'])
    .maxTurns(3)
    .getConfig();
}

function createImplementationAgentConfig(_state: { context: DevelopmentContext }): AgentConfig {
  return new AgentBuilder()
    .vertexModel('claude-sonnet-4@20250514', 'dev-ai-epsilon', 'us-east5')
    .tools(['code_write', 'file_edit', 'code_analysis'])
    .maxTurns(5)
    .getConfig();
}

function createTestAgentConfig(_state: { context: DevelopmentContext }): AgentConfig {
  return new AgentBuilder()
    .vertexModel('claude-sonnet-4@20250514', 'dev-ai-epsilon', 'us-east5')
    .tools(['test_runner', 'code_write', 'file_edit'])
    .maxTurns(3)
    .getConfig();
}

async function runTypescriptBuild(_implementation: unknown): Promise<{
  success: boolean;
  errors: string[];
  output: string;
  artifacts?: string[];
}> {
  // Mock TypeScript build process
  // In real implementation, this would:
  // 1. Write code files to temporary directory
  // 2. Run tsc or build tool
  // 3. Capture output and errors
  // 4. Return results

  // Simulate build process
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Mock result - in real scenario this would be actual build results
  const hasErrors = Math.random() > 0.7; // 30% failure rate for demo

  if (hasErrors) {
    return {
      success: false,
      errors: [
        'Type error: Property "nonExistentProperty" does not exist on type "MyType"',
        'Syntax error: Unexpected token in file.ts:42'
      ],
      output: 'Build failed with 2 errors'
    };
  }

  return {
    success: true,
    errors: [],
    output: 'Build completed successfully',
    artifacts: ['dist/index.js', 'dist/types.d.ts']
  };
}

async function runTestSuite(_artifacts: string[]): Promise<{
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}> {
  // Mock test runner
  // In real implementation, this would run actual tests

  await new Promise(resolve => setTimeout(resolve, 500));

  const testPassed = Math.random() > 0.4; // 60% pass rate for demo

  if (testPassed) {
    return {
      passed: 5,
      failed: 0,
      total: 5,
      failures: []
    };
  }

  return {
    passed: 3,
    failed: 2,
    total: 5,
    failures: [
      'Test "should handle edge case" failed: Expected true but got false',
      'Test "should validate input" failed: Validation error not thrown'
    ]
  };
}

// ============================================================================
// Development Loop Workflow
// ============================================================================

/**
 * Create the development loop workflow
 */
export function createDevelopmentWorkflow(): import('../core/workflow-engine.js').WorkflowExecutor<DevelopmentContext> {
  return createWorkflow<DevelopmentContext>()

    // Research step - analyze requirements and determine approach
    .addAgenticStep({
      name: 'research',
      agenticConfig: (state) => Promise.resolve(createResearchAgentConfig(state)),
      systemPrompt: (state) => Promise.resolve(`You are a senior software architect and researcher.

Your task is to research and analyze requirements to determine the best implementation approach.

Current requirements: ${state.context.requirements}

${state.context.previousErrors ? `
Previous build errors to consider:
${state.context.previousErrors.join('\n')}
` : ''}

Please provide:
1. Research findings and analysis
2. Recommended technical approach
3. Technologies and frameworks to use
4. Architecture considerations`),
      after: (state, result) => {
        // Extract research findings from agent conversation
        const lastMessage = result.messages[result.messages.length - 1];
        const content = lastMessage?.content || '';

        // Simple extraction - in real implementation, this would be more sophisticated
        state.context.research = {
          findings: content,
          approach: 'TypeScript implementation with modern tooling',
          technologies: ['TypeScript', 'Node.js', 'Jest']
        };

        // Add conversation to global message history
        state.messages.push(...result.messages);

        return Promise.resolve(state);
      }
    })

    // Implementation step - write code based on research
    .addAgenticStep({
      name: 'implement',
      agenticConfig: (state) => Promise.resolve(createImplementationAgentConfig(state)),
      systemPrompt: (state) => Promise.resolve(`You are an expert software developer.

Implement the solution based on the research findings.

Research findings: ${state.context.research?.findings || 'No research available'}
Recommended approach: ${state.context.research?.approach || 'No approach specified'}

${state.context.previousErrors ? `
Previous build errors to fix:
${state.context.previousErrors.join('\n')}
` : ''}

${state.context.buildOutput ? `
Previous build output:
${state.context.buildOutput}
` : ''}

Please provide complete, working implementation code.`),
      before: (state) => {
        // Prepare context for implementation
        if (state.context.buildErrors?.length) {
          state.context.previousErrors = state.context.buildErrors;
        }
        state.context.currentRetry = (state.context.currentRetry || 0) + 1;
        return Promise.resolve(state);
      },
      after: (state, result) => {
        // Extract implementation from agent conversation
        const lastMessage = result.messages[result.messages.length - 1];
        const content = lastMessage?.content || '';

        state.context.implementation = {
          code: content,
          files: { 'indexTs': content },
          architecture: 'Modular TypeScript implementation'
        };

        // Add conversation to global message history
        state.messages.push(...result.messages);

        return Promise.resolve(state);
      }
    })

    // Build step - compile and validate the implementation
    .addFunctionStep({
      name: 'build',
      handler: async (state) => {
        if (!state.context.implementation) {
          throw new Error('No implementation available for build');
        }

        // Run the build process
        const buildResult = await runTypescriptBuild(state.context.implementation);

        // Update state with build results
        state.context.buildSuccess = buildResult.success;
        state.context.buildErrors = buildResult.errors;
        state.context.buildOutput = buildResult.output;

        if (buildResult.artifacts) {
          state.context.buildArtifacts = buildResult.artifacts;
        }

        // Add build result as a message for context
        const buildMessage: Message = {
          id: `build_${Date.now()}`,
          type: 'system',
          content: `Build ${buildResult.success ? 'succeeded' : 'failed'}: ${buildResult.output}${buildResult.errors.length ? '\nErrors:\n' + buildResult.errors.join('\n') : ''}`,
          timestamp: new Date().toISOString()
        };

        state.messages.push(buildMessage);

        return state;
      }
    })

    // Test step - run tests on successful builds
    .addAgenticStep({
      name: 'test',
      agenticConfig: (state) => Promise.resolve(createTestAgentConfig(state)),
      systemPrompt: (state) => Promise.resolve(`You are a QA engineer and test automation expert.

Create comprehensive tests for the implemented solution.

Implementation: ${state.context.implementation?.code || 'No implementation available'}

${state.context.testResults?.failureDetails ? `
Previous test failures to address:
${state.context.testResults.failureDetails.join('\n')}
` : ''}

Please create and run appropriate tests.`),
      after: async (state, result) => {
        // Run actual tests if we have artifacts
        if (state.context.buildArtifacts?.length) {
          const testResult = await runTestSuite(state.context.buildArtifacts);

          state.context.testResults = {
            passed: testResult.passed,
            failed: testResult.failed,
            total: testResult.total,
            allPassed: testResult.failed === 0,
            failureDetails: testResult.failures
          };
        }

        // Add conversation to global message history
        state.messages.push(...result.messages);

        return state;
      }
    })

    // Build the execution graph
    .createGraph()

    // Execute the workflow steps
    .execute('research')
    .execute('implement')
    .execute('build')

    // Conditional: Check build success
    .conditionalExecute({
      handler: (state) => {
        if (state.context.buildSuccess) {
          return Promise.resolve('success');
        }
        // Check retry limit
        const maxRetries = state.context.maxRetries || 5;
        const currentRetry = state.context.currentRetry || 0;

        if (currentRetry >= maxRetries) {
          return Promise.resolve('maxRetries');
        }

        return Promise.resolve('retry');
      },
      paths: {
        'success': 'test',        // Go to testing
        'retry': 'implement',     // Retry implementation with errors
        'maxRetries': 'exit'      // Give up after max retries
      }
    })

    .execute('test')

    // Conditional: Check test results
    .conditionalExecute({
      handler: (state) => {
        if (state.context.testResults?.allPassed) {
          return Promise.resolve('complete');
        }
        // Check retry limit for test fixes
        const maxRetries = state.context.maxRetries || 5;
        const currentRetry = state.context.currentRetry || 0;

        if (currentRetry >= maxRetries) {
          return Promise.resolve('maxRetries');
        }

        return Promise.resolve('fix');
      },
      paths: {
        'complete': 'exit',       // All done!
        'fix': 'implement',       // Back to implementation to fix test failures
        'maxRetries': 'exit'      // Give up after max retries
      }
    })

    .build();
}

// ============================================================================
// Usage Example
// ============================================================================

export async function runDevelopmentExample(): Promise<unknown> {
  const workflow = createDevelopmentWorkflow();

  const initialState = createInitialWorkflowState('research', {
    projectId: 'demo-project',
    requirements: 'Create a TypeScript utility function that validates email addresses with comprehensive error handling and unit tests',
    maxRetries: 3,
    currentRetry: 0
  }, 'development-example-' + Date.now());

  // eslint-disable-next-line no-console
  console.log('Starting development workflow...');

  const result = await workflow.start(initialState);

  // eslint-disable-next-line no-console
  console.log('Workflow completed:', {
    status: result.status,
    totalIterations: result.metadata.totalIterations,
    duration: result.metadata.totalDuration,
    nodesExecuted: result.metadata.nodesExecuted
  });

  if (result.status === 'completed') {
    // eslint-disable-next-line no-console
    console.log('Final context:', {
      buildSuccess: result.state.context.buildSuccess,
      testResults: result.state.context.testResults,
      messageCount: result.state.messages.length
    });
  }

  if (result.error) {
    // eslint-disable-next-line no-console
    console.error('Workflow error:', result.error.message);
  }

  return result;
}