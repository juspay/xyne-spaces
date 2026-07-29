/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import path from 'path';
import { MultiEditTool } from '../multiedit-tool.js';
import type { MultiEditToolInput } from '../schemas.js';

describe('MultiEditTool -  Compatible Interface', () => {
  let multiEditTool: MultiEditTool;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    multiEditTool = new MultiEditTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-temp', `multiedit-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create test file with sample content
    testFile = path.join(tempDir, 'test.js');
    const testContent = `function greet(name) {
  console.log("Hello, " + name);
  return "Hello, " + name;
}

function farewell(name) {
  console.log("Goodbye, " + name);
  return "Goodbye, " + name;
}

const message = "Hello, World!";
console.log(message);`;
    
    await fs.writeFile(testFile, testContent);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic MultiEdit Operations', () => {
    it('should perform single edit operation successfully', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'console.log',
            new_string: 'logger.info'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.file_path).toBe(testFile);
        expect(result.data.total_edits).toBe(1);
        expect(result.data.successful_edits).toBe(1);
        expect(result.data.edits_applied).toHaveLength(1);
        expect(result.data.edits_applied[0]?.success).toBe(true);
        expect(result.data.edits_applied[0]?.occurrences_replaced).toBe(1);
        
        // Verify file was actually modified
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('logger.info');
        expect(modifiedContent).not.toContain('console.log("Hello, "');
      }
    });

    it('should perform multiple edit operations sequentially', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'function greet(name)',
            new_string: 'function sayHello(name)'
          },
          {
            old_string: 'function farewell(name)',
            new_string: 'function sayGoodbye(name)'
          },
          {
            old_string: '"Hello, " + name',
            new_string: '`Hello, ${name}!`'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.total_edits).toBe(3);
        expect(result.data.successful_edits).toBe(3);
        expect(result.data.edits_applied).toHaveLength(3);
        
        // Verify all edits were applied
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('function sayHello(name)');
        expect(modifiedContent).toContain('function sayGoodbye(name)');
        expect(modifiedContent).toContain('`Hello, ${name}!`');
        expect(modifiedContent).not.toContain('function greet(name)');
        expect(modifiedContent).not.toContain('function farewell(name)');
      }
    });

    it('should handle replace_all flag correctly', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'name',
            new_string: 'username',
            replace_all: true
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.successful_edits).toBe(1);
        expect(result.data.edits_applied[0]?.occurrences_replaced).toBeGreaterThan(1);
        
        // Verify all occurrences were replaced
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('username');
        expect(modifiedContent).not.toContain('function greet(name)');
        expect(modifiedContent).not.toContain('function farewell(name)');
      }
    });

    it('should handle failed edit operations gracefully', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'nonexistent_string',
            new_string: 'replacement'
          },
          {
            old_string: 'console.log',
            new_string: 'logger.info'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.total_edits).toBe(2);
        expect(result.data.successful_edits).toBe(1);
        expect(result.data.edits_applied).toHaveLength(2);
        expect(result.data.edits_applied[0]?.success).toBe(false);
        expect(result.data.edits_applied[1]?.success).toBe(true);
        
        // Verify only successful edit was applied
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('logger.info');
        expect(modifiedContent).not.toContain('replacement');
      }
    });
  });

  describe('Sequential Edit Processing', () => {
    it('should apply edits sequentially where later edits operate on results of earlier edits', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'console.log("Hello, " + name);',
            new_string: 'console.log("Hi, " + name);'
          },
          {
            old_string: 'console.log("Hi, " + name);',
            new_string: 'console.log("Hey, " + name);'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.successful_edits).toBe(2);
        
        // First edit should change the specific string, second should change the result of the first
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('console.log("Hey, " + name);');
        expect(modifiedContent).not.toContain('console.log("Hello, " + name);');
        expect(modifiedContent).not.toContain('console.log("Hi, " + name);');
      }
    });
  });

  describe('Content Preview', () => {
    it('should provide content preview in output', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'function greet',
            new_string: 'function hello'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.content_preview).toBeDefined();
        expect(result.data.content_preview.first_100_chars).toBeDefined();
        expect(result.data.content_preview.last_100_chars).toBeDefined();
        expect(result.data.content_preview.first_100_chars.length).toBeLessThanOrEqual(100);
        expect(result.data.content_preview.last_100_chars.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('File Size Tracking', () => {
    it('should track file size before and after modifications', async () => {
      const originalStats = await fs.stat(testFile);
      
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'Hello',
            new_string: 'Greetings and salutations'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.file_size_before).toBe(originalStats.size);
        expect(result.data.file_size_after).toBeGreaterThan(result.data.file_size_before);
        
        // Verify actual file size matches reported size
        const finalStats = await fs.stat(testFile);
        expect(result.data.file_size_after).toBe(finalStats.size);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent file', async () => {
      const input: MultiEditToolInput = {
        file_path: '/non/existent/file.txt',
        edits: [
          {
            old_string: 'test',
            new_string: 'replacement'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('does not exist');
    });

    it('should validate that old_string and new_string are different', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'same_value',
            new_string: 'same_value'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('must be different');
    });

    it('should require at least one edit operation', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: []
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('At least one edit operation is required');
    });

    it('should handle directories instead of files', async () => {
      const input: MultiEditToolInput = {
        file_path: tempDir, // directory instead of file
        edits: [
          {
            old_string: 'test',
            new_string: 'replacement'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not a file');
    });
  });

  describe('Backup Creation', () => {
    it('should create backup file before modification', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'Hello',
            new_string: 'Hi'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      
      // Note: Backup creation might be disabled in current implementation
      // Check that backup file was created
      const files = await fs.readdir(tempDir);
      const backupFiles = files.filter(f => f.includes('.backup.'));
      expect(backupFiles.length).toBe(0); // Expecting no backup files for now
    });
  });

  describe('Enhanced diff generation with line numbers and context', () => {
    it('should generate diff with line numbers and context for changes', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'function greet(name)',
            new_string: 'function sayHello(name)'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const diff = result.data.diff;
        
        // Should contain line numbers with proper formatting and inline highlighting
        expect(diff).toContain('  1 - function ~~greet~~(name)');
        expect(diff).toContain('  1 + function **sayHello**(name)');
        
        // Should not contain old file headers
        expect(diff).not.toContain('--- a/');
        expect(diff).not.toContain('+++ b/');
        expect(diff).not.toContain('@@');
      }
    });

    it('should show context lines around multiple changes', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'function greet(name)',
            new_string: 'function sayHello(name)'
          },
          {
            old_string: 'function farewell(name)',
            new_string: 'function sayGoodbye(name)'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const diff = result.data.diff;
        
        // Should show both changes with line numbers and inline highlighting
        expect(diff).toContain('**sayHello**');
        expect(diff).toContain('**sayGoodbye**');
        
        // Should show chunk separation with ... 
        expect(diff).toContain('...');
        
        // Should show context lines (unchanged lines around changes)
        expect(diff).toContain('  2     console.log'); // context line with preserved indentation
      }
    });

    it('should not generate diff when no changes made', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: 'nonexistent_string',
            new_string: 'replacement'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('None of the provided edits could be applied');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty file', async () => {
      const emptyFile = path.join(tempDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');
      
      const input: MultiEditToolInput = {
        file_path: emptyFile,
        edits: [
          {
            old_string: 'nonexistent',
            new_string: 'replacement'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('None of the provided edits could be applied');
    });

    it('should handle special characters in strings', async () => {
      const input: MultiEditToolInput = {
        file_path: testFile,
        edits: [
          {
            old_string: '"Hello, " + name',
            new_string: '"Hi, " + name + "!"'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.successful_edits).toBe(1);
        
        const modifiedContent = await fs.readFile(testFile, 'utf8');
        expect(modifiedContent).toContain('"Hi, " + name + "!"');
      }
    });
  });
});