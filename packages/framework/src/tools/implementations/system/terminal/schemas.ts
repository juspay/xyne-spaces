import { z } from 'zod';

/**
 * Platform types for cross-platform support
 */
export const SUPPORTED_PLATFORMS = ['win32', 'darwin', 'linux'] as const;

/**
 * Shell types for different platforms
 */
export const SUPPORTED_SHELLS = ['bash', 'sh', 'zsh', 'cmd', 'powershell'] as const;

/**
 * Input schema for TerminalTool - simplified to match 's Bash tool
 */
export const TerminalToolInputSchema = z.object({
  command: z.string()
    .min(1, 'Command cannot be empty')
    .describe('The command to execute'),
  
  description: z.string()
    .optional()
    .describe('Clear, concise description of what this command does in 5-10 words'),
});

/**
 * Command execution metadata schema
 */
export const ExecutionMetadataSchema = z.object({
  platform: z.enum(SUPPORTED_PLATFORMS)
    .describe('Operating system platform'),
  
  shell: z.enum(SUPPORTED_SHELLS)
    .describe('Shell used for execution'),
  
  pid: z.number()
    .int()
    .positive()
    .describe('Process ID of the executed command'),
  
  startTime: z.date()
    .describe('Command execution start time'),
  
  endTime: z.date()
    .describe('Command execution end time'),
  
  workingDirectory: z.string()
    .min(1)
    .describe('Actual working directory used'),
  
  originalCommand: z.string()
    .describe('Original command as provided'),
  
  sanitizedCommand: z.string()
    .describe('Sanitized command actually executed'),
});

/**
 * Output schema for TerminalTool - simplified to match 's Bash tool
 */
export const TerminalToolOutputSchema = z.object({
  stdout: z.string()
    .describe('Standard output from the command'),
  
  stderr: z.string()
    .describe('Standard error output from the command'),
  
  exitCode: z.number()
    .int()
    .describe('Process exit code (0 typically means success)'),
  
  command: z.string()
    .describe('The command that was executed'),
  
  success: z.boolean()
    .describe('Whether the command executed successfully (exit code 0)'),
  
  executionTime: z.number()
    .min(0)
    .describe('Execution time in milliseconds'),
  
  truncated: z.boolean()
    .optional()
    .describe('Whether the output was truncated due to length limits'),
});

/**
 * Security validation result schema
 */
export const SecurityValidationSchema = z.object({
  allowed: z.boolean()
    .describe('Whether the command is allowed to execute'),
  
  reason: z.string()
    .optional()
    .describe('Reason for blocking if not allowed'),
  
  suggestions: z.array(z.string())
    .optional()
    .describe('Alternative suggestions if command is blocked'),
  
  riskLevel: z.enum(['low', 'medium', 'high', 'critical'])
    .describe('Risk level of the command'),
});

/**
 * LLM output schema for TerminalTool - clean, minimal output for LLM consumption
 */
export const TerminalToolLLMOutputSchema = z.union([
  z.object({
    stdout: z.string()
      .optional()
      .describe('Standard output from the command (only if non-empty)'),
    stderr: z.string()
      .optional()
      .describe('Standard error from the command (only if non-empty)'),
    exitCode: z.number()
      .int()
      .optional()
      .describe('Exit code of the command (only if non-zero)'),
    truncated: z.boolean()
      .optional()
      .describe('Whether the output was truncated due to length limits')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the command execution failed')
  })
]);

/**
 * TypeScript types derived from schemas
 */
export type TerminalToolInput = z.infer<typeof TerminalToolInputSchema>;
export type TerminalToolOutput = z.infer<typeof TerminalToolOutputSchema>;
export type TerminalToolLLMOutput = z.infer<typeof TerminalToolLLMOutputSchema>;
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;
export type SecurityValidation = z.infer<typeof SecurityValidationSchema>;
export type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];
export type SupportedShell = typeof SUPPORTED_SHELLS[number];