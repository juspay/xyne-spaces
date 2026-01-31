/**
 * Slack Block Kit to HTML Parser
 * Converts Slack Block Kit JSON to semantic HTML
 */

import { escapeForSlackWithMarkdown, escapeForSlack } from '@clearfeed-ai/slack-to-html';
import {
  SlackBlock,
  SlackBlockKitMessage,
  SlackAttachment,
  SlackSectionBlock,
  SlackImageBlock,
  SlackActionsBlock,
  SlackContextBlock,
  SlackHeaderBlock,
  SlackRichTextBlock,
  SlackRichTextBlockElement,
  SlackRichTextInlineElement,
  SlackRichTextList,
  SlackRichTextSection,
  SlackRichTextPreformatted,
  SlackRichTextQuote,
  SlackRichTextTextElement,
  SlackRichTextLinkElement,
  SlackTextObject,
  SlackBlockElement,
  SlackButtonElement,
} from './slackBlockKitTypes';

// Reusable CSS styles
const STYLES = {
  image: 'max-width: 100%; height: auto;',
  thumbnail: 'max-width: 4.6875rem; height: auto; border-radius: 0.1875rem;',
  divider: 'border: 0; border-top: 1px solid #e5e7eb; margin: 0.75rem 0;',
  blockMargin: 'margin-bottom: 0.75rem;',
  lineHeight: 'line-height: 1.5;',
  flexRow: 'display: flex; gap: 1rem; align-items: flex-start;',
  grid2Col: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem;',
  smallText: 'font-size: 0.875rem; color: #6b7280;',
  codeInline: 'background-color: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.1875rem; font-family: monospace;',
  codeBlock: 'background-color: #f3f4f6; padding: 0.75rem; border-radius: 0.25rem; overflow-x: auto; margin: 0.5rem 0;',
  quote: 'border-left: 0.25rem solid #d1d5db; padding-left: 1rem; margin: 0.5rem 0; color: #6b7280;',
  link: 'color: #2563eb; text-decoration: underline;',
  button: 'padding: 6px 12px; border-radius: 4px; border: 1px solid; cursor: pointer; font-size: 0.875rem; text-decoration: none; display: inline-block;',
} as const;

// Color mappings
const COLOR_MAP: Record<string, string> = {
  good: '#16a34a',
  warning: '#f97316',
  danger: '#dc2626',
  success: '#16a34a',
};

const BUTTON_COLORS = {
  primary: { bg: '#2563eb', color: 'white', border: '#2563eb' },
  danger: { bg: '#dc2626', color: 'white', border: '#dc2626' },
  default: { bg: 'white', color: '#374151', border: '#d1d5db' },
} as const;

export class SlackBlockKitParser {
  /**
   * Main entry point - parses a Slack Block Kit message to HTML
   */
  parse(message: SlackBlockKitMessage): string {
    const parts: string[] = [];

    if (message.text) {
      parts.push(this.formatText({ type: 'mrkdwn', text: message.text }));
    }

    if (message.blocks?.length) {
      parts.push(this.parseBlocks(message.blocks));
    }

    if (message.attachments?.length) {
      parts.push(this.parseAttachments(message.attachments));
    }

    return parts.join('');
  }

  /**
   * Parse attachments array
   */
  private parseAttachments(attachments: SlackAttachment[]): string {
    return attachments.map((att) => this.parseAttachment(att)).join('');
  }

  /**
   * Parse a single attachment
   */
  private parseAttachment(attachment: SlackAttachment): string {
    const color = this.getAttachmentColor(attachment.color);
    const content: string[] = [];

    // Pretext
    if (attachment.pretext) {
      content.push(this.wrapDiv('attachment-pretext', this.formatMrkdwn(attachment.pretext)));
    }

    // Author
    if (attachment.author_name) {
      const authorHtml = attachment.author_link
        ? this.createLink(attachment.author_link, escapeForSlack(attachment.author_name))
        : escapeForSlack(attachment.author_name);
      content.push(this.wrapDiv('attachment-author', authorHtml));
    }

    // Title
    if (attachment.title) {
      const titleHtml = attachment.title_link
        ? this.createLink(attachment.title_link, `<strong>${escapeForSlack(attachment.title)}</strong>`)
        : `<strong>${escapeForSlack(attachment.title)}</strong>`;
      content.push(this.wrapDiv('attachment-title', titleHtml));
    }

    // Blocks or legacy text
    if (attachment.blocks?.length) {
      content.push(this.parseBlocks(attachment.blocks));
    } else if (attachment.text) {
      content.push(this.formatMrkdwn(attachment.text));
    }

    // Fields
    if (attachment.fields?.length) {
      content.push(this.parseAttachmentFields(attachment.fields));
    }

    // Images
    if (attachment.image_url) {
      content.push(this.createImg(attachment.image_url, 'attachment image', `${STYLES.image} margin-top: 0.5rem;`));
    }
    if (attachment.thumb_url) {
      content.push(this.createImg(attachment.thumb_url, 'thumbnail', `${STYLES.thumbnail} margin-top: 0.5rem;`));
    }

    // Footer
    if (attachment.footer) {
      content.push(`<div class="attachment-footer" style="${STYLES.smallText} margin-top: 0.5rem;">${escapeForSlack(attachment.footer)}</div>`);
    }

    return `<blockquote data-slack="true" style="--border-color: ${color};">${content.join('')}</blockquote>`;
  }

  /**
   * Parse an array of blocks
   */
  private parseBlocks(blocks: SlackBlock[]): string {
    return blocks.map((block) => this.parseBlock(block)).filter(Boolean).join('');
  }

  /**
   * Parse a single block based on its type
   */
  private parseBlock(block: SlackBlock): string {
    const parsers: Record<string, () => string> = {
      section: () => this.parseSectionBlock(block as SlackSectionBlock),
      divider: () => `<hr style="${STYLES.divider}" />`,
      image: () => this.parseImageBlock(block as SlackImageBlock),
      actions: () => this.parseActionsBlock(block as SlackActionsBlock),
      context: () => this.parseContextBlock(block as SlackContextBlock),
      header: () => this.parseHeaderBlock(block as SlackHeaderBlock),
      rich_text: () => this.parseRichTextBlock(block as SlackRichTextBlock),
    };

    return parsers[block.type]?.() || '';
  }

  /**
   * Parse section block (text + optional accessory)
   */
  private parseSectionBlock(block: SlackSectionBlock): string {
    const parts: string[] = [];

    if (block.text) {
      parts.push(`<div class="section-text" style="${STYLES.lineHeight}">${this.formatText(block.text)}</div>`);
    }

    if (block.fields?.length) {
      const fieldsHtml = block.fields
        .map((field) => `<div class="section-field" style="${STYLES.lineHeight}">${this.formatText(field)}</div>`)
        .join('');
      parts.push(`<div class="section-fields" style="${STYLES.grid2Col} margin-top: 0.5rem;">${fieldsHtml}</div>`);
    }

    const textContent = parts.join('');

    if (block.accessory) {
      return `<div class="section-block" style="${STYLES.flexRow} margin-bottom: 0.5rem;">
        <div style="flex: 1; min-width: 0;">${textContent}</div>
        <div class="section-accessory" style="flex-shrink: 0;">${this.parseElement(block.accessory)}</div>
      </div>`;
    }

    return `<div class="section-block" style="margin-bottom: 0.5rem; ${STYLES.lineHeight}">${textContent}</div>`;
  }

  /**
   * Parse image block
   */
  private parseImageBlock(block: SlackImageBlock): string {
    const titleHtml = block.title
      ? `<div style="font-weight: 600; margin-bottom: 0.5rem;">${this.formatText(block.title)}</div>`
      : '';
    return `<div class="image-block" style="${STYLES.blockMargin}">
      ${titleHtml}
      ${this.createImg(block.image_url, block.alt_text, STYLES.image)}
    </div>`;
  }

  /**
   * Parse actions block (buttons, selects, etc.)
   */
  private parseActionsBlock(block: SlackActionsBlock): string {
    const elementsHtml = block.elements.map((el) => this.parseElement(el)).join('');
    return `<div class="actions-block" style="display: flex; gap: 0.5rem; flex-wrap: wrap; ${STYLES.blockMargin}">${elementsHtml}</div>`;
  }

  /**
   * Parse context block (small text/images)
   */
  private parseContextBlock(block: SlackContextBlock): string {
    const elementsHtml = block.elements
      .map((el) => {
        if ('image_url' in el) {
          return this.createImg(el.image_url, el.alt_text, 'width: 1rem; height: 1rem; border-radius: 0.1875rem;');
        }
        return `<span>${this.formatText(el)}</span>`;
      })
      .join('');

    return `<div class="context-block" style="display: flex; gap: 0.5rem; align-items: center; ${STYLES.smallText} ${STYLES.blockMargin}">${elementsHtml}</div>`;
  }

  /**
   * Parse header block
   */
  private parseHeaderBlock(block: SlackHeaderBlock): string {
    return `<div class="header-block" style="${STYLES.blockMargin}">
      <h2 style="font-size: 1.25rem; font-weight: 700; margin: 0;">${this.formatText(block.text)}</h2>
    </div>`;
  }

  /**
   * Parse interactive elements (buttons, images, etc.)
   */
  private parseElement(element: SlackBlockElement): string {
    switch (element.type) {
      case 'button':
        return this.parseButton(element);
      case 'image':
        return this.createImg(element.image_url, element.alt_text, STYLES.thumbnail);
      case 'overflow':
        return '<span style="color: #9ca3af;">•••</span>';
      case 'static_select':
      case 'datepicker':
        return `<span style="color: #9ca3af;">[${element.type}]</span>`;
      default:
        return '';
    }
  }

  /**
   * Parse button element
   */
  private parseButton(button: SlackButtonElement): string {
    const text = this.formatText(button.text);
    const style = this.getButtonStyle(button.style);
    const tag = button.url ? 'a' : 'button';
    const attrs = button.url ? `href="${button.url}" target="_blank" rel="noopener noreferrer"` : 'disabled';

    return `<${tag} ${attrs} style="${style}">${text}</${tag}>`;
  }

  /**
   * Parse attachment fields (legacy format)
   */
  private parseAttachmentFields(fields: Array<{ title: string; value: string; short?: boolean }>): string {
    return fields
      .map((field) => `<div><strong>${escapeForSlack(field.title)}</strong></div><div>${this.formatMrkdwn(field.value)}</div>`)
      .join('');
  }

  /**
   * Parse rich_text block
   */
  private parseRichTextBlock(block: SlackRichTextBlock): string {
    const content = block.elements.map((el) => this.parseRichTextBlockElement(el)).join('');
    return `<div class="rich-text-block" style="${STYLES.blockMargin}">${content}</div>`;
  }

  /**
   * Parse rich text block element (section, list, preformatted, quote)
   */
  private parseRichTextBlockElement(element: SlackRichTextBlockElement): string {
    switch (element.type) {
      case 'rich_text_section':
        return this.parseRichTextSection(element);
      case 'rich_text_list':
        return this.parseRichTextList(element);
      case 'rich_text_preformatted':
        return this.parseRichTextPreformatted(element);
      case 'rich_text_quote':
        return this.parseRichTextQuote(element);
      default:
        return '';
    }
  }

  /**
   * Parse rich text section (regular text with inline formatting)
   */
  private parseRichTextSection(section: SlackRichTextSection): string {
    const content = section.elements.map((el) => this.parseRichTextInlineElement(el)).join('');
    return `<div style="margin: 0;">${content.replace(/\n/g, '<br/>')}</div>`;
  }

  /**
   * Parse rich text list (bullet or ordered)
   */
  private parseRichTextList(list: SlackRichTextList): string {
    const listItems = list.elements
      .map((item) => {
        const content = item.elements.map((el) => this.parseRichTextInlineElement(el)).join('');
        return `<li>${content}</li>`;
      })
      .join('');

    const tag = list.style === 'ordered' ? 'ol' : 'ul';
    const indent = list.indent ? `margin-left: ${list.indent * 1.5}rem;` : '';
    return `<${tag} style="margin: 0.5rem 0; padding-left: 1.5rem; ${indent}">${listItems}</${tag}>`;
  }

  /**
   * Parse rich text preformatted (code block)
   */
  private parseRichTextPreformatted(preformatted: SlackRichTextPreformatted): string {
    const content = preformatted.elements.map((el) => this.parseRichTextInlineElement(el, true)).join('');
    return `<pre style="${STYLES.codeBlock}"><code>${content}</code></pre>`;
  }

  /**
   * Parse rich text quote
   */
  private parseRichTextQuote(quote: SlackRichTextQuote): string {
    const content = quote.elements.map((el) => this.parseRichTextInlineElement(el)).join('');
    return `<blockquote style="${STYLES.quote}">${content}</blockquote>`;
  }

  /**
   * Parse inline rich text elements (text, link, emoji, etc.)
   */
  private parseRichTextInlineElement(element: SlackRichTextInlineElement, isPreformatted = false): string {
    switch (element.type) {
      case 'text':
        return this.parseRichTextText(element, isPreformatted);
      case 'link':
        return this.parseRichTextLink(element);
      case 'emoji':
        return escapeForSlackWithMarkdown(`:${element.name}:`);
      case 'user':
        return `<span style="color: #2563eb;">@${element.user_id}</span>`;
      case 'channel':
        return `<span style="color: #2563eb;">#${element.channel_id}</span>`;
      default:
        return '';
    }
  }

  /**
   * Parse rich text text element with styling
   */
  private parseRichTextText(element: SlackRichTextTextElement, isPreformatted = false): string {
    let text = isPreformatted ? element.text : escapeForSlack(element.text);

    if (!element.style) {
      return text.replace(/\n/g, '<br/>');
    }

    const { code, bold, italic, strike } = element.style;

    if (code) text = `<code style="${STYLES.codeInline}">${text}</code>`;
    if (bold) text = `<strong>${text}</strong>`;
    if (italic) text = `<em>${text}</em>`;
    if (strike) text = `<del>${text}</del>`;

    return text;
  }

  /**
   * Parse rich text link element
   */
  private parseRichTextLink(element: SlackRichTextLinkElement): string {
    const displayText = element.text || element.url;
    let text = escapeForSlack(displayText);

    if (element.style) {
      if (element.style.bold) text = `<strong>${text}</strong>`;
      if (element.style.italic) text = `<em>${text}</em>`;
      if (element.style.strike) text = `<del>${text}</del>`;
    }

    return this.createLink(element.url, text, STYLES.link);
  }

  // ========== Helper Methods ==========

  /**
   * Format Slack text object
   */
  private formatText(text: SlackTextObject): string {
    return text.type === 'plain_text' ? escapeForSlack(text.text) : escapeForSlackWithMarkdown(text.text);
  }

  /**
   * Format markdown text
   */
  private formatMrkdwn(text: string): string {
    return escapeForSlackWithMarkdown(text);
  }

  /**
   * Get button styling based on style property
   */
  private getButtonStyle(style?: 'primary' | 'danger'): string {
    const colors = style && BUTTON_COLORS[style] ? BUTTON_COLORS[style] : BUTTON_COLORS.default;
    return `${STYLES.button} background-color: ${colors.bg}; color: ${colors.color}; border-color: ${colors.border};`;
  }

  /**
   * Get attachment color
   */
  private getAttachmentColor(color?: string): string {
    return getAttachmentColor(color);
  }

  /**
   * Escape HTML special characters for use in HTML attributes
   * Note: For user-facing text content, use escapeForSlack() from clearfeed library instead
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }

  /**
   * Create a link element
   */
  private createLink(href: string, content: string, style?: string): string {
    const styleAttr = style ? ` style="${style}"` : '';
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"${styleAttr}>${content}</a>`;
  }

  /**
   * Create an image element
   */
  private createImg(src: string, alt: string, style: string): string {
    return `<img src="${src}" alt="${this.escapeHtml(alt)}" style="${style}" />`;
  }

  /**
   * Wrap content in a div with class
   */
  private wrapDiv(className: string, content: string): string {
    return `<div class="${className}">${content}</div>`;
  }
}

/**
 * Get attachment color - exported for use in transformer
 */
export function getAttachmentColor(color?: string): string {
  if (!color) return '#9ca3af';
  if (color.startsWith('#') || /^[0-9A-Fa-f]{6}$/.test(color)) {
    return color.startsWith('#') ? color : `#${color}`;
  }
  return COLOR_MAP[color.toLowerCase()] || '#9ca3af';
}
