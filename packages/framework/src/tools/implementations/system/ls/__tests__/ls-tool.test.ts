import { promises as fs } from 'fs';
import path from 'path';
import { LsTool } from '../ls-tool.js';
import type { LsToolInput } from '../schemas.js';

describe('LsTool', () => {
  let lsTool: LsTool;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    lsTool = new LsTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(originalCwd, 'test-temp', `ls-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic directory listing', () => {
    it('should list files and directories in a given path', async () => {
      // Create test files and directories
      await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(path.join(tempDir, 'file2.js'), 'content2');
      await fs.mkdir(path.join(tempDir, 'subdir'));

      const input: LsToolInput = {
        path: tempDir
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // ✅ CORE:  compatible output
        expect(Array.isArray(result.data.entries)).toBe(true);
        expect(result.data.entries).toContain('file1.txt');
        expect(result.data.entries).toContain('file2.js');
        expect(result.data.entries).toContain('subdir');
        
        // ✅ ENHANCED: Rich metadata
        expect(Array.isArray(result.data.detailed_entries)).toBe(true);
        expect(result.data.detailed_entries.length).toBe(3);
        
        const file1Entry = result.data.detailed_entries.find(e => e.name === 'file1.txt');
        expect(file1Entry).toBeDefined();
        expect(file1Entry?.type).toBe('file');
        expect(file1Entry?.isHidden).toBe(false);
        expect(file1Entry?.extension).toBe('txt');
        
        const subdirEntry = result.data.detailed_entries.find(e => e.name === 'subdir');
        expect(subdirEntry).toBeDefined();
        expect(subdirEntry?.type).toBe('directory');
        
        // ✅ KEEP: Useful metadata
        expect(result.data.stats).toBeDefined();
        expect(result.data.stats.totalEntries).toBe(3);
        expect(result.data.stats.filesCount).toBe(2);
        expect(result.data.stats.directoriesCount).toBe(1);
        expect(typeof result.data.stats.searchDuration).toBe('number');
        
        // ❌ REMOVED: Input echoes (no options object)
        expect('options' in result.data).toBe(false);
      }
    });

    it('should handle ignore patterns', async () => {
      // Create test files
      await fs.writeFile(path.join(tempDir, 'keep.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'ignore.log'), 'content');
      await fs.writeFile(path.join(tempDir, 'keep.js'), 'content');

      const input: LsToolInput = {
        path: tempDir,
        ignore: ['*.log']
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.entries).toContain('keep.txt');
        expect(result.data.entries).toContain('keep.js');
        expect(result.data.entries).not.toContain('ignore.log');
      }
    });

    it('should handle empty directories', async () => {
      const input: LsToolInput = {
        path: tempDir
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.entries).toEqual([]);
        expect(result.data.detailed_entries).toEqual([]);
        expect(result.data.stats.totalEntries).toBe(0);
        expect(result.data.stats.filesCount).toBe(0);
        expect(result.data.stats.directoriesCount).toBe(0);
      }
    });

    it('should sort entries alphabetically by default', async () => {
      // Create files in non-alphabetical order
      await fs.writeFile(path.join(tempDir, 'z-file.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'a-file.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'm-file.txt'), 'content');

      const input: LsToolInput = {
        path: tempDir
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.entries).toEqual(['a-file.txt', 'm-file.txt', 'z-file.txt']);
      }
    });
  });

  describe('Error handling', () => {
    it('should fail for non-existent directories', async () => {
      const input: LsToolInput = {
        path: '/non/existent/path'
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('does not exist');
    });

    it('should fail for files (not directories)', async () => {
      const filePath = path.join(tempDir, 'test-file.txt');
      await fs.writeFile(filePath, 'content');

      const input: LsToolInput = {
        path: filePath
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not a directory');
    });

    it('should reject path traversal attempts', async () => {
      const input: LsToolInput = {
        path: '../../../etc'
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Absolute paths are required');
    });
  });

  describe('Metadata validation', () => {
    it('should include all required metadata fields', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'content');

      const input: LsToolInput = {
        path: tempDir
      };

      const result = await lsTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Core  fields
        expect(Array.isArray(result.data.entries)).toBe(true);
        
        // Enhanced metadata fields
        expect(Array.isArray(result.data.detailed_entries)).toBe(true);
        expect(result.data.detailed_entries[0]).toHaveProperty('name');
        expect(result.data.detailed_entries[0]).toHaveProperty('type');
        expect(result.data.detailed_entries[0]).toHaveProperty('modified');
        expect(result.data.detailed_entries[0]).toHaveProperty('isHidden');
        
        // Stats metadata
        expect(result.data.stats).toHaveProperty('totalEntries');
        expect(result.data.stats).toHaveProperty('filesCount');
        expect(result.data.stats).toHaveProperty('directoriesCount');
        expect(result.data.stats).toHaveProperty('symlinksCount');
        expect(result.data.stats).toHaveProperty('hiddenCount');
        expect(result.data.stats).toHaveProperty('totalSize');
        expect(result.data.stats).toHaveProperty('searchDuration');
        
        // Should not have input echoes
        expect('path' in result.data).toBe(false);
        expect('options' in result.data).toBe(false);
      }
    });
  });
});