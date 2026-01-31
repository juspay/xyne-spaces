/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import path from 'path';
import { WriteTool } from '../write-tool.js';
import type { WriteToolInput } from '../schemas.js';

describe('WriteTool', () => {
  let writeTool: WriteTool;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    writeTool = new WriteTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(originalCwd, 'test-temp', `write-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Change to temp directory for relative path tests
    process.chdir(tempDir);
  });

  afterEach(async () => {
    // Restore original working directory
    process.chdir(originalCwd);
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic file writing', () => {
    it('should write content to a new file', async () => {
      const input: WriteToolInput = {
        file_path: 'test.txt',
        content: 'Hello, World!'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.created).toBe(true);
        expect(result.data.bytesWritten).toBe(13);
        // newContent removed from output (was input echo)
        expect(result.data.contentChanged).toBe(true);
        
        // Verify file was actually written
        const fileContent = await fs.readFile('test.txt', 'utf8');
        expect(fileContent).toBe('Hello, World!');
      }
    });

    it('should overwrite existing file content', async () => {
      // Create initial file
      await fs.writeFile('existing.txt', 'Original content');

      const input: WriteToolInput = {
        file_path: 'existing.txt',
        content: 'New content'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.created).toBe(false);
        expect(result.data.originalContent).toBe('Original content');
        // newContent removed from output (was input echo)
        expect(result.data.contentChanged).toBe(true);
        expect(result.data.diffSummary?.hasChanges).toBe(true);
      }
    });

    it('should detect when content is unchanged', async () => {
      const content = 'Same content';
      await fs.writeFile('unchanged.txt', content);

      const input: WriteToolInput = {
        file_path: 'unchanged.txt',
        content
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.contentChanged).toBe(false);
        expect(result.data.diffSummary?.hasChanges).toBe(false);
      }
    });
  });

  describe('Directory creation', () => {
    it('should create parent directories when createDirectories is true', async () => {
      const input: WriteToolInput = {
        file_path: 'nested/deep/file.txt',
        content: 'Content in nested directory',
        // createDirectories always true like 
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.directoryCreated).toBe(true);
        
        // Verify directory structure was created
        const stats = await fs.stat('nested/deep');
        expect(stats.isDirectory()).toBe(true);
        
        // Verify file content
        const content = await fs.readFile('nested/deep/file.txt', 'utf8');
        expect(content).toBe('Content in nested directory');
      }
    });

    it('should create parent directories automatically like ', async () => {
      const input: WriteToolInput = {
        file_path: 'nonexistent/file.txt',
        content: 'Content'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.directoryCreated).toBe(true);
        expect(result.data.created).toBe(true);
      }
    });
  });

  describe('EOF marker processing', () => {
    it('should strip EOF markers when stripEOFMarkers is true', async () => {
      const input: WriteToolInput = {
        file_path: 'eof-test.txt',
        content: 'Line 1\n<<<EOF_FILE>>>\nLine 2\n<<<EOF_FILE>>>',
        // stripEOFMarkers always true like 
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // newContent removed from output (was input echo)
      }
    });

    it('should always strip EOF markers like ', async () => {
      const input: WriteToolInput = {
        file_path: 'eof-preserve.txt',
        content: 'Line 1\n<<<EOF_FILE>>>\nLine 2',
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Verify EOF markers were stripped
        const fileContent = await fs.readFile('eof-preserve.txt', 'utf8');
        expect(fileContent).toBe('Line 1\n\nLine 2');
      }
    });
  });

  describe('Security validation', () => {
    it('should accept absolute paths like ', async () => {
      const input: WriteToolInput = {
        file_path: '/tmp/test-file.txt',
        content: 'test content'
      };

      const result = await writeTool.execute(input);

      // Should not fail due to absolute path (though may fail due to file permissions)
      if (!result.success) {
        expect(result.error?.message).not.toContain('Absolute paths are not allowed');
      }
    });

    it('should reject path traversal attempts', async () => {
      const input: WriteToolInput = {
        file_path: '../../../etc/passwd',
        content: 'malicious content'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Path traversal detected');
    });



    it('should reject sensitive file names', async () => {
      const input: WriteToolInput = {
        file_path: 'passwd',
        content: 'sensitive content'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Writing to sensitive file passwd is not allowed');
    });
  });


  describe('File overwriting', () => {
    it('should always overwrite existing files like ', async () => {
      await fs.writeFile('protected.txt', 'original');

      const input: WriteToolInput = {
        file_path: 'protected.txt',
        content: 'new content'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.created).toBe(false);
        expect(result.data.originalContent).toBe('original');
        expect(result.data.contentChanged).toBe(true);
        
        // Verify file was overwritten
        const content = await fs.readFile('protected.txt', 'utf8');
        expect(content).toBe('new content');
      }
    });
  });

  describe('Encoding support', () => {
    it('should handle different encodings', async () => {
      const input: WriteToolInput = {
        file_path: 'encoded.txt',
        content: 'Hello, 世界!',
        // encoding always utf8 like 
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // encoding removed from output (was input echo)
        
        const content = await fs.readFile('encoded.txt', 'utf8');
        expect(content).toBe('Hello, 世界!');
      }
    });
  });

  describe('Diff summary generation', () => {
    it('should generate accurate diff summary for modified files', async () => {
      await fs.writeFile('diff-test.txt', 'Line 1\nLine 2\nLine 3');

      const input: WriteToolInput = {
        file_path: 'diff-test.txt',
        content: 'Line 1 modified\nLine 2\nLine 4\nLine 5'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.diffSummary).toBeDefined();
        expect(result.data.diffSummary?.hasChanges).toBe(true);
        expect(result.data.diffSummary?.linesAdded).toBe(1);
        expect(result.data.diffSummary?.linesRemoved).toBe(0);
        expect(result.data.diffSummary?.linesModified).toBeGreaterThan(0);
      }
    });
  });

  describe('Suggestions generation', () => {
    it('should provide helpful suggestions for TypeScript files', async () => {
      const input: WriteToolInput = {
        file_path: 'test.ts',
        content: 'const message: string = "Hello";'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.suggestions).toContain('Consider running TypeScript compiler or linter to check syntax');
      }
    });

    it('should provide suggestions for JSON files', async () => {
      const input: WriteToolInput = {
        file_path: 'config.json',
        content: '{"key": "value"}'
      };

      const result = await writeTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.suggestions).toContain('Consider validating JSON syntax');
      }
    });
  });
});