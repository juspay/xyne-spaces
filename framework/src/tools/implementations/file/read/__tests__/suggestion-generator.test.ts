import { 
  generateReadSuggestions, 
  generateContinuationSuggestion,
  generateContextSuggestion,
  type SuggestionContext 
} from '../suggestion-generator.js';

describe('SuggestionGenerator', () => {
  describe('generateReadSuggestions', () => {
    it('should suggest reading next chunk when file has more lines', () => {
      const context: SuggestionContext = {
        totalLines: 100,
        linesRead: 50,
        startLine: 1,
        endLine: 50,
        truncated: false,
        offset: 1,
        limit: 50,
        filePath: '/test/file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions).toContain(
        'File has 50 more lines after line 50. To read the next chunk, use the Read tool again with: offset: 51, limit: 50'
      );
    });

    it('should suggest reading from beginning when started with offset', () => {
      const context: SuggestionContext = {
        totalLines: 100,
        linesRead: 30,
        startLine: 21,
        endLine: 50,
        truncated: false,
        offset: 21,
        limit: 30,
        filePath: '/test/file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions.some(s => s.includes('To read from the beginning, use the Read tool again with: offset: 1'))).toBe(true);
    });

    it('should suggest reading the end of large files', () => {
      const context: SuggestionContext = {
        totalLines: 1000,
        linesRead: 50,
        startLine: 1,
        endLine: 50,
        truncated: false,
        offset: 1,
        limit: 50,
        filePath: '/test/large-file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions.some(s => s.includes('To read the last'))).toBe(true);
    });

    it('should warn about truncated lines', () => {
      const context: SuggestionContext = {
        totalLines: 10,
        linesRead: 10,
        startLine: 1,
        endLine: 10,
        truncated: true,
        offset: 1,
        limit: 10,
        filePath: '/test/file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions).toContain(
        'Some lines were truncated due to length (>2000 chars). Line content is still readable but may be incomplete for very long lines.'
      );
    });

    it('should suggest search tools for very large files', () => {
      const context: SuggestionContext = {
        totalLines: 10000,
        linesRead: 100,
        startLine: 1,
        endLine: 100,
        truncated: false,
        offset: 1,
        limit: 100,
        filePath: '/test/huge-file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions.some(s => s.includes('Grep tool to search'))).toBe(true);
    });

    it('should indicate success when entire file is read', () => {
      const context: SuggestionContext = {
        totalLines: 50,
        linesRead: 50,
        startLine: 1,
        endLine: 50,
        truncated: false,
        offset: 1,
        limit: 100,
        filePath: '/test/file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions).toContain('Successfully read entire file.');
    });

    it('should handle empty files', () => {
      const context: SuggestionContext = {
        totalLines: 0,
        linesRead: 0,
        startLine: 0,
        endLine: 0,
        truncated: false,
        filePath: '/test/empty-file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions).toContain('File is empty - no content to read.');
    });

    it('should describe current range when reading specific sections', () => {
      const context: SuggestionContext = {
        totalLines: 200,
        linesRead: 50,
        startLine: 51,
        endLine: 100,
        truncated: false,
        offset: 51,
        limit: 50,
        filePath: '/test/file.txt'
      };

      const suggestions = generateReadSuggestions(context);

      expect(suggestions.some(s => s.includes('Currently reading lines 51-100 of 200'))).toBe(true);
    });
  });

  describe('generateContinuationSuggestion', () => {
    it('should generate continuation suggestion when more lines exist', () => {
      const suggestion = generateContinuationSuggestion(50, 100, 50);

      expect(suggestion).toBe('To continue reading, use the Read tool again with: offset: 51, limit: 50');
    });

    it('should return null when at end of file', () => {
      const suggestion = generateContinuationSuggestion(100, 100, 50);

      expect(suggestion).toBeNull();
    });

    it('should limit suggestion to remaining lines', () => {
      const suggestion = generateContinuationSuggestion(90, 100, 50);

      expect(suggestion).toBe('To continue reading, use the Read tool again with: offset: 91, limit: 10');
    });
  });

  describe('generateContextSuggestion', () => {
    it('should generate context suggestion around target line', () => {
      const suggestion = generateContextSuggestion(100, 200, 20);

      expect(suggestion).toBe('To read around line 100, use the Read tool again with: offset: 90, limit: 21');
    });

    it('should handle context at beginning of file', () => {
      const suggestion = generateContextSuggestion(5, 200, 20);

      expect(suggestion).toBe('To read around line 5, use the Read tool again with: offset: 1, limit: 15');
    });

    it('should handle context at end of file', () => {
      const suggestion = generateContextSuggestion(195, 200, 20);

      expect(suggestion).toBe('To read around line 195, use the Read tool again with: offset: 185, limit: 16');
    });

    it('should handle small files', () => {
      const suggestion = generateContextSuggestion(5, 10, 20);

      expect(suggestion).toBe('To read around line 5, use the Read tool again with: offset: 1, limit: 10');
    });
  });
});