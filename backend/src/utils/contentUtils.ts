import { convert } from 'html-to-text';
import DOMPurify from 'isomorphic-dompurify';
import { logger } from '@/utils/logger';

const CUSTOM_EMOJI_IMG_REGEX = /<img\b(?=[^>]*\bdata-emoji-id=["'][^"']+["'])([^>]*)>/gi;

function getHtmlAttribute(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match?.[1] ?? null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)));
}

export function replaceCustomEmojiImagesWithAltText(htmlContent: string): string {
  return htmlContent.replace(CUSTOM_EMOJI_IMG_REGEX, (_full, attrs: string) => {
    const alt = getHtmlAttribute(attrs, 'alt');
    if (alt) {
      return ` ${decodeHtmlEntities(alt)} `;
    }

    const title = getHtmlAttribute(attrs, 'title');
    return title ? ` :${decodeHtmlEntities(title)}: ` : ' ';
  });
}

/**
 * Sanitize text to prevent XSS by stripping all HTML tags
 * Uses DOMPurify with no allowed tags for maximum security
 * Use this for user-generated content that should be plain text
 */
export function sanitizeHtml(text: string): string {
  if (!text) return '';
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
}

// Strips scripts/handlers/unsafe URLs while keeping formatting tags.
export function sanitizeEmailBodyHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}

// IDs like appId (Apps.id / cuid) are alphanumeric only. Reject anything else
export function isAlphanumericId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9]+$/.test(value);
}

// HTML-encode a value before interpolating it into a double-quoted HTML attribute.
export function encodeHtmlAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Sanitizes message content for storage, preventing XSS when rendering markdown with rehype-raw on the client. Mutates data.content in place.
export function sanitizeMessageContent(content: string): string {
  if (!content) return content;

  return DOMPurify.sanitize(content, {
    USE_PROFILES: { html: true },

    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'textarea',
      'style',
      'link',
      'meta',
      'base',
    ],

    // DOMPurify already strips ALL event-handler attributes by default; we only
    // need to additionally block (iframe payload carrier).
    FORBID_ATTR: ['srcdoc'],

    ADD_ATTR: ['target', 'rel'],

    // Allow only https/mailto schemes + relative URLs; rejects javascript:/data:/vbscript:.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export function cleanEmailBodyHtml(html: string): string {
  if (!html?.trim()) return html;

  const working = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  return sanitizeEmailBodyHtml(working);
}

export function cleanEmailBodyText(text: string): string {
  if (!text?.trim()) return text;

  const lines = text.split('\n');
  const cleanLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (
      (trimmed.startsWith('From:') &&
        i + 1 < lines.length &&
        lines[i + 1].trim().startsWith('Sent:')) ||
      /\bFrom:.*\bSent:\s/i.test(trimmed)
    ) {
      break;
    }

    if (/^On .+ wrote:/.test(trimmed)) break;
    if (/^-{5,}/.test(trimmed) || /^_{5,}/.test(trimmed)) break;
    if (trimmed.startsWith('>')) break;

    cleanLines.push(lines[i]);
  }

  return cleanLines.join('\n').trimEnd().replace(/\n+/g, '<br>');
}

/**
 * Converts HTML content to plain text for search indexing
 * Preserves code structure while making it searchable
 */
export function extractPlainTextFromHtml(htmlContent: string): string {
  if (!htmlContent || htmlContent.trim() === '') {
    return '';
  }
  try {
    const plainText = convert(replaceCustomEmojiImagesWithAltText(htmlContent), {
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
          selector: 'h1', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'h2', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'h3', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'h4', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'h5', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'h6', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        // Handle lists - split into individual selectors
        { 
          selector: 'ul', 
          format: 'block',
          options: { 
            leadingLineBreaks: 1, 
            trailingLineBreaks: 1 
          } 
        },
        { 
          selector: 'ol', 
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