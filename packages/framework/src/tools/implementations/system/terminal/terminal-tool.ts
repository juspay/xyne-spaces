import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { 
  createToolValidationError,
  createToolExecutionError,
  ToolValidationErrorClass,
  ToolExecutionErrorClass
} from '../../../core/errors.js';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { logger } from '../../../../utils/logger.js';
import type { z } from 'zod';
import {
  TerminalToolInputSchema,
  TerminalToolOutputSchema,
  TerminalToolLLMOutputSchema,
  type TerminalToolInput,
  type TerminalToolOutput,
  type TerminalToolLLMOutput,
} from './schemas.js';
import {
  validateCommand,
  sanitizeCommand,
} from './security.js';
import { CommandExecutor, detectPlatform } from './command-executor.js';
import { smartTruncateOutput } from './output-truncation.js';

/**
 * Maximum character limit for bash output to match behavior
 */
const MAX_OUTPUT_CHARACTERS = 30000;

/**
 * Terminal tool for executing shell commands - simplified to match Bash tool
 */
@Tool({
  name: 'bash',
  description: 'Executes a given bash command in a persistent shell session',
  category: 'system',
  version: '1.0.0',
  inputSchema: TerminalToolInputSchema,
  outputSchema: TerminalToolOutputSchema,
  llmOutputSchema: TerminalToolLLMOutputSchema,
})
export class TerminalTool extends BaseTool<TerminalToolInput, TerminalToolOutput, TerminalToolLLMOutput> {
  protected readonly inputSchema = TerminalToolInputSchema as z.ZodType<TerminalToolInput>;
  protected readonly outputSchema = TerminalToolOutputSchema as z.ZodType<TerminalToolOutput>;
  protected readonly toolName = 'bash';

  /**
   * Extract minimal content for LLM - only include non-empty values
   */
  public getLLMOutput(result: ToolExecutionResult<TerminalToolOutput>): TerminalToolLLMOutput {
    if (!result.success) {
      return { 
        error: result.error?.message || 'Command execution failed' 
      };
    }

    if (!result.data) {
      return { 
        error: 'No data returned from command execution' 
      };
    }

    const data = result.data;
    const output: { stdout?: string; stderr?: string; exitCode?: number; truncated?: boolean } = {};

    // Include stdout only if non-empty
    if (data.stdout && data.stdout.trim()) {
      output.stdout = data.stdout;
    }

    // Include stderr only if non-empty
    if (data.stderr && data.stderr.trim()) {
      output.stderr = data.stderr;
    }

    // Include exitCode only if non-zero OR if no stdout/stderr (to indicate success)
    if (data.exitCode !== 0 || (!output.stdout && !output.stderr)) {
      output.exitCode = data.exitCode;
    }

    // Include truncated flag if output was truncated
    if (data.truncated) {
      output.truncated = data.truncated;
    }

    return output;
  }
  
  private readonly commandExecutor: CommandExecutor;

  constructor() {
    super();
    this.commandExecutor = new CommandExecutor();
  }

  protected async executeInternal(
    input: TerminalToolInput,
    context: ToolExecutionContext
  ): Promise<TerminalToolOutput> {
    const startTime = Date.now();
    
    logger.info('Bash tool execution started', {
      command: input.command,
      executionId: context.executionId,
    });

    try {
      // Step 1: Minimal security validation (before sanitization)
      const platform = detectPlatform();
      const securityValidation = validateCommand(input.command, platform);
      
      if (!securityValidation.allowed) {
        throw new ToolExecutionErrorClass(createToolExecutionError(
          this.toolName,
          `Command not allowed: ${securityValidation.reason}`,
          undefined,
          { originalCommand: input.command }
        ));
      }

      // Step 2: Basic sanitization - just remove null bytes and trim
      const sanitizedCommand = sanitizeCommand(input.command);
      if (!sanitizedCommand) {
        throw new ToolValidationErrorClass(createToolValidationError(
          this.toolName,
          ['Command is empty after sanitization'],
          { originalCommand: input.command }
        ));
      }

      // Step 3: Execute command directly
      const executionInput: TerminalToolInput = {
        command: sanitizedCommand,
      };

      logger.debug('Executing command', {
        sanitizedCommand,
        executionId: context.executionId,
      });

      const executionResult = await this.commandExecutor.executeCommand(executionInput, context.abortSignal, this.getEffectiveCwd(context));

      // Step 4: Simple output processing with truncation
      const executionTime = Date.now() - startTime;
      
      // Apply smart truncation to stdout and stderr
      const stdoutResult = smartTruncateOutput(executionResult.stdout || '', MAX_OUTPUT_CHARACTERS);
      const stderrResult = smartTruncateOutput(executionResult.stderr || '', MAX_OUTPUT_CHARACTERS);
      const wasTruncated = stdoutResult.wasTruncated || stderrResult.wasTruncated;
      
      const result: TerminalToolOutput = {
        stdout: stdoutResult.content,
        stderr: stderrResult.content,
        exitCode: executionResult.exitCode,
        command: sanitizedCommand,
        success: executionResult.exitCode === 0,
        executionTime,
        truncated: wasTruncated || undefined, // Only include if true
      };

      logger.info('Bash tool execution completed', {
        success: result.success,
        exitCode: result.exitCode,
        executionTime,
        truncated: wasTruncated,
        executionId: context.executionId,
      });

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      logger.error('Bash tool execution failed', error instanceof Error ? error : new Error('Unknown error'), {
        command: input.command,
        executionTime,
        executionId: context.executionId,
      });

      // Re-throw tool errors as-is
      if (error instanceof ToolValidationErrorClass || error instanceof ToolExecutionErrorClass) {
        throw error;
      }

      // Wrap other errors
      throw new ToolExecutionErrorClass(createToolExecutionError(
        this.toolName,
        `Bash execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
        { originalCommand: input.command, executionTime }
      ));
    }
  }

  /**
   * Cleanup method to terminate any running processes
   */
  cleanup(): void {
    logger.info('Cleaning up terminal tool resources');
    this.commandExecutor.cleanup();
  }

  /**
   * Get tool usage examples for documentation
   */
  static getUsageExamples(): Array<{
    description: string;
    input: TerminalToolInput;
    expectedBehavior: string;
  }> {
    return [
      {
        description: 'List directory contents',
        input: {
          command: 'ls -la',
          description: 'Lists files in current directory',
        },
        expectedBehavior: 'Returns detailed directory listing with file permissions and sizes',
      },
      {
        description: 'Check system information',
        input: {
          command: 'uname -a',
          description: 'Shows system information',
        },
        expectedBehavior: 'Returns system information including OS, kernel version, and architecture',
      },
      {
        description: 'Run npm command',
        input: {
          command: 'npm --version',
          description: 'Checks npm version',

        },
        expectedBehavior: 'Returns npm version number',
      },
      {
        description: 'Check file contents',
        input: {
          command: 'cat package.json',
          description: 'Shows package.json contents',

        },
        expectedBehavior: 'Returns file contents with proper error handling',
      },
      {
        description: 'Network connectivity test',
        input: {
          command: 'ping -c 3 google.com',
          description: 'Tests network connectivity',

        },
        expectedBehavior: 'Tests network connectivity with timeout protection',
      },
    ];
  }

  /**
   * Get security guidelines for safe usage
   */
  static getSecurityGuidelines(): string[] {
    return [
      'Minimal security validation - relies on system permissions',
      'Only blocks commands with null bytes that could cause execution issues',
      'Execution time is limited with fixed 2-minute timeout',
      'All command executions are logged for audit purposes',
      'Cross-platform compatibility with appropriate shell detection',
      'Process cleanup ensures no orphaned processes remain',
      'Most commands are allowed and depend on underlying system security',
    ];
  }
}