/**
 * Vespa Text Validation Utilities
 * 
 * Vespa has guardrails for binary detection in text fields:
 * - max-replacement-character-ratio: 25%
 * - max-replacement-characters: 5000
 * 
 * Documents exceeding these limits will fail indexing with:
 * "Some text of length X is classified as binary data as it contains Y Unicode replacement characters"
 * 
 * This utility strips Unicode replacement characters (\uFFFD) from text before indexing.
 */

import { logger } from '@/utils/logger';

export interface CleanedTextResult {
  replacementCount: number;
  ratio: number;
  cleanedText: string;
}

export interface CleanedChunksResult {
  cleanedChunks: string[];
  totalReplacements: number;
  affectedChunkCount: number;
}

const REPLACEMENT_CHAR = '\uFFFD';

/**
 * Strips Unicode replacement characters from text
 * Always returns cleaned text ready for Vespa indexing
 */
export function cleanVespaText(input: string): CleanedTextResult {
  const replacementCount = (input.match(/\uFFFD/g) || []).length;
  const totalLength = input.length;
  const ratio = totalLength > 0 ? replacementCount / totalLength : 0;
  const cleanedText = input.split(REPLACEMENT_CHAR).join('');

  return {
    replacementCount,
    ratio,
    cleanedText,
  };
}

/**
 * Cleans an array of chunks by stripping Unicode replacement characters
 * Always returns cleaned chunks ready for Vespa indexing
 */
export function cleanVespaChunks(chunks: string[]): CleanedChunksResult {
  let totalReplacements = 0;
  let affectedChunkCount = 0;
  const cleanedChunks: string[] = [];

  for (const chunk of chunks) {
    const result = cleanVespaText(chunk);
    
    if (result.replacementCount > 0) {
      totalReplacements += result.replacementCount;
      affectedChunkCount++;
    }

    cleanedChunks.push(result.cleanedText);
  }

  return {
    cleanedChunks,
    totalReplacements,
    affectedChunkCount,
  };
}

/**
 * Check if text contains any replacement characters
 */
export function hasReplacementCharacters(input: string): boolean {
  return input.includes(REPLACEMENT_CHAR);
}

/**
 * Get count of replacement characters in text
 */
export function countReplacementCharacters(input: string): number {
  return (input.match(/\uFFFD/g) || []).length;
}

/**
 * Clean text and chunk fields in a document by removing Unicode replacement characters
 * Recursively processes nested objects. This prevents Vespa from rejecting documents
 * with binary-like text content.
 */
export function cleanDocumentFields<T extends Record<string, any>>(data: T): T {
  const record = data as Record<string, any>;
  const docId = record.docId as string | undefined;

  for (const key of Object.keys(record)) {
    const value = record[key];

    if (typeof value === 'string') {
      const result = cleanVespaText(value);
      if (result.replacementCount > 0 && docId) {
        logger.info(`Cleaned ${result.replacementCount} replacement characters in ${key} for ${docId}`);
      }
      record[key] = result.cleanedText;
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      const result = cleanVespaChunks(value);
      if (result.totalReplacements > 0 && docId) {
        logger.info(`Cleaned ${result.totalReplacements} replacement characters in ${key} for ${docId}`);
      }
      record[key] = result.cleanedChunks;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      cleanDocumentFields(value);
    }
  }

  return data;
}
