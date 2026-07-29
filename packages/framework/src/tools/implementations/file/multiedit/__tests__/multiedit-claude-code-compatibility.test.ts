/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import path from 'path';
import { MultiEditTool } from '../multiedit-tool.js';
import type { MultiEditToolInput } from '../schemas.js';

describe('MultiEditTool -  Exact Compatibility', () => {
  let multiEditTool: MultiEditTool;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    multiEditTool = new MultiEditTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-temp', `multiedit-compat-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create test file exactly like  would use
    testFile = path.join(tempDir, 'example.py');
    const testContent = `def hello_world():
    print("Hello, World!")
    return "Hello, World!"

def goodbye_world():
    print("Goodbye, World!")
    return "Goodbye, World!"`;
    
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

  describe(' Compatible Interface', () => {
    it('should match  MultiEdit exact parameter structure', async () => {
      // This test verifies that our tool accepts the exact same input as 
      const input: MultiEditToolInput = {
         
        file_path: testFile,
        edits: [
          {
            old_string: 'def hello_world():',
            new_string: 'def greet_world():'
          },
          {
            old_string: 'print("Hello, World!")',
            new_string: 'print("Greetings, World!")'
          },
          {
            old_string: 'return "Hello, World!"',
            new_string: 'return "Greetings, World!"'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Verify output structure matches  exactly
        expect(typeof result.data.file_path).toBe('string');
        expect(typeof result.data.total_edits).toBe('number');
        expect(typeof result.data.successful_edits).toBe('number');
        expect(Array.isArray(result.data.edits_applied)).toBe(true);
        expect(typeof result.data.file_size_before).toBe('number');
        expect(typeof result.data.file_size_after).toBe('number');
        expect(typeof result.data.content_preview).toBe('object');
        expect(typeof result.data.content_preview.first_100_chars).toBe('string');
        expect(typeof result.data.content_preview.last_100_chars).toBe('string');

        // Verify specific  behavior
        expect(result.data.total_edits).toBe(3);
        expect(result.data.successful_edits).toBe(3);
        expect(result.data.edits_applied).toHaveLength(3);
        
        // Verify each edit result has  structure
        for (const editResult of result.data.edits_applied) {
          expect(typeof editResult.operation_index).toBe('number');
          expect(typeof editResult.old_string).toBe('string');
          expect(typeof editResult.new_string).toBe('string');
          expect(typeof editResult.occurrences_replaced).toBe('number');
          expect(typeof editResult.success).toBe('boolean');
        }
      }
    });

    it('should handle replace_all flag exactly like ', async () => {
      const input: MultiEditToolInput = {
         
        file_path: testFile,
        edits: [
          {
            old_string: 'World',
            new_string: 'Universe',
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
        expect(modifiedContent).toContain('Universe');
        expect(modifiedContent).not.toContain('World');
      }
    });

    it('should handle failed edits exactly like ', async () => {
      const input: MultiEditToolInput = {
         
        file_path: testFile,
        edits: [
          {
            old_string: 'nonexistent_text',
            new_string: 'replacement'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('None of the provided edits could be applied');
    });

    it('should provide content preview exactly like ', async () => {
      const input: MultiEditToolInput = {
         
        file_path: testFile,
        edits: [
          {
            old_string: 'hello_world',
            new_string: 'greet_world'
          }
        ]
      };

      const result = await multiEditTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const preview = result.data.content_preview;
        
        // Verify preview structure matches 
        expect(preview.first_100_chars).toBeDefined();
        expect(preview.last_100_chars).toBeDefined();
        expect(preview.first_100_chars.length).toBeLessThanOrEqual(100);
        expect(preview.last_100_chars.length).toBeLessThanOrEqual(100);
        
        // Verify preview shows modified content
        expect(preview.first_100_chars).toContain('greet_world');
      }
    });

    it('should validate input exactly like ', async () => {
      // Test empty edits array
      const emptyInput: MultiEditToolInput = {
         
        file_path: testFile,
        edits: []
      };

      const emptyResult = await multiEditTool.execute(emptyInput);
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error?.message).toContain('At least one edit operation is required');

      // Test same old_string and new_string
      const sameStringInput: MultiEditToolInput = {
         
        file_path: testFile,
        edits: [
          {
            old_string: 'same_value',
            new_string: 'same_value'
          }
        ]
      };

      const sameStringResult = await multiEditTool.execute(sameStringInput);
      expect(sameStringResult.success).toBe(false);
      expect(sameStringResult.error?.message).toContain('must be different');
    });
  });
});