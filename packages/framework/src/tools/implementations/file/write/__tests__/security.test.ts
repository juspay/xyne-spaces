import { promises as fs } from 'fs';
import path from 'path';
import {
  validateWriteFilePath,
  ensureDirectoryExists,
  getExistingFileInfo,
  validateFileContent,
  mapFileSystemError
} from '../security.js';

describe('Security utilities', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    
    // Create a temporary directory for tests
    tempDir = path.join(originalCwd, 'test-temp', `security-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Change to temp directory for relative path tests
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('validateWriteFilePath', () => {
    it('should accept valid relative paths', () => {
      const validPaths = [
        'file.txt',
        'dir/file.txt',
        'nested/deep/file.txt',
        './file.txt',
        'folder/../file.txt'
      ];

      for (const filePath of validPaths) {
        expect(() => validateWriteFilePath(filePath)).not.toThrow();
      }
    });

    it('should accept absolute paths like ', () => {
      const absolutePaths = [
        '/home/user/file.txt',
        '/tmp/test.txt'
      ];

      for (const filePath of absolutePaths) {
        expect(() => validateWriteFilePath(filePath)).not.toThrow();
      }
    });

    it('should reject sensitive file names for security', () => {
      const sensitivePaths = [
        '/etc/passwd',
        '/home/user/.ssh/authorized_keys'
      ];

      for (const filePath of sensitivePaths) {
        expect(() => validateWriteFilePath(filePath)).toThrow(/sensitive file/);
      }
    });

    it('should reject path traversal attempts', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        'dir/../../etc/passwd'
      ];

      for (const filePath of maliciousPaths) {
        expect(() => validateWriteFilePath(filePath)).toThrow(/Path traversal detected/);
      }
    });



    it('should reject sensitive file names', () => {
      const sensitiveFiles = [
        'passwd',
        'shadow',
        '.bashrc',
        'authorized_keys',
        'id_rsa'
      ];

      for (const filePath of sensitiveFiles) {
        expect(() => validateWriteFilePath(filePath)).toThrow('Writing to sensitive file');
      }
    });

    it('should normalize and resolve paths correctly', () => {
      const result = validateWriteFilePath('file.txt');
      expect(result).toBe(path.resolve(tempDir, 'file.txt'));
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should create directories that do not exist', async () => {
      const filePath = path.join(tempDir, 'new', 'nested', 'file.txt');
      const created = await ensureDirectoryExists(filePath);

      expect(created).toBe(true);
      
      const dirPath = path.dirname(filePath);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should return false for existing directories', async () => {
      const dirPath = path.join(tempDir, 'existing');
      await fs.mkdir(dirPath);
      
      const filePath = path.join(dirPath, 'file.txt');
      const created = await ensureDirectoryExists(filePath);

      expect(created).toBe(false);
    });
  });

  describe('getExistingFileInfo', () => {
    it('should return file info for existing files', async () => {
      const filePath = path.join(tempDir, 'existing.txt');
      const content = 'Test content';
      await fs.writeFile(filePath, content);

      const info = await getExistingFileInfo(filePath);

      expect(info.exists).toBe(true);
      expect(info.content).toBe(content);
      expect(info.size).toBe(content.length);
      expect(info.lastModified).toBeDefined();
      expect(typeof info.lastModified?.getTime).toBe('function');
    });

    it('should return exists: false for non-existent files', async () => {
      const filePath = 'nonexistent.txt'; // Use relative path in temp directory
      
      try {
        const info = await getExistingFileInfo(filePath);
        expect(info.exists).toBe(false);
        expect(info.content).toBeUndefined();
        expect(info.size).toBeUndefined();
        expect(info.lastModified).toBeUndefined();
      } catch (error) {
        // The function should not throw for non-existent files
        fail(`Function should return {exists: false} instead of throwing: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    it('should throw error if path exists but is not a file', async () => {
      const dirPath = path.join(tempDir, 'directory');
      await fs.mkdir(dirPath);

      await expect(getExistingFileInfo(dirPath)).rejects.toThrow('Path exists but is not a file');
    });
  });

  describe('validateFileContent', () => {
    it('should accept safe content', () => {
      const safeContent = [
        'Hello, World!',
        'function add(a, b) { return a + b; }',
        'const data = { key: "value" };',
        'Normal text with numbers 123 and symbols !@#$%'
      ];

      for (const content of safeContent) {
        expect(() => validateFileContent(content)).not.toThrow();
      }
    });

  });

  describe('mapFileSystemError', () => {
    it('should map EACCES to permission denied', () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const mapped = mapFileSystemError(error, 'test.txt');

      expect(mapped.message).toContain('Permission denied');
      expect(mapped.message).toContain('Use terminal to write file if required');
    });

    it('should map ENOSPC to no space left', () => {
      const error = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      const mapped = mapFileSystemError(error, 'test.txt');

      expect(mapped.message).toContain('No space left on device');
    });

    it('should map EROFS to read-only file system', () => {
      const error = Object.assign(new Error('read-only file system'), { code: 'EROFS' });
      const mapped = mapFileSystemError(error, 'test.txt');

      expect(mapped.message).toContain('Read-only file system');
    });

    it('should provide fallback for unknown errors', () => {
      const error = new Error('Unknown error');
      const mapped = mapFileSystemError(error, 'test.txt');

      expect(mapped.message).toContain('Unknown error writing file');
      expect(mapped.message).toContain('Use terminal to write file if required');
    });

    it('should handle non-Error objects', () => {
      const error = 'string error';
      const mapped = mapFileSystemError(error, 'test.txt');

      expect(mapped.message).toContain('Unknown error writing file');
    });
  });
});