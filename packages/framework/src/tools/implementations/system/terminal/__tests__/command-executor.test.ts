import { CommandExecutor, detectPlatform } from '../command-executor.js';
import type { TerminalToolInput } from '../schemas.js';

describe('CommandExecutor - Simplified to', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    executor = new CommandExecutor();
  });

  afterEach(() => {
    executor.cleanup();
  });

  describe('Platform Detection', () => {
    it('should detect current platform', () => {
      const platform = detectPlatform();
      expect(['win32', 'darwin', 'linux']).toContain(platform);
    });
  });

  describe('Command Execution', () => {
    it('should execute simple commands', async () => {
      const input: TerminalToolInput = {
        command: 'echo "Hello World"'
      };

      const result = await executor.executeCommand(input);

      expect(result.stdout).toContain('Hello World');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should handle commands with non-zero exit codes', async () => {
      const input: TerminalToolInput = {
        command: 'exit 1'
      };

      const result = await executor.executeCommand(input);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
    });
 
    it('should execute commands with fixed timeout', async () => {
      const input: TerminalToolInput = {
        command: 'echo "test"'
      };

      const result = await executor.executeCommand(input);

      expect(result.stdout).toContain('test');
      expect(result.exitCode).toBe(0);
    });

    it('should handle stderr output', async () => {
      const input: TerminalToolInput = {
        command: 'echo "error message" >&2'
      };

      const result = await executor.executeCommand(input);

      expect(result.stderr).toContain('error message');
    });

    it('should execute platform-appropriate commands', async () => {
      const platform = detectPlatform();
      let command: string;

      if (platform === 'win32') {
        command = 'echo Windows';
      } else {
        command = 'echo Unix';
      }

      const input: TerminalToolInput = { command };
      const result = await executor.executeCommand(input);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(platform === 'win32' ? 'Windows' : 'Unix');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent commands gracefully', async () => {
      const input: TerminalToolInput = {
        command: 'nonexistent-command-12345'
      };

      const result = await executor.executeCommand(input);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it('should handle commands that produce both stdout and stderr', async () => {
      const input: TerminalToolInput = {
        command: 'echo "output" && echo "error" >&2'
      };

      const result = await executor.executeCommand(input);

      expect(result.stdout).toContain('output');
      expect(result.stderr).toContain('error');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup without errors', () => {
      expect(() => executor.cleanup()).not.toThrow();
    });
  });
});
