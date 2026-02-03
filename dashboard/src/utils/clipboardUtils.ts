/**
 * Clipboard utilities for copying HTML content with proper formatting preservation
 */

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
