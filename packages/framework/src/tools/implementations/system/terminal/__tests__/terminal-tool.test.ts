import { TerminalTool } from '../terminal-tool.js';
import type { TerminalToolInput } from '../schemas.js';

describe('TerminalTool - Simplified', () => {
  let terminalTool: TerminalTool;

  beforeEach(() => {
    terminalTool = new TerminalTool();
  });

  describe('Basic command execution', () => {
    it('should execute simple commands', async () => {
      const input: TerminalToolInput = {
        command: 'echo "Hello World"'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.stdout).toContain('Hello World');
        expect(result.data.stderr).toBe('');
        expect(result.data.exitCode).toBe(0);
        expect(result.data.success).toBe(true);
        expect(result.data.command).toBe('echo "Hello World"');
        expect(typeof result.data.executionTime).toBe('number');
      }
    });

    it('should handle commands with non-zero exit codes', async () => {
      const input: TerminalToolInput = {
        command: 'exit 1'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.exitCode).toBe(1);
        expect(result.data.success).toBe(false);
      }
    });

    it('should execute commands successfully', async () => {
      const input: TerminalToolInput = {
        command: 'echo "test"'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.stdout).toContain('test');
      }
    });

    it('should support description parameter', async () => {
      const input: TerminalToolInput = {
        command: 'ls',
        description: 'List files in current directory'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.command).toBe('ls');
        expect(typeof result.data.stdout).toBe('string');
      }
    });
  });

  describe('Previously blocked commands now allowed', () => {
    it('should allow npm commands', async () => {
      const input: TerminalToolInput = {
        command: 'npm --version'
      };

      const result = await terminalTool.execute(input);

      // Should not be blocked (though may fail if npm not installed)
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.command).toBe('npm --version');
      }
    });

    it('should allow chmod commands', async () => {
      const input: TerminalToolInput = {
        command: 'chmod --help'
      };

      const result = await terminalTool.execute(input);

      // Should not be blocked (though may fail on Windows)
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.command).toBe('chmod --help');
      }
    });

    it('should allow command chaining', async () => {
      const input: TerminalToolInput = {
        command: 'echo "first" && echo "second"'
      };

      const result = await terminalTool.execute(input);

      // Should not be blocked
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.stdout).toContain('first');
        expect(result.data.stdout).toContain('second');
      }
    });
  });

  describe('Error handling', () => {
    it('should reject commands with null bytes', async () => {
      const input: TerminalToolInput = {
        command: 'echo "test\0"'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('null bytes');
    });

    it('should handle long running commands with fixed timeout', async () => {
      const input: TerminalToolInput = {
        command: 'sleep 10'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.exitCode).toBe(0);
        expect(result.data.success).toBe(true);
      }
    }, 130000); // Allow for 2+ minute timeout
  });

  describe('Output format matche', () => {
    it('should return simple output structure', async () => {
      const input: TerminalToolInput = {
        command: 'echo "test"'
      };

      const result = await terminalTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Verify it has the simple structure 
        expect(result.data).toHaveProperty('stdout');
        expect(result.data).toHaveProperty('stderr');
        expect(result.data).toHaveProperty('exitCode');
        expect(result.data).toHaveProperty('command');
        expect(result.data).toHaveProperty('success');
        expect(result.data).toHaveProperty('executionTime');

        // Verify it doesn't have complex fields from old implementation
        expect(result.data).not.toHaveProperty('metadata');
        expect(result.data).not.toHaveProperty('suggestions');
        expect(result.data).not.toHaveProperty('outputTruncated');
        expect(result.data).not.toHaveProperty('timedOut');
        expect(result.data).not.toHaveProperty('outputSize');
        expect(result.data).not.toHaveProperty('errorCategory');
      }
    });
  });

  afterEach(() => {
    terminalTool.cleanup();
  });
});