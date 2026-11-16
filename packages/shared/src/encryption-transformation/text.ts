import type { ExtractorOutput } from '../enc-contracts/extractors.js';
import { getMessageContentLength } from '../utils/messageContent.js';

/** Visible length (same rule as the composer/repository limit) and emptiness. */
export function extractText(text: string): ExtractorOutput['text'] {
  return { length: getMessageContentLength(text), isEmpty: text.trim() === '' };
}
