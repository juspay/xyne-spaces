import {
  validateGlobPath,
  validateGlobPattern,
  shouldIgnorePath,
  validateSearchDirectory,
  globToRegex
} from '../validation.js';

describe('Glob Validation', () => {
  describe('validateGlobPath', () => {
    it('should accept relative paths', () => {
      expect(() => validateGlobPath('.')).not.toThrow();
      expect(() => validateGlobPath('src')).not.toThrow();
      expect(() => validateGlobPath('src/tools')).not.toThrow();
    });

    it('should accept absolute paths  ', () => {
      expect(() => validateGlobPath('/etc/passwd')).not.toThrow();
      expect(() => validateGlobPath('/Users/username/projects')).not.toThrow();
      // Only test Windows paths on Windows platform
      if (process.platform === 'win32') {
        expect(() => validateGlobPath('C:\\Users\\username')).not.toThrow();
      }
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateGlobPath('../../../etc')).toThrow('Path traversal detected');
      expect(() => validateGlobPath('..')).toThrow('Path traversal detected');
      expect(() => validateGlobPath('..\\Windows')).toThrow('Path traversal detected');
    });

    it('should use current directory as default', () => {
      const result = validateGlobPath();
      expect(result).toBe(process.cwd());
    });
  });

  describe('validateGlobPattern', () => {
    it('should accept valid glob patterns', () => {
      expect(() => validateGlobPattern('*.js')).not.toThrow();
      expect(() => validateGlobPattern('**/*.ts')).not.toThrow();
      expect(() => validateGlobPattern('src/**/*.{js,ts}')).not.toThrow();
      expect(() => validateGlobPattern('test-*.js')).not.toThrow();
      expect(() => validateGlobPattern('?ile.txt')).not.toThrow();
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(2001);
      expect(() => validateGlobPattern(longPattern)).toThrow('Pattern too long');
    });
  });

  describe('shouldIgnorePath', () => {
    const basePath = '/test/base';

    it('should ignore hidden files when ignoreHidden is true', () => {
      expect(shouldIgnorePath('/test/base/.hidden', { ignoreHidden: true, basePath })).toBe(true);
      expect(shouldIgnorePath('/test/base/dir/.hidden', { ignoreHidden: true, basePath })).toBe(true);
      expect(shouldIgnorePath('/test/base/normal.txt', { ignoreHidden: true, basePath })).toBe(false);
    });

    it('should not ignore hidden files when ignoreHidden is false', () => {
      expect(shouldIgnorePath('/test/base/.hidden', { ignoreHidden: false, basePath })).toBe(false);
      expect(shouldIgnorePath('/test/base/dir/.hidden', { ignoreHidden: false, basePath })).toBe(false);
    });

    it('should respect maxDepth limits', () => {
      expect(shouldIgnorePath('/test/base/level1', { maxDepth: 1, basePath })).toBe(false);
      expect(shouldIgnorePath('/test/base/level1/level2', { maxDepth: 1, basePath })).toBe(true);
      expect(shouldIgnorePath('/test/base/level1/level2/level3', { maxDepth: 2, basePath })).toBe(true);
    });

    it('should not ignore when no options are set', () => {
      expect(shouldIgnorePath('/test/base/any/path', { basePath })).toBe(false);
    });

    it('should not ignore . and .. directories', () => {
      expect(shouldIgnorePath('/test/base/.', { ignoreHidden: true, basePath })).toBe(false);
      expect(shouldIgnorePath('/test/base/..', { ignoreHidden: true, basePath })).toBe(false);
    });
  });

  describe('validateSearchDirectory', () => {
    it('should return false for non-existent directories', async () => {
      const result = await validateSearchDirectory('non-existent-directory-12345');
      expect(result).toBe(false);
    });

    it('should return true for existing directory', async () => {
      // Test with current directory which should exist
      const result = await validateSearchDirectory('.');
      expect(result).toBe(true);
    });
  });

  describe('globToRegex', () => {
    it('should convert simple patterns correctly', () => {
      const regex1 = globToRegex('*.js');
      expect(regex1.test('file.js')).toBe(true);
      expect(regex1.test('file.ts')).toBe(false);
      expect(regex1.test('path/file.js')).toBe(false); // * doesn't match /

      const regex2 = globToRegex('test.?');
      expect(regex2.test('test.c')).toBe(true);
      expect(regex2.test('test.js')).toBe(false); // ? matches single char
    });

    it('should handle recursive patterns', () => {
      const regex = globToRegex('**/test.js');
      expect(regex.test('test.js')).toBe(true);
      expect(regex.test('dir/test.js')).toBe(true);
      expect(regex.test('deep/nested/dir/test.js')).toBe(true);
      expect(regex.test('test.ts')).toBe(false);
    });

    it('should handle character classes', () => {
      const regex = globToRegex('test[0-9].js');
      expect(regex.test('test1.js')).toBe(true);
      expect(regex.test('test9.js')).toBe(true);
      expect(regex.test('testa.js')).toBe(false);
    });

    it('should handle brace expansion', () => {
      const regex = globToRegex('*.{js,ts}');
      expect(regex.test('file.js')).toBe(true);
      expect(regex.test('file.ts')).toBe(true);
      expect(regex.test('file.py')).toBe(false);
    });

    it('should escape special regex characters', () => {
      const regex = globToRegex('test.file');
      expect(regex.test('test.file')).toBe(true);
      expect(regex.test('testXfile')).toBe(false); // . should be literal
    });

    it('should handle complex patterns', () => {
      const regex = globToRegex('src/**/*.{js,ts}');
      expect(regex.test('src/file.js')).toBe(true);
      expect(regex.test('src/deep/nested/file.ts')).toBe(true);
      expect(regex.test('other/file.js')).toBe(false);
      expect(regex.test('src/file.py')).toBe(false);
    });

    it('should be case insensitive', () => {
      const regex = globToRegex('*.JS');
      expect(regex.test('file.js')).toBe(true);
      expect(regex.test('FILE.JS')).toBe(true);
    });
  });
});