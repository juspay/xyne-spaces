import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useMemo } from 'react';
import { RenderMessageWithHTML } from './RenderMessageWithHTML'; // Adjust import path as needed

interface SearchSnippetRendererProps {
  message: string;
  wordLimit?: number;
}

interface WordToken {
  node: Node;
  startOffset: number;
  endOffset: number;
  isHighlighted: boolean;
}

/**
 * Extracts a window of text centered around the highest density of <hi> tags.
 */

export const getSmartSnippet = (html: string, limit: number): string => {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  // 1. Traverse and Collect Words with Highlight Metadata
  const words: WordToken[] = [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);

  let currentNode: Node | null;
  while ((currentNode = walker.nextNode())) {
    const text = currentNode.textContent || '';
    // Check if immediate parent is the highlight tag <hi>
    const isHighlighted = currentNode.parentElement?.tagName.toLowerCase() === 'hi';

    const wordRegex = /\S+/g;
    let match;
    while ((match = wordRegex.exec(text)) !== null) {
      words.push({
        node: currentNode,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
        isHighlighted,
      });
    }
  }

  // If message is short enough, return it all
  if (words.length <= limit) {
    return body.innerHTML;
  }

  // 2. Optimized Sliding Window (O(N))
  // Calculate score for the very first window
  let currentScore = 0;
  for (let j = 0; j < limit; j++) {
    if (words[j]?.isHighlighted) {
      currentScore++;
    }
  }

  let maxScore = currentScore;
  let bestStartIndex = 0;

  // Slide the window one word at a time
  // i represents the START index of the NEW window
  for (let i = 1; i <= words.length - limit; i++) {
    // Remove the influence of the word that just left the window (index i - 1)
    if (words[i - 1]?.isHighlighted) {
      currentScore--;
    }

    // Add the influence of the new word entering the window (index i + limit - 1)
    if (words[i + limit - 1]?.isHighlighted) {
      currentScore++;
    }

    // Update max score if we found a denser area
    if (currentScore > maxScore) {
      maxScore = currentScore;
      bestStartIndex = i;
    }
  }

  // 3. Extract the DOM Range
  try {
    const startWord = words[bestStartIndex];
    const endWord = words[bestStartIndex + limit - 1];

    if (!startWord || !endWord) {
      // Fallback: extract plain text and truncate safely
      const plainText = body.textContent || '';
      const truncatedText = plainText.split(/\s+/).slice(0, limit).join(' ');
      return truncatedText + (plainText.length > truncatedText.length ? '...' : '');
    }

    const range = document.createRange();
    range.setStart(startWord.node, startWord.startOffset);
    range.setEnd(endWord.node, endWord.endOffset);

    const fragment = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(fragment);

    let resultHtml = div.innerHTML;

    // Add ellipses
    if (bestStartIndex > 0) {
      resultHtml = '... ' + resultHtml;
    }
    if (bestStartIndex + limit < words.length) {
      resultHtml = resultHtml + ' ...';
    }

    return resultHtml;
  } catch (e) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Smart truncation failed'),
      error: e,
    });
    const plainText = body.textContent || '';
    const wordsArray = plainText.split(/\s+/).filter(Boolean);

    if (wordsArray.length <= limit) {
      return plainText;
    }

    return wordsArray.slice(0, limit).join(' ') + ' ...';
  }
};

export const SearchSnippetRenderer: React.FC<SearchSnippetRendererProps> = ({
  message,
  wordLimit = 40,
}) => {
  // Memoize the expensive truncation operation
  const truncatedMessage = useMemo(() => {
    // Optimization: If no <hi> tag exists, we can either:
    // 1. Return the start of the message (standard truncation)
    // 2. Return the whole message (if you prefer)
    // Here we run the algorithm regardless to ensure we respect the word count.
    return getSmartSnippet(message, wordLimit);
  }, [message, wordLimit]);

  return <RenderMessageWithHTML message={truncatedMessage} />;
};
