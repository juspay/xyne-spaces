import { promises as fs } from 'fs';
import path from 'path';
import { GlobTool } from '../glob-tool.js';
import type { GlobToolInput } from '../schemas.js';

describe('GlobTool - Limits and Gitignore', () => {
  let globTool: GlobTool;
  let tempDir: string;

  beforeEach(async () => {
    globTool = new GlobTool();
    
    // Create a temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-temp', `glob-limit-test-${Date.now()}`);
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

  describe('100-Result Limit', () => {
    it('should limit results to 100 files and set truncated flag', async () => {
      // Create 150 files to exceed the limit
      for (let i = 0; i < 150; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.txt`), `content ${i}`);
      }

      const input: GlobToolInput = {
        pattern: '*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should limit to exactly 100 results
        expect(result.data.matches).toHaveLength(100);
        expect(result.data.detailed_matches).toHaveLength(100);
        
        // Should set truncated flag
        expect(result.data.stats.truncated).toBe(true);
        expect(result.data.stats.totalMatches).toBe(100);
      }
    });

    it('should not set truncated flag when results are under 100', async () => {
      // Create only 50 files
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.txt`), `content ${i}`);
      }

      const input: GlobToolInput = {
        pattern: '*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should return all 50 results
        expect(result.data.matches).toHaveLength(50);
        
        // Should NOT set truncated flag
        expect(result.data.stats.truncated).toBe(false);
        expect(result.data.stats.totalMatches).toBe(50);
      }
    });

    it('should provide truncation suggestion in LLM output when truncated', async () => {
      // Create 150 files to exceed the limit
      for (let i = 0; i < 150; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.txt`), `content ${i}`);
      }

      const input: GlobToolInput = {
        pattern: '*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);
      const llmOutput = globTool.getLLMOutput(result);

      expect(result.success).toBe(true);
      expect('suggestion' in llmOutput).toBe(true);
      if ('suggestion' in llmOutput) {
        expect(llmOutput.truncated).toBe(true);
        expect(llmOutput.suggestion).toContain('Results were limited to 100 files');
        expect(llmOutput.suggestion).toContain('more specific pattern');
        expect(llmOutput.matches).toHaveLength(100);
      }
    });

    it('should not provide truncation suggestion when not truncated', async () => {
      // Create only 50 files
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.txt`), `content ${i}`);
      }

      const input: GlobToolInput = {
        pattern: '*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);
      const llmOutput = globTool.getLLMOutput(result);

      expect(result.success).toBe(true);
      expect('suggestion' in llmOutput).toBe(false);
      expect('truncated' in llmOutput).toBe(false);
      if ('matches' in llmOutput) {
        expect(llmOutput.matches).toHaveLength(50);
      }
    });
  });

  describe('Gitignore Support', () => {
    beforeEach(async () => {
      // Create a .gitignore file
      const gitignoreContent = `
# Node modules
node_modules/
dist/

# IDE files
.vscode/
.idea/

# Temp files
*.tmp
temp/

# Build artifacts
build/
`;
      await fs.writeFile(path.join(tempDir, '.gitignore'), gitignoreContent);
    });

    it('should respect .gitignore patterns and exclude ignored files', async () => {
      // Create files that should be ignored
      await fs.mkdir(path.join(tempDir, 'node_modules'));
      await fs.writeFile(path.join(tempDir, 'node_modules', 'package.json'), '{}');
      await fs.mkdir(path.join(tempDir, 'dist'));
      await fs.writeFile(path.join(tempDir, 'dist', 'index.js'), 'compiled code');
      await fs.writeFile(path.join(tempDir, 'test.tmp'), 'temp data');
      await fs.mkdir(path.join(tempDir, 'temp'));
      await fs.writeFile(path.join(tempDir, 'temp', 'data.txt'), 'temp file');

      // Create files that should NOT be ignored
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'src.js'), 'source code');
      await fs.writeFile(path.join(tempDir, 'README.md'), 'documentation');

      const input: GlobToolInput = {
        pattern: '**/*',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Check that ignored files are NOT in results
        const matches = result.data.matches;
        const relativeMatches = matches.map(match => path.relative(tempDir, match));
        
        // Should NOT contain node_modules files
        expect(relativeMatches.some(match => match.includes('node_modules'))).toBe(false);
        
        // Should NOT contain dist files
        expect(relativeMatches.some(match => match.includes('dist'))).toBe(false);
        
        // Should NOT contain .tmp files
        expect(relativeMatches.some(match => match.endsWith('.tmp'))).toBe(false);
        
        // Should NOT contain temp directory files
        expect(relativeMatches.some(match => match.includes('temp/'))).toBe(false);
        
        // SHOULD contain non-ignored files
        expect(relativeMatches.some(match => match.endsWith('package.json'))).toBe(true);
        expect(relativeMatches.some(match => match.endsWith('src.js'))).toBe(true);
        expect(relativeMatches.some(match => match.endsWith('README.md'))).toBe(true);
        // Note: .gitignore is not expected to be found because it's a hidden file
        // and the glob tool ignores hidden files by default (ignoreHidden: true)
      }
    });

    it('should work normally when .gitignore does not exist', async () => {
      // Remove the .gitignore file
      await fs.unlink(path.join(tempDir, '.gitignore'));

      // Create some files
      await fs.writeFile(path.join(tempDir, 'file1.js'), 'content');
      await fs.writeFile(path.join(tempDir, 'file2.ts'), 'content');

      const input: GlobToolInput = {
        pattern: '*.js',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should find the JS file normally
        expect(result.data.matches).toHaveLength(1);
        expect(result.data.matches[0]).toContain('file1.js');
      }
    });

    it('should handle gitignore negation patterns', async () => {
      // Create .gitignore with negation pattern
      const gitignoreContent = `
*.log
!important.log
`;
      await fs.writeFile(path.join(tempDir, '.gitignore'), gitignoreContent);

      // Create log files
      await fs.writeFile(path.join(tempDir, 'debug.log'), 'debug info');
      await fs.writeFile(path.join(tempDir, 'error.log'), 'error info');
      await fs.writeFile(path.join(tempDir, 'important.log'), 'important info');

      const input: GlobToolInput = {
        pattern: '*.log',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should only include important.log (due to negation pattern)
        expect(result.data.matches).toHaveLength(1);
        expect(result.data.matches[0]).toContain('important.log');
        
        // Should NOT include other log files
        expect(result.data.matches.some(match => match.includes('debug.log'))).toBe(false);
        expect(result.data.matches.some(match => match.includes('error.log'))).toBe(false);
      }
    });

    it('should handle directory-specific gitignore patterns', async () => {
      // Create .gitignore with directory pattern
      const gitignoreContent = `
temp/
*.tmp
`;
      await fs.writeFile(path.join(tempDir, '.gitignore'), gitignoreContent);

      // Create temp directory and files
      await fs.mkdir(path.join(tempDir, 'temp'));
      await fs.writeFile(path.join(tempDir, 'temp', 'file1.txt'), 'temp file');
      await fs.writeFile(path.join(tempDir, 'temp', 'file2.txt'), 'temp file');
      
      // Create non-temp files
      await fs.writeFile(path.join(tempDir, 'regular.txt'), 'regular file');
      await fs.writeFile(path.join(tempDir, 'data.tmp'), 'temp data');

      const input: GlobToolInput = {
        pattern: '**/*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        const relativeMatches = result.data.matches.map(match => path.relative(tempDir, match));
        
        // Should only include regular.txt, not files in temp/
        expect(relativeMatches).toHaveLength(1);
        expect(relativeMatches[0]).toBe('regular.txt');
        
        // Should NOT include files from temp directory
        expect(relativeMatches.some(match => match.includes('temp/'))).toBe(false);
      }
    });
  });

  describe('Combined Limits and Gitignore', () => {
    it('should apply both 100-result limit and gitignore filtering', async () => {
      // Create .gitignore
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'ignored/\n*.tmp\n');
      
      // Create ignored directory with many files
      await fs.mkdir(path.join(tempDir, 'ignored'));
      for (let i = 0; i < 200; i++) {
        await fs.writeFile(path.join(tempDir, 'ignored', `file${i}.txt`), 'ignored');
      }
      
      // Create non-ignored files (150 of them to test limit)
      for (let i = 0; i < 150; i++) {
        await fs.writeFile(path.join(tempDir, `valid${i}.txt`), 'valid');
      }

      const input: GlobToolInput = {
        pattern: '**/*.txt',
        path: tempDir
      };

      const result = await globTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        // Should limit to 100 results
        expect(result.data.matches).toHaveLength(100);
        
        // Should be truncated due to limit
        expect(result.data.stats.truncated).toBe(true);
        
        // Should NOT contain any ignored files
        expect(result.data.matches.some(match => match.includes('ignored/'))).toBe(false);
        
        // Should only contain valid files
        expect(result.data.matches.every(match => match.includes('valid'))).toBe(true);
      }
    });
  });
});