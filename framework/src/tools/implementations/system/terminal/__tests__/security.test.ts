import { validateCommand, sanitizeCommand } from '../security.js';

describe('Terminal Security - Simplified', () => {
  describe('validateCommand', () => {
    it('should allow most commands', () => {
      const commands = [
        'ls -la',
        'echo "hello world"',
        'cat package.json',
        'ps aux',
        'uname -a',
        'date',
        'whoami',
        'pwd',
        'git status',
        'npm test',
        'rm -rf /',  // Allowed but depends on system permissions
        'chmod 777', // Allowed but depends on system permissions
        'sudo su',   // Allowed but depends on system permissions
        'fdisk',     // Allowed but depends on system permissions
        'mkfs',      // Allowed but depends on system permissions
      ];

      for (const command of commands) {
        const result = validateCommand(command, 'linux');
        expect(result.allowed).toBe(true);
        expect(result.riskLevel).toBe('low');
      }
    });

    it('should block commands with null bytes', () => {
      const dangerousCommands = [
        'echo "test\0"',
        'echo "test\x00"',
        'ls\0 -la',
        'cat\x00 file.txt',
      ];

      for (const command of dangerousCommands) {
        const result = validateCommand(command, 'linux');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('null bytes');
        expect(result.riskLevel).toBe('critical');
      }
    });

    it('should work consistently across platforms', () => {
      const command = 'echo "test"';
      
      const linuxResult = validateCommand(command, 'linux');
      const darwinResult = validateCommand(command, 'darwin');
      const win32Result = validateCommand(command, 'win32');

      expect(linuxResult.allowed).toBe(true);
      expect(darwinResult.allowed).toBe(true);
      expect(win32Result.allowed).toBe(true);
    });

    it('should allow empty commands (will be caught by sanitization)', () => {
      const result = validateCommand('', 'linux');
      expect(result.allowed).toBe(true);
    });

    it('should allow complex command chains', () => {
      const complexCommands = [
        'echo "first" && echo "second"',
        'ls | grep package',
        'cat file.txt > output.txt',
        'find . -name "*.js" | xargs grep "function"',
        'npm install && npm test && npm build',
      ];

      for (const command of complexCommands) {
        const result = validateCommand(command, 'linux');
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('sanitizeCommand', () => {
    it('should remove null bytes', () => {
      expect(sanitizeCommand('echo "test\0"')).toBe('echo "test"');
      expect(sanitizeCommand('ls\x00 -la')).toBe('ls -la');
      expect(sanitizeCommand('cat\0file.txt')).toBe('catfile.txt');
    });

    it('should trim whitespace', () => {
      expect(sanitizeCommand('  echo test  ')).toBe('echo test');
      expect(sanitizeCommand('\n\tls -la\n\t')).toBe('ls -la');
    });

    it('should preserve normal commands', () => {
      const normalCommands = [
        'ls -la',
        'echo "hello world"',
        'npm test',
        'git status',
      ];

      for (const command of normalCommands) {
        expect(sanitizeCommand(command)).toBe(command);
      }
    });

    it('should handle empty strings', () => {
      expect(sanitizeCommand('')).toBe('');
      expect(sanitizeCommand('   ')).toBe('');
    });

    it('should preserve special characters except null bytes', () => {
      const command = 'echo "Hello & goodbye; test | more"';
      expect(sanitizeCommand(command)).toBe(command);
    });
  });
});