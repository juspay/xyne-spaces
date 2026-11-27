import type { ExtractorGroups } from '../extractors.js';
import { getMessageContentLength } from '@xyne/shared';

/** Visible length (same rule as the composer/repository limit) and emptiness. */
export function extractText(text: string): ExtractorGroups['text'] {
  return { length: getMessageContentLength(text), isEmpty: text.trim() === '' };
}
