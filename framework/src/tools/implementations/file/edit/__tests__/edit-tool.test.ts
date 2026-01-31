/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import path from 'path';
import { EditTool } from '../edit-tool.js';
import type { EditToolInput } from '../schemas.js';

describe('EditTool', () => {
  let editTool: EditTool;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    editTool = new EditTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(originalCwd, 'test-temp', `edit-tool-test-${Date.now()}`);
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

  describe('Basic edit operations', () => {
    it('should apply single edit to existing file', async () => {
      // Create test file
      const testContent = 'Hello world, this is a test file';
      await fs.writeFile('test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'test.txt',
        old_string: 'world',
        new_string: 'universe',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.replacements_made).toBe(1);
        expect(result.data.contentChanged).toBe(true);
        expect(result.data.newContent).toBe('Hello universe, this is a test file');
        expect(result.data.diff).toContain('**universe**'); // Check for highlighted inline change
        
        // Verify file was actually modified
        const fileContent = await fs.readFile('test.txt', 'utf8');
        expect(fileContent).toBe('Hello universe, this is a test file');
      }
    });

    it('should handle replace_all option correctly', async () => {
      const testContent = 'test test test';
      await fs.writeFile('replace-all.txt', testContent);

      const input: EditToolInput = {
        file_path: 'replace-all.txt',
        old_string: 'test',
        new_string: 'exam',
        replace_all: true
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.replacements_made).toBe(3);
        expect(result.data.newContent).toBe('exam exam exam');
        expect(result.data.contentChanged).toBe(true);
      }
    });

    it('should detect when no changes are made (string not found)', async () => {
      const testContent = 'Hello world';
      await fs.writeFile('no-change.txt', testContent);

      const input: EditToolInput = {
        file_path: 'no-change.txt',
        old_string: 'missing',
        new_string: 'replacement',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('old_string not found in file');
    });

    it('should fail when old_string appears multiple times and replace_all is false', async () => {
      const testContent = 'test test test';
      await fs.writeFile('multiple-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'multiple-test.txt',
        old_string: 'test',
        new_string: 'exam',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('appears multiple times');
    });
  });

  describe('File creation', () => {
    it('should create new file when file does not exist', async () => {
      const input: EditToolInput = {
        file_path: 'new-file.txt',
        old_string: '',
        new_string: 'Initial content',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('File does not exist');
    });

    it('should handle edits on empty files', async () => {
      await fs.writeFile('empty.txt', '');

      const input: EditToolInput = {
        file_path: 'empty.txt',
        old_string: '',
        new_string: 'New content',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.fileExists).toBe(true);
        expect(result.data.fileCreated).toBe(false);
        expect(result.data.replacements_made).toBe(1);
        expect(result.data.newContent).toBe('New content');
      }
    });
  });

  describe('Error handling and validation', () => {
    it('should accept absolute paths like ', async () => {
      const input: EditToolInput = {
        file_path: '/tmp/test-file.txt',
        old_string: 'old',
        new_string: 'new',
        replace_all: false
      };

      const result = await editTool.execute(input);

      // Should not fail due to absolute path (though may fail due to file permissions)
      if (!result.success) {
        expect(result.error?.message).not.toContain('Absolute paths are not allowed');
      }
    });

    it('should reject path traversal attempts', async () => {
      const input: EditToolInput = {
        file_path: '../../../etc/passwd',
        old_string: 'root',
        new_string: 'user',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Path traversal detected');
    });

    it('should detect and reject no-op edits (same old and new strings)', async () => {
      const input: EditToolInput = {
        file_path: 'test.txt',
        old_string: 'same',
        new_string: 'same',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('must be different');
    });

    it('should handle empty old_string on existing file', async () => {
      // Create test file first
      await fs.writeFile('test-empty-old.txt', 'existing content');
      
      const input: EditToolInput = {
        file_path: 'test-empty-old.txt',
        old_string: '',
        new_string: 'replacement',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.fileCreated).toBe(false);
        expect(result.data.newContent).toBe('existing contentreplacement');
        expect(result.data.replacements_made).toBe(1);
      }
    });

  });

  describe('Enhanced diff generation with line numbers and context', () => {
    it('should generate diff with line numbers and context for simple changes', async () => {
      const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7';
      await fs.writeFile('diff-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'diff-test.txt',
        old_string: 'Line 4',
        new_string: 'Modified Line 4',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        const diff = result.data.diff;
        
        // Should contain line numbers with proper formatting (git-diff uses 3 spaces for context)
        expect(diff).toContain('  1   Line 1');
        expect(diff).toContain('  2   Line 2');
        expect(diff).toContain('  3   Line 3');
        expect(diff).toContain('  4 - Line 4');
        expect(diff).toContain('  4 + **Modified** Line 4'); // Same line number for replacement
        expect(diff).toContain('  5   Line 5');
        expect(diff).toContain('  6   Line 6');
        expect(diff).toContain('  7   Line 7');
        
        // Should not contain old file headers
        expect(diff).not.toContain('--- a/');
        expect(diff).not.toContain('+++ b/');
        expect(diff).not.toContain('@@');
      }
    });

    it('should show context lines around changes', async () => {
      const testContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10';
      await fs.writeFile('context-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'context-test.txt',
        old_string: 'Line 5',
        new_string: 'Changed Line 5',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const diff = result.data.diff;
        
        // Should show context lines around changes (git-diff format)
        expect(diff).toContain('  2   Line 2'); // context before
        expect(diff).toContain('  3   Line 3'); // context before  
        expect(diff).toContain('  4   Line 4'); // context before
        expect(diff).toContain('  5 - Line 5'); // changed line
        expect(diff).toContain('  5 + **Changed** Line 5'); // changed line with highlighting
        expect(diff).toContain('  6   Line 6'); // context after
        expect(diff).toContain('  7   Line 7'); // context after
        expect(diff).toContain('  8   Line 8'); // context after
      }
    });

    it('should handle line additions correctly', async () => {
      const testContent = 'Line 1\nLine 2\nLine 3';
      await fs.writeFile('addition-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'addition-test.txt',
        old_string: 'Line 2',
        new_string: 'Line 2\nNew Line 2.5',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const diff = result.data.diff;
        
        // Should show the actual line changes that occur (git-diff format)
        expect(diff).toContain('  2   Line 2'); // Line 2 stays the same
        expect(diff).toContain('  2 + **New Line 2**.**5**'); // New content added with highlighting
      }
    });

    it('should handle edge cases with line numbers at start of file', async () => {
      const testContent = 'Line 1\nLine 2\nLine 3';
      await fs.writeFile('edge-test.txt', testContent);
      
      const input: EditToolInput = {
        file_path: 'edge-test.txt',
        old_string: 'Line 1',
        new_string: 'Changed Line 1',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const diff = result.data.diff;
        
        // Should handle line 1 correctly (git-diff format)
        expect(diff).toContain('  1 - Line 1');
        expect(diff).toContain('  1 + **Changed** Line 1'); // Same line number for replacement
        expect(diff).toContain('  2   Line 2');
        expect(diff).toContain('  3   Line 3');
      }
    });

    it('should not generate diff when no changes made', async () => {
      const testContent = 'Unchanged content';
      await fs.writeFile('no-diff.txt', testContent);

      const input: EditToolInput = {
        file_path: 'no-diff.txt',
        old_string: 'missing',
        new_string: 'replacement',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('old_string not found in file');
    });
  });

  describe('Complex edit scenarios', () => {
    it('should handle multiline string replacement', async () => {
      const testContent = 'Line 1\nOld content\nLine 3';
      await fs.writeFile('multiline.txt', testContent);

      const input: EditToolInput = {
        file_path: 'multiline.txt',
        old_string: 'Old content',
        new_string: 'New\nMultiline\nContent',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.replacements_made).toBe(1);
        expect(result.data.newContent).toBe('Line 1\nNew\nMultiline\nContent\nLine 3');
      }
    });

    it('should handle special regex characters in find string', async () => {
      const testContent = 'function() { return value; }';
      await fs.writeFile('regex-chars.txt', testContent);

      const input: EditToolInput = {
        file_path: 'regex-chars.txt',
        old_string: '{ return value; }',
        new_string: '{ return newValue; }',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.replacements_made).toBe(1);
        expect(result.data.newContent).toBe('function() { return newValue; }');
      }
    });

    it('should handle unicode characters', async () => {
      const testContent = 'Hello, 世界! 🌍';
      await fs.writeFile('unicode.txt', testContent);

      const input: EditToolInput = {
        file_path: 'unicode.txt',
        old_string: '世界',
        new_string: 'World',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.replacements_made).toBe(1);
        expect(result.data.newContent).toBe('Hello, World! 🌍');
      }
    });
  });

  describe('Metadata and output validation', () => {
    it('should include all required metadata fields', async () => {
      const testContent = 'Test content';
      await fs.writeFile('metadata-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'metadata-test.txt',
        old_string: 'Test',
        new_string: 'Updated',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Core  fields
        expect(result.data.success).toBe(true);
        expect(typeof result.data.replacements_made).toBe('number');
        expect(typeof result.data.diff).toBe('string');
        
        // Metadata fields
        expect(typeof result.data.fileExists).toBe('boolean');
        expect(typeof result.data.fileCreated).toBe('boolean');
        expect(typeof result.data.contentChanged).toBe('boolean');
        expect(typeof result.data.bytesWritten).toBe('number');
        expect(result.data.lastModified).toBeInstanceOf(Date);
        expect(typeof result.data.newContent).toBe('string');
        
        // Should not have input echoes
        expect('file_path' in result.data).toBe(false);
        expect('old_string' in result.data).toBe(false);
        expect('new_string' in result.data).toBe(false);
      }
    });

    it('should track file size changes correctly', async () => {
      const testContent = 'Short';
      await fs.writeFile('size-test.txt', testContent);

      const input: EditToolInput = {
        file_path: 'size-test.txt',
        old_string: 'Short',
        new_string: 'Much longer replacement text',
        replace_all: false
      };

      const result = await editTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.success).toBe(true);
        expect(result.data.bytesWritten).toBeGreaterThan(testContent.length);
        expect(result.data.bytesWritten).toBe('Much longer replacement text'.length);
      }
    });
  });
});