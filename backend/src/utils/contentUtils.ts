import { convert } from 'html-to-text';
import {logger} from '@/utils/logger';

/**
 * Converts HTML content to plain text for search indexing
 * Preserves code structure while making it searchable
 */
export function extractPlainTextFromHtml(htmlContent: string): string {
  if (!htmlContent || htmlContent.trim() === '') {
    return '';
  }
  try {
    const plainText = convert(htmlContent, {
      wordwrap: false,
      selectors: [
        // Preserve code blocks with some formatting
        { 
          selector: 'pre', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        // Preserve inline code
        { 
          selector: 'code', 
          format: 'inline',
          options: { 
            leadingLineBreaks: 0, 
            trailingLineBreaks: 0 
          } 
        },
        // Handle paragraphs
        { 
          selector: 'p', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        // Handle line breaks
        { 
          selector: 'br', 
          format: 'lineBreak' 
        },
        // Handle headings
        { 
          selector: 'h1, h2, h3, h4, h5, h6', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        // Handle lists
        { 
          selector: 'ul, ol', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'li', 
          format: 'block',
          options: { 
            leadingLineBreaks: 0, 
            trailingLineBreaks: 0 
          } 
        },
        // Handle blockquotes
        { 
          selector: 'blockquote', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        }
      ],
      // Preserve whitespace in code elements
      preserveNewlines: true,
      // Don't format links as [text](url) to keep clean
      formatters: {
        'anchor': (elem, walk, builder) => {
          const text = walk(elem.children, builder);
          return text; // Just return the text, ignore the href
        }
      }
    });

    // Clean up excessive whitespace while preserving meaningful breaks
    return plainText
      .replace(/(\r\n|\n|\r){3,}/g, '\n\n') // Replace 3+ newlines with 2
      .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
      .trim(); // Trim start/end whitespace

  } catch (error) {
    logger.error('Error converting HTML to plain text:', error);
    // Fallback: strip HTML tags manually
    return htmlContent
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .trim();
  }
}

/**
 * Validates that plain text content is reasonable
 */
export function validatePlainTextContent(content: string): boolean {
  // Check if content is not just whitespace
  if (!content || content.trim() === '') {
    return false;
  }

  // Check if content is not excessively long
  if (content.length > 50000) { // 50k character limit
    return false;
  }

  return true;
}

/**
 * Generates plain text content for a message
 * Handles edge cases and validation
 */
export function generatePlainTextContent(htmlContent: string): string {
  const plainText = extractPlainTextFromHtml(htmlContent);
  
  // If extraction failed or resulted in empty content, try fallback
  if (!validatePlainTextContent(plainText)) {
    // Fallback for edge cases
    if (htmlContent && htmlContent.trim() !== '') {
      const fallback = htmlContent
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (validatePlainTextContent(fallback)) {
        return fallback;
      }
    }
    
    // Return empty string if all fails
    return '';
  }
  
  return plainText;
}