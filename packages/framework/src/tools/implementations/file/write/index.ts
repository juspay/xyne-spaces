/**
 * File Write Tool Module
 * 
 * Provides secure file writing capabilities with:
 * - Relative path validation only (security feature)
 * - Automatic parent directory creation
 * - Content processing and EOF marker stripping
 * - Change tracking with diff summaries
 * - Comprehensive error handling
 */

export { WriteTool } from './write-tool.js';
export { 
  WriteToolInputSchema, 
  WriteToolOutputSchema,
  type WriteToolInput,
  type WriteToolOutput 
} from './schemas.js';
export {
  validateWriteFilePath,
  ensureDirectoryExists,
  getExistingFileInfo,
  validateFileContent,
  mapFileSystemError
} from './security.js';
export {
  stripEOFMarkers,
  processContent,
  generateDiffSummary,
  generateWriteSuggestions,
  type DiffSummary
} from './content-processor.js';