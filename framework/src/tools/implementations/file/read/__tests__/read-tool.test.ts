/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import { ReadTool } from '../read-tool.js';
import type { ReadToolInput, ReadToolOutput } from '../schemas.js';

describe('ReadTool', () => {
  let readTool: ReadTool;
  const testFilesDir = path.join(process.cwd(), 'src/tools/implementations/file/read/__tests__/test-fixtures');
  const sampleFilePath = path.join(testFilesDir, 'sample.txt');
  const emptyFilePath = path.join(testFilesDir, 'empty.txt');

  beforeEach(() => {
    readTool = new ReadTool();
  });

  describe('Basic file reading', () => {
    it('should read a simple text file with line numbers', async () => {
      const input: ReadToolInput = {
        file_path: sampleFilePath
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as ReadToolOutput;
        expect(data.totalLines).toBe(5);
        expect(data.linesRead).toBe(5);
        expect(data.isTextFile).toBe(true);
        expect(data.isEmpty).toBe(false);
        expect(data.startLine).toBe(1);
        expect(data.endLine).toBe(5);
        expect(data.content).toContain('     1\t');
        expect(data.content).toContain('     2\t');
      }
    });

    it('should handle empty files correctly', async () => {
      const input: ReadToolInput = {
        file_path: emptyFilePath
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as ReadToolOutput;
        expect(data.totalLines).toBe(0);
        expect(data.linesRead).toBe(0);
        expect(data.isEmpty).toBe(true);
        expect(data.content).toBe('');
        expect(data.startLine).toBe(0);
        expect(data.endLine).toBe(0);
        
        // Should provide empty file suggestion
        expect(data.suggestions).toBeDefined();
        expect(data.suggestions).toContain('File is empty - no content to read.');
      }
    });
  });

  describe('Offset and limit functionality', () => {
    it('should respect offset parameter', async () => {
      const input: ReadToolInput = {
        file_path: sampleFilePath,
        offset: 3
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as ReadToolOutput;
        expect(data.totalLines).toBe(5);
        expect(data.linesRead).toBe(3); // Lines 3, 4, 5
        expect(data.startLine).toBe(3);
        expect(data.endLine).toBe(5);
        expect(data.content).toContain('     3\t');
        expect(data.content).not.toContain('     1\t');
        expect(data.content).not.toContain('     2\t');
      }
    });

    it('should respect limit parameter', async () => {
      const input: ReadToolInput = {
        file_path: sampleFilePath,
        limit: 2
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as ReadToolOutput;
        expect(data.totalLines).toBe(5);
        expect(data.linesRead).toBe(2); // Only first 2 lines
        expect(data.startLine).toBe(1);
        expect(data.endLine).toBe(2);
        expect(data.content).toContain('     1\t');
        expect(data.content).toContain('     2\t');
        expect(data.content).not.toContain('     3\t');
        
        // Should provide suggestions for more content
        expect(data.suggestions).toBeDefined();
        expect(data.suggestions?.some(s => 
          s.includes('File has 3 more lines') && s.includes('offset: 3, limit: 2')
        )).toBe(true);
      }
    });

    it('should handle offset and limit together', async () => {
      const input: ReadToolInput = {
        file_path: sampleFilePath,
        offset: 2,
        limit: 2
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as ReadToolOutput;
        expect(data.totalLines).toBe(5);
        expect(data.linesRead).toBe(2); // Lines 2, 3
        expect(data.startLine).toBe(2);
        expect(data.endLine).toBe(3);
        expect(data.content).toContain('     2\t');
        expect(data.content).toContain('     3\t');
        expect(data.content).not.toContain('     1\t');
        expect(data.content).not.toContain('     4\t');
      }
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent files', async () => {
      const input: ReadToolInput = {
        file_path: '/non/existent/file.txt'
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it('should prevent path traversal', async () => {
      const input: ReadToolInput = {
        file_path: '../../../etc/passwd'
      };

      const result = await readTool.execute(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});