import { spawn } from 'child_process';
import { platform } from 'os';
import type { 
  SupportedPlatform, 
  TerminalToolInput 
} from './schemas.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Command execution result - simplified to match 's approach
 */
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Platform detection utility
 */
export function detectPlatform(): SupportedPlatform {
  const osPlatform = platform();
  switch (osPlatform) {
    case 'win32':
      return 'win32';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      // Default to linux for unknown platforms
      return 'linux';
  }
}

/**
 * Simple command executor - simplified to match 's approach
 */
export class CommandExecutor {
  /**
   * Execute a command with basic timeout handling and abort signal support
   */
  async executeCommand(input: TerminalToolInput, abortSignal?: AbortSignal, cwd?: string): Promise<ExecutionResult> {
    const command = input.command.trim();
    const timeout = 10800000; // Fixed 180 minutes timeout
    
    logger.debug('Executing command', {
      command,
      timeout,
    });

    return new Promise<ExecutionResult>((resolve, reject) => {
      // Check if already aborted
      if (abortSignal?.aborted) {
        reject(new Error('Command execution was aborted before starting'));
        return;
      }

      // Determine shell and arguments based on platform
      const currentPlatform = detectPlatform();
      let executable: string;
      let args: string[];

      if (currentPlatform === 'win32') {
        executable = 'cmd';
        args = ['/c', command];
      } else {
        executable = 'bash';
        args = ['-c', command];
      }

      // Spawn the process
      const childProcess = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        cwd: cwd || process.cwd(),
      });

      let stdout = '';
      let stderr = '';
      let finished = false;

      const cleanup = (): void => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (abortSignal) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
      };

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        if (!finished) {
          finished = true;
          cleanup();
          childProcess.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }
      }, timeout);

      // Handle abort signal
      const abortHandler = (): void => {
        if (!finished) {
          finished = true;
          cleanup();
          logger.debug('Killing child process due to abort signal', { command });
          childProcess.kill('SIGTERM');
          reject(new Error('Command execution was aborted'));
        }
      };

      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler);
      }

      // Handle stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Handle stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process completion
      childProcess.on('close', (code: number | null) => {
        if (!finished) {
          finished = true;
          cleanup();
          
          resolve({
            stdout,
            stderr,
            exitCode: code || 0,
          });
        }
      });

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(error);
        }
      });
    });
  }

  /**
   * Cleanup method - simplified
   */
  cleanup(): void {
    // No persistent processes to clean up in this simplified implementation
    logger.debug('CommandExecutor cleanup completed');
  }
}