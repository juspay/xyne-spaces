import type { BlockNoteEditor } from '@blocknote/core';

export interface SearchMatch {
  blockId: string;
  textOffset: number;
  length: number;
  text: string;
}

interface SearchMatchWithIndex extends SearchMatch {
  originalIndex: number;
}

interface BlockContent {
  type?: string;
  text?: string;
  content?: BlockContent[];
}

// --- Helper: Robust Text Extraction ---
// Recursively extracts text from any block content to match what is rendered in the DOM.
const getBlockText = (content: BlockContent[]): string => {
  if (!content || !Array.isArray(content)) return '';

  return content
    .map(item => {
      // Case 1: Simple Text node
      if (item.type === 'text' && item.text) {
        return item.text;
      }
      // Case 2: Link or other wrapper with nested content
      if (item.content && Array.isArray(item.content)) {
        return getBlockText(item.content);
      }
      // Case 3: Fallback for other types that might have a text property
      if (item.text) {
        return item.text;
      }
      return '';
    })
    .join('');
};

export const extractTextFromBlocks = (editor: BlockNoteEditor): string => {
  const textParts: string[] = [];
  editor.forEachBlock(block => {
    const text = getBlockText((block.content || []) as BlockContent[]);
    if (text) textParts.push(text);
    return true;
  });
  return textParts.join('\n');
};

export const findMatches = (editor: BlockNoteEditor, query: string): SearchMatch[] => {
  if (!query.trim()) return [];

  const matches: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  editor.forEachBlock(block => {
    // Use the robust extraction here
    const blockText = getBlockText((block.content || []) as BlockContent[]);

    if (!blockText) return true;

    const lowerBlockText = blockText.toLowerCase();
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = lowerBlockText.indexOf(lowerQuery, offset);
      if (index === -1) break;

      matches.push({
        blockId: block.id,
        textOffset: index,
        length: query.length,
        text: blockText.substring(index, index + query.length),
      });

      offset = index + 1;
    }

    return true;
  });

  return matches;
};

// --- Helper: Find DOM Position from "Clean" Offset ---
const getDomPosition = (
  textNodes: Text[],
  targetOffset: number,
): { node: Text; offset: number } | null => {
  let currentGlobalOffset = 0;

  for (const node of textNodes) {
    const rawText = node.textContent || '';

    // We filter out "junk" characters that usually don't appear in the data model
    // but might appear in the DOM (like zero-width spaces or formatting newlines).
    // Note: We count regular spaces!
    const mapping: number[] = [];

    for (let i = 0; i < rawText.length; i++) {
      const char = rawText[i];
      // Filter logic: Keep everything except explicit formatting noise
      // If your citations [1] are distinct nodes, they will be counted correctly now.
      if (char && !/^[\n\r\t\u200B\uFEFF]$/.test(char)) {
        mapping.push(i);
      }
    }

    const validCharsInNode = mapping.length;

    // Is the target offset within this node?
    if (targetOffset < currentGlobalOffset + validCharsInNode) {
      const localCleanIndex = targetOffset - currentGlobalOffset;
      // Safety check
      if (localCleanIndex < mapping.length) {
        const rawIndex = mapping[localCleanIndex];
        if (rawIndex !== undefined) {
          return { node, offset: rawIndex };
        }
      }
    }

    currentGlobalOffset += validCharsInNode;
  }

  return null;
};

// --- Highlight Implementation using CSS Custom Highlight API ---
export const applyHighlights = (
  container: HTMLElement | null,
  matches: SearchMatch[],
  currentIndex: number,
): void => {
  if (!container) return;

  if (!CSS.highlights) {
    console.warn('CSS Custom Highlight API not supported in this browser.');
    return;
  }

  const normalRanges: Range[] = [];
  const currentRanges: Range[] = [];

  if (matches.length > 0) {
    const matchesByBlock: Record<string, SearchMatchWithIndex[]> = {};
    matches.forEach((match, index) => {
      if (!matchesByBlock[match.blockId]) {
        matchesByBlock[match.blockId] = [];
      }
      const blockMatches = matchesByBlock[match.blockId];
      if (blockMatches) {
        blockMatches.push({ ...match, originalIndex: index });
      }
    });

    Object.entries(matchesByBlock).forEach(([blockId, blockMatches]) => {
      const blockElement = container.querySelector(`[data-id="${blockId}"]`);
      if (!blockElement) return;

      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(blockElement, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.length > 0) {
          textNodes.push(node as Text);
        }
      }

      blockMatches.forEach((match: SearchMatchWithIndex) => {
        const startPos = getDomPosition(textNodes, match.textOffset);
        const endPos = getDomPosition(textNodes, match.textOffset + match.length);

        if (startPos && endPos) {
          const range = document.createRange();
          try {
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset);

            if (match.originalIndex === currentIndex) {
              currentRanges.push(range);
            } else {
              normalRanges.push(range);
            }
          } catch {
            // Silently fail for individual ranges that might be slightly out of sync
            // during live typing, they will fix on next render.
          }
        }
      });
    });
  }

  const searchHighlight = new Highlight(...normalRanges);
  const currentHighlight = new Highlight(...currentRanges);

  CSS.highlights.set('canvas-search-match', searchHighlight);
  CSS.highlights.set('canvas-search-match-current', currentHighlight);
};

export const removeHighlights = (_container: HTMLElement | null): void => {
  if (CSS.highlights) {
    CSS.highlights.delete('canvas-search-match');
    CSS.highlights.delete('canvas-search-match-current');
  }
};

export const scrollToMatch = (container: HTMLElement | null, match: SearchMatch): void => {
  if (!container) return;
  const blockElement = container.querySelector(`[data-id="${match.blockId}"]`);
  if (blockElement) {
    blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};
