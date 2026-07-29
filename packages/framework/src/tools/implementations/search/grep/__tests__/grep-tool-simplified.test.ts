/* eslint-disable @typescript-eslint/naming-convention */
import { promises as fs } from 'fs';
import path from 'path';
import { GrepTool } from '../grep-tool.js';
import type { GrepToolInput } from '../schemas.js';

describe('GrepTool -  Compatible Interface', () => {
  let grepTool: GrepTool;
  let tempDir: string;

  beforeEach(async () => {
    grepTool = new GrepTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-temp', `grep-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create test files
    await fs.writeFile(path.join(tempDir, 'file1.js'), 'const test = "hello world";\nconsole.log(test);');
    await fs.writeFile(path.join(tempDir, 'file2.ts'), 'function greet() {\n  return "hello";\n}');
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Hello World\nThis is a test project');
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe(' Compatible Parameters', () => {
    it('should work with new parameter names (-i, -A, -B, -C, -n, head_limit)', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
         
        output_mode: 'content',
         
        "-i": true,  // case insensitive
         
        "-A": 1,     // lines after
         
        "-n": true,  // line numbers
         
        head_limit: 5
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.pattern).toBe('hello');
        expect(result.data.output_mode).toBe('content');
        expect(Array.isArray(result.data.matches)).toBe(true);
        expect(result.data.matches!.length).toBeGreaterThan(0);
        
        // Should find matches in multiple files due to case insensitive search
        const fileNames = result.data.matches!.map(m => path.basename(m.filePath));
        expect(fileNames).toContain('file1.js');
        expect(fileNames).toContain('file2.ts');
        expect(fileNames).toContain('README.md');
      }
    });

    it('should support files_with_matches mode ( default)', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
        output_mode: 'files_with_matches'
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.output_mode).toBe('files_with_matches');
        expect(Array.isArray(result.data.filesFound)).toBe(true);
        expect(result.data.filesFound!.length).toBeGreaterThan(0);
        
        // Should find files containing "hello"
        const fileNames = result.data.filesFound!.map(f => path.basename(f));
        expect(fileNames).toContain('file1.js');
        expect(fileNames).toContain('file2.ts');
      }
    });

    it('should support count mode', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
         
        output_mode: 'count'
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.output_mode).toBe('count');
        expect(Array.isArray(result.data.matches)).toBe(true);
        expect(result.data.matches!.length).toBeGreaterThan(0);
        
        // Each match should have a matchCount
        for (const match of result.data.matches!) {
          expect(typeof match.matchCount).toBe('number');
          expect(match.matchCount).toBeGreaterThan(0);
        }
      }
    });

    it('should work with glob pattern filtering', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
        glob: '*.js',
        output_mode: 'files_with_matches'
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.filesFound!.length).toBe(1);
        if (result.data.filesFound && result.data.filesFound[0]) {
          expect(path.basename(result.data.filesFound[0])).toBe('file1.js');
        }
      }
    });

    it('should work with type filtering', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
        type: 'js',
        output_mode: 'files_with_matches'
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should find JavaScript/TypeScript files
        expect(result.data.filesFound!.length).toBeGreaterThan(0);
        const fileNames = result.data.filesFound!.map(f => path.basename(f));
        expect(fileNames).toContain('file1.js');
        expect(fileNames).toContain('file2.ts');
      }
    });

    it('should work with head_limit parameter', async () => {
      const input: GrepToolInput = {
        pattern: 'hello',
        path: tempDir,
         
        output_mode: 'files_with_matches',
         
        head_limit: 1
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should limit results to 1 file
        expect(result.data.filesFound!.length).toBe(1);
      }
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent directory', async () => {
      const input: GrepToolInput = {
        pattern: 'test',
        path: '/non/existent/path'
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('does not exist');
    });

    it('should validate context options require content mode', async () => {
      const input: GrepToolInput = {
        pattern: 'test',
        path: tempDir,
         
        output_mode: 'files_with_matches',
         
        "-A": 3  // Context lines require content mode
      };

      const result = await grepTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Context options (-A, -B, -C) require output mode to be "content"');
    });
  });
});