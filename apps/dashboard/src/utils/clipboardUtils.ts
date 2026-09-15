import { logger, Event as LogEvent } from './logger';
/**
 * Clipboard utilities for copying HTML content with proper formatting preservation
 */

import type { Element, Root } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const citationSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'cite', 'citation'],
  attributes: {
    ...defaultSchema.attributes,
    cite: ['dataCitationRef', 'ref'],
  },
};

/**
 * Rehype plugin: convert h1–h6 to <p><strong>...</strong></p> so headings paste as bold
 * in the Xyne TipTap editor (and other rich targets) which rely on <strong>/<b>, not <h2>.
 */
function rehypeHeadingsToBold() {
  return (tree: Root): void => {
    const isHeading = (node: unknown): node is Element => {
      return (
        node !== null &&
        typeof node === 'object' &&
        'type' in node &&
        'tagName' in node &&
        (node as Element).type === 'element' &&
        /^h[1-6]$/.test((node as Element).tagName)
      );
    };

    const visit = (node: Root | Element, parent: Root | Element | null, index: number): void => {
      if (isHeading(node)) {
        const strong: Element = {
          type: 'element',
          tagName: 'strong',
          properties: {},
          children: node.children,
        };
        const p: Element = {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [strong],
        };
        if (parent) {
          parent.children[index] = p;
        }
        return;
      }
      if ('children' in node && Array.isArray(node.children)) {
        node.children.forEach((child, i) => visit(child as Element, node as Root | Element, i));
      }
    };

    tree.children.forEach((child, i) => visit(child as Element, tree, i));
  };
}

/**
 * Converts markdown to HTML (headings as <p><strong>...</strong></p> for clipboard paste).
 */
export const markdownToHtml = async (markdown: string): Promise<string> => {
  try {
    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      // remarkBreaks turns a single newline inside a paragraph into a hard <br>.
      // Without it, CommonMark collapses "Best,\nNikunj Gupta" to "Best, Nikunj
      // Gupta" in one line — signatures need to be preserved as typed.
      .use(remarkBreaks)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeSanitize, citationSanitizeSchema)
      .use(rehypeHeadingsToBold)
      .use(rehypeStringify)
      .process(markdown);

    return String(file);
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to process markdown:'),
      error: error,
    });
    // Fallback to original markdown if processing fails
    return markdown;
  }
};

/**
 * Converts HTML to formatted plain text while preserving structure
 * - Preserves line breaks, lists, code blocks, blockquotes
 * - Maintains indentation and spacing
 */
export const htmlToFormattedText = (html: string): string => {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const processNode = (node: Node, indent = ''): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();

    switch (tagName) {
      case 'br':
        return '\n';

      case 'p':
      case 'div': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return content + '\n';
      }

      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return content + '\n\n';
      }

      case 'ul':
      case 'ol': {
        const items = Array.from(element.children).filter(
          child => child.tagName.toLowerCase() === 'li',
        );
        return (
          items
            .map((li, index) => {
              const bullet = tagName === 'ul' ? '• ' : `${index + 1}. `;
              const content = Array.from(li.childNodes)
                .map(child => processNode(child, indent + '  '))
                .join('')
                .trim();
              return `${indent}${bullet}${content}`;
            })
            .join('\n') + '\n'
        );
      }

      case 'li': {
        // This case handles nested lists
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return content;
      }

      case 'blockquote': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('')
          .trim();
        // Add '> ' prefix to each line
        return (
          content
            .split('\n')
            .map(line => `${indent}> ${line}`)
            .join('\n') + '\n'
        );
      }

      case 'pre': {
        // Check if there's a code element inside
        const codeElement = element.querySelector('code');
        const content = codeElement ? codeElement.textContent : element.textContent;
        // Preserve the exact formatting of code blocks
        return '```\n' + (content || '') + '\n```\n';
      }

      case 'code': {
        // Inline code
        const parent = element.parentElement;
        if (parent && parent.tagName.toLowerCase() === 'pre') {
          // Already handled by pre
          return element.textContent || '';
        }
        return `\`${element.textContent || ''}\``;
      }

      case 'a': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        const href = element.getAttribute('href');
        if (href && href !== content) {
          return `${content} (${href})`;
        }
        return content;
      }

      case 'strong':
      case 'b': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return `**${content}**`;
      }

      case 'em':
      case 'i': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return `*${content}*`;
      }

      case 'del':
      case 's': {
        const content = Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
        return `~~${content}~~`;
      }

      case 'hr':
        return '\n---\n';

      case 'img': {
        const alt = element.getAttribute('alt') || '';
        const src = element.getAttribute('src') || '';
        if (alt) return alt;
        if (src) return src;
        return '';
      }

      default: {
        // For other elements, just process children
        return Array.from(element.childNodes)
          .map(child => processNode(child, indent))
          .join('');
      }
    }
  };

  let text = processNode(doc.body);

  // Clean up excessive newlines (more than 2 consecutive)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
};

/**
 * Copies HTML content to clipboard with both rich text and formatted plain text
 * This allows pasting into rich text editors (preserving HTML) or plain text editors (with structure)
 */
export const copyHtmlToClipboard = async (html: string): Promise<void> => {
  if (!html) {
    throw new Error('No content to copy');
  }

  // Convert to formatted plain text
  const plainText = htmlToFormattedText(html);

  try {
    // Check if ClipboardItem is supported
    if (typeof ClipboardItem !== 'undefined') {
      // Use modern Clipboard API to write both HTML and text
      const clipboardItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });

      await navigator.clipboard.write([clipboardItem]);
    } else {
      // Fallback to plain text only for older browsers
      await navigator.clipboard.writeText(plainText);
    }
  } catch {
    // If the fancy clipboard API fails, fall back to plain text
    await navigator.clipboard.writeText(plainText);
  }
};

/**
 * Fallback method for copying text to clipboard
 * Used when ClipboardItem is not supported
 */
export const copyTextToClipboard = async (text: string): Promise<void> => {
  await navigator.clipboard.writeText(text);
};

/**
 * Converts an image blob to PNG via a canvas element.
 */
const convertToPngBlob = (blob: Blob): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(pngBlob => {
        if (!pngBlob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        resolve(pngBlob);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
};

/**
 * Copies an image blob to the clipboard.
 * Converts non-PNG images to PNG first, as browsers only support image/png for clipboard writes.
 */
export const copyImageToClipboard = async (blob: Blob): Promise<void> => {
  if (typeof ClipboardItem === 'undefined') {
    throw new Error('ClipboardItem is not supported in this browser');
  }
  const pngBlob = blob.type === 'image/png' ? blob : await convertToPngBlob(blob);
  const clipboardItem = new ClipboardItem({ 'image/png': pngBlob });
  await navigator.clipboard.write([clipboardItem]);
};
