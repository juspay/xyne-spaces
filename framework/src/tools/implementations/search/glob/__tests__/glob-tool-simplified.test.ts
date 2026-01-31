import { promises as fs } from 'fs';
import path from 'path';
import { GlobTool } from '../glob-tool.js';
import type { GlobToolInput } from '../schemas.js';

describe('GlobTool - Simplified Interface', () => {
  let globTool: GlobTool;
  let tempDir: string;

  beforeEach(async () => {
    globTool = new GlobTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-temp', `glob-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create test files
    await fs.writeFile(path.join(tempDir, 'file1.js'), 'console.log("test1");');
    await fs.writeFile(path.join(tempDir, 'file2.ts'), 'console.log("test2");');
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Test');
    await fs.mkdir(path.join(tempDir, 'subdir'));
    await fs.writeFile(path.join(tempDir, 'subdir', 'nested.js'), 'console.log("nested");');
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
    it('should work with just pattern parameter', async () => {
      // Change to temp directory for relative pattern matching
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      
      try {
        const input: GlobToolInput = {
          pattern: '*.js'
        };

        const result = await globTool.execute(input);

        expect(result.success).toBe(true);
        if (result.success && result.data) {
          // ✅ CORE:  compatible output
          expect(Array.isArray(result.data.matches)).toBe(true);
          expect(result.data.matches).toContain(path.join(tempDir, 'file1.js'));
          expect(result.data.matches.length).toBe(1);
          
          // ✅ ENHANCED: Rich metadata
          expect(Array.isArray(result.data.detailed_matches)).toBe(true);
          expect(result.data.detailed_matches.length).toBe(1);
          expect(result.data.detailed_matches[0]).toHaveProperty('path');
          expect(result.data.detailed_matches[0]).toHaveProperty('size');
          expect(result.data.detailed_matches[0]).toHaveProperty('lastModified');
          expect(result.data.detailed_matches[0]).toHaveProperty('extension', 'js');
          
          // ✅ KEEP: Useful metadata
          expect(result.data.stats).toHaveProperty('totalMatches', 1);
          expect(result.data.stats).toHaveProperty('searchDuration');
          expect(result.data.stats).toHaveProperty('pattern', '*.js');
          
          // ❌ REMOVED: Input echoes (no options object)
          expect('options' in result.data).toBe(false);
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should work with pattern and path parameters', async () => {
      const input: GlobToolInput = {
        pattern: '**/*.js',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should find both JS files (including nested one)
        expect(result.data.matches).toHaveLength(2);
        expect(result.data.matches.some(match => match.endsWith('file1.js'))).toBe(true);
        expect(result.data.matches.some(match => match.endsWith('nested.js'))).toBe(true);
        
        expect(result.data.stats.totalMatches).toBe(2);
        expect(result.data.stats.searchPath).toBe(path.resolve(tempDir));
      }
    });

    it('should sort results by modification time ( behavior)', async () => {
      // Create files with different timestamps
      const file1 = path.join(tempDir, 'newer.txt');
      const file2 = path.join(tempDir, 'older.txt');
      
      await fs.writeFile(file2, 'older');
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await fs.writeFile(file1, 'newer');

      const input: GlobToolInput = {
        pattern: '*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should be sorted by modification time (newest first)
        expect(result.data.matches[0]).toBe(file1); // newer file first
        expect(result.data.matches[1]).toBe(file2); // older file second
      }
    });

    it('should provide detailed match information', async () => {
      const input: GlobToolInput = {
        pattern: 'README.md',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.detailed_matches.length).toBe(1);
        const match = result.data.detailed_matches[0];
        if (match) {
          expect(match.path).toBe(path.join(tempDir, 'README.md'));
          expect(match.relativePath).toBe('README.md');
          expect(match.extension).toBe('md');
          expect(match.isFile).toBe(true);
          expect(match.isDirectory).toBe(false);
          expect(typeof match.size).toBe('number');
          expect(match.lastModified).toBeInstanceOf(Date);
        } else {
          fail('Expected match to be defined');
        }
      }
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent directory', async () => {
      const input: GlobToolInput = {
        pattern: '*.js',
        path: '/non/existent/path'
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('does not exist');
    });

    it('should handle invalid patterns', async () => {
      const input: GlobToolInput = {
        pattern: 'a'.repeat(2001), // Pattern too long
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Pattern too long');
    });
  });
});