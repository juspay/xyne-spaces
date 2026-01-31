import {
  stripEOFMarkers,
  processContent,
  generateDiffSummary,
  generateWriteSuggestions
} from '../content-processor.js';

describe('Content processor utilities', () => {
  describe('stripEOFMarkers', () => {
    it('should remove single EOF marker', () => {
      const content = 'Line 1\n<<<EOF_FILE>>>\nLine 2';
      const result = stripEOFMarkers(content);
      
      expect(result).toBe('Line 1\n\nLine 2');
    });

    it('should remove multiple EOF markers', () => {
      const content = 'Start\n<<<EOF_FILE>>>\nMiddle\n<<<EOF_FILE>>>\nEnd';
      const result = stripEOFMarkers(content);
      
      expect(result).toBe('Start\n\nMiddle\n\nEnd');
    });

    it('should handle content without EOF markers', () => {
      const content = 'Normal content without markers';
      const result = stripEOFMarkers(content);
      
      expect(result).toBe(content);
    });

    it('should handle empty content', () => {
      const result = stripEOFMarkers('');
      expect(result).toBe('');
    });

    it('should handle content with only EOF markers', () => {
      const content = '<<<EOF_FILE>>><<<EOF_FILE>>>';
      const result = stripEOFMarkers(content);
      
      expect(result).toBe('');
    });
  });

  describe('processContent', () => {
    it('should strip EOF markers when stripEOF is true', () => {
      const content = 'Content\n<<<EOF_FILE>>>\nMore content';
      const result = processContent(content, true);
      
      expect(result).toBe('Content\n\nMore content');
    });

    it('should preserve EOF markers when stripEOF is false', () => {
      const content = 'Content\n<<<EOF_FILE>>>\nMore content';
      const result = processContent(content, false);
      
      expect(result).toBe(content);
    });

    it('should default to stripping EOF markers', () => {
      const content = 'Content\n<<<EOF_FILE>>>\nMore content';
      const result = processContent(content);
      
      expect(result).toBe('Content\n\nMore content');
    });
  });

  describe('generateDiffSummary', () => {
    it('should detect no changes for identical content', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const diff = generateDiffSummary(content, content);
      
      expect(diff.hasChanges).toBe(false);
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesRemoved).toBe(0);
      expect(diff.linesModified).toBe(0);
    });

    it('should detect added lines', () => {
      const original = 'Line 1\nLine 2';
      const modified = 'Line 1\nLine 2\nLine 3\nLine 4';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesAdded).toBe(2);
      expect(diff.linesRemoved).toBe(0);
    });

    it('should detect removed lines', () => {
      const original = 'Line 1\nLine 2\nLine 3\nLine 4';
      const modified = 'Line 1\nLine 2';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesRemoved).toBe(2);
    });

    it('should detect modified lines', () => {
      const original = 'Line 1\nLine 2\nLine 3';
      const modified = 'Line 1 modified\nLine 2\nLine 3 changed';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesModified).toBe(2);
    });

    it('should handle empty original content', () => {
      const original = '';
      const modified = 'New line 1\nNew line 2';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesAdded).toBe(2);
      expect(diff.linesRemoved).toBe(0);
    });

    it('should handle empty new content', () => {
      const original = 'Line 1\nLine 2';
      const modified = '';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesRemoved).toBe(2);
    });

    it('should handle complex changes', () => {
      const original = 'Line 1\nLine 2\nLine 3\nLine 4';
      const modified = 'Line 1 modified\nLine 2\nNew line\nLine 5\nLine 6';
      const diff = generateDiffSummary(original, modified);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.linesAdded).toBe(1); // 5 lines in new vs 4 in original
      expect(diff.linesRemoved).toBe(0);
      expect(diff.linesModified).toBeGreaterThan(0);
    });
  });

  describe('generateWriteSuggestions', () => {
    it('should suggest new file creation', () => {
      const suggestions = generateWriteSuggestions('test.txt', true, true, 100);
      
      expect(suggestions).toContain('New file created: test.txt');
    });

    it('should suggest content modification', () => {
      const suggestions = generateWriteSuggestions('test.txt', false, true, 100);
      
      expect(suggestions).toContain('File content modified: 100 bytes written');
    });

    it('should suggest no changes detected', () => {
      const suggestions = generateWriteSuggestions('test.txt', false, false, 100);
      
      expect(suggestions).toContain('No changes detected - file content is identical');
    });

    it('should provide TypeScript specific suggestions', () => {
      const suggestions = generateWriteSuggestions('test.ts', true, true, 100);
      
      expect(suggestions).toContain('Consider running TypeScript compiler or linter to check syntax');
    });

    it('should provide JavaScript specific suggestions', () => {
      const suggestions = generateWriteSuggestions('script.js', true, true, 100);
      
      expect(suggestions).toContain('Consider running TypeScript compiler or linter to check syntax');
    });

    it('should provide JSON specific suggestions', () => {
      const suggestions = generateWriteSuggestions('config.json', true, true, 100);
      
      expect(suggestions).toContain('Consider validating JSON syntax');
    });

    it('should provide Markdown specific suggestions', () => {
      const suggestions = generateWriteSuggestions('README.md', true, true, 100);
      
      expect(suggestions).toContain('Consider checking Markdown formatting');
    });

    it('should provide YAML specific suggestions', () => {
      const suggestions = generateWriteSuggestions('config.yaml', true, true, 100);
      
      expect(suggestions).toContain('Consider validating YAML syntax');
    });

    it('should warn about large files', () => {
      const largeFileSize = 2 * 1024 * 1024; // 2MB
      const suggestions = generateWriteSuggestions('large.txt', true, true, largeFileSize);
      
      expect(suggestions).toContain('Large file written - consider checking file size and performance implications');
    });

    it('should handle files without extensions', () => {
      const suggestions = generateWriteSuggestions('Makefile', true, true, 100);
      
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('New file created');
    });

    it('should handle unknown file extensions', () => {
      const suggestions = generateWriteSuggestions('file.xyz', true, true, 100);
      
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toContain('New file created');
    });
  });
});