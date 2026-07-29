import {
  validateSearchPath,
  validatePattern,
  validateFileType,
  validateGlobPattern,
  shouldSearchFile,
  getFileInfo
} from '../validation.js';

describe('Grep Validation', () => {
  describe('validateSearchPath', () => {
    it('should accept relative paths', () => {
      expect(() => validateSearchPath('.')).not.toThrow();
      expect(() => validateSearchPath('src')).not.toThrow();
      expect(() => validateSearchPath('src/tools')).not.toThrow();
    });

    it('should accept absolute paths  ', () => {
      expect(() => validateSearchPath('/etc/passwd')).not.toThrow();
      expect(() => validateSearchPath('/Users/username/projects')).not.toThrow();
      // Only test Windows paths on Windows platform
      if (process.platform === 'win32') {
        expect(() => validateSearchPath('C:\\Users\\username')).not.toThrow();
      }
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateSearchPath('../../../etc')).toThrow('Path traversal detected');
      expect(() => validateSearchPath('..')).toThrow('Path traversal detected');
      expect(() => validateSearchPath('..\\Windows')).toThrow('Path traversal detected');
    });

    it('should use current directory as default', () => {
      const result = validateSearchPath();
      expect(result).toBe(process.cwd());
    });
  });

  describe('validatePattern', () => {
    it('should accept valid regex patterns', () => {
      expect(() => validatePattern('hello')).not.toThrow();
      expect(() => validatePattern('\\d+')).not.toThrow();
      expect(() => validatePattern('(test|example)')).not.toThrow();
      expect(() => validatePattern('^start.*end$')).not.toThrow();
    });

    it('should reject invalid regex patterns', () => {
      expect(() => validatePattern('[')).toThrow('Invalid regex pattern');
      expect(() => validatePattern('(unclosed')).toThrow('Invalid regex pattern');
      expect(() => validatePattern('*')).toThrow('Invalid regex pattern');
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(5001);
      expect(() => validatePattern(longPattern)).toThrow('Pattern too long');
    });
  });

  describe('validateFileType', () => {
    it('should return empty array for undefined type', () => {
      const result = validateFileType();
      expect(result).toEqual([]);
    });

    it('should allow any file type (validation delegated to ripgrep)', () => {
      expect(validateFileType('js')).toEqual([]);
      expect(validateFileType('ts')).toEqual([]);
      expect(validateFileType('py')).toEqual([]);
      expect(validateFileType('go')).toEqual([]);
      expect(validateFileType('js,ts,jsx,tsx')).toEqual([]);
      expect(validateFileType('custom')).toEqual([]);
      expect(validateFileType('unsupported')).toEqual([]);
    });

    it('should reject excessively long file type parameters', () => {
      const longType = 'a'.repeat(201);
      expect(() => validateFileType(longType)).toThrow('File type parameter too long');
    });
  });

  describe('validateGlobPattern', () => {
    it('should accept valid glob patterns', () => {
      expect(() => validateGlobPattern('*.js')).not.toThrow();
      expect(() => validateGlobPattern('**/*.ts')).not.toThrow();
      expect(() => validateGlobPattern('test-*.{js,ts}')).not.toThrow();
    });

    it('should accept undefined pattern', () => {
      expect(() => validateGlobPattern()).not.toThrow();
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(1001);
      expect(() => validateGlobPattern(longPattern)).toThrow('Glob pattern too long');
    });
  });

  describe('shouldSearchFile', () => {
    it('should return true when no filters are applied', () => {
      expect(shouldSearchFile('test.txt', [])).toBe(true);
      expect(shouldSearchFile('anything.xyz', [])).toBe(true);
    });

    it('should filter by type extensions', () => {
      const jsExtensions = ['.js', '.jsx'];
      expect(shouldSearchFile('test.js', jsExtensions)).toBe(true);
      expect(shouldSearchFile('test.jsx', jsExtensions)).toBe(true);
      expect(shouldSearchFile('test.ts', jsExtensions)).toBe(false);
      expect(shouldSearchFile('test.py', jsExtensions)).toBe(false);
    });

    it('should filter by glob pattern', () => {
      expect(shouldSearchFile('test.js', [], '*.js')).toBe(true);
      expect(shouldSearchFile('test.ts', [], '*.js')).toBe(false);
      expect(shouldSearchFile('component.test.js', [], '*.test.js')).toBe(true);
    });

    it('should handle complex glob patterns', () => {
      expect(shouldSearchFile('test.js', [], '*.{js,ts}')).toBe(true);
      expect(shouldSearchFile('test.ts', [], '*.{js,ts}')).toBe(true);
      expect(shouldSearchFile('test.py', [], '*.{js,ts}')).toBe(false);
    });

    it('should apply both type and glob filters', () => {
      const jsExtensions = ['.js', '.jsx'];
      expect(shouldSearchFile('test.js', jsExtensions, '*.js')).toBe(true);
      expect(shouldSearchFile('test.jsx', jsExtensions, '*.js')).toBe(false); // Passes type but fails glob
      expect(shouldSearchFile('test.ts', jsExtensions, '*.ts')).toBe(false); // Fails type
    });
  });

  describe('getFileInfo', () => {
    it('should return exists: false for non-existent files', async () => {
      try {
        const result = await getFileInfo('non-existent-file-12345.txt');
        expect(result.exists).toBe(false);
        expect(result.isFile).toBe(false);
        expect(result.isDirectory).toBe(false);
      } catch (error) {
        // If the function throws, it should be for non-ENOENT errors only
        expect(error).not.toHaveProperty('code', 'ENOENT');
      }
    });

    it('should return correct structure for existing directory', async () => {
      // Test with current directory which should exist
      const result = await getFileInfo('.');
      expect(result).toHaveProperty('exists');
      expect(result).toHaveProperty('isFile');
      expect(result).toHaveProperty('isDirectory');
      expect(typeof result.exists).toBe('boolean');
      expect(typeof result.isFile).toBe('boolean');
      expect(typeof result.isDirectory).toBe('boolean');
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
      expect(result.isFile).toBe(false);
    });
  });
});