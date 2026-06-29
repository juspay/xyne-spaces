/**
 * Slack Block Kit type definitions
 * Based on https://api.slack.com/reference/block-kit/blocks
 *
 * Only includes types actively used by the Block Kit parser
 */

// ========== Basic Types ==========

export interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
  verbatim?: boolean;
}
export interface SlackFileObject {
  id?: string;
  url?: string;
}
// ========== Block Elements ==========

export interface SlackImageElement {
  type: 'image';
  image_url: string;
  alt_text: string;
}

export interface SlackButtonElement {
  type: 'button';
  text: SlackTextObject;
  url?: string;
  style?: 'primary' | 'danger';
}

export type SlackBlockElement =
  | SlackButtonElement
  | SlackImageElement
  | { type: 'overflow' }
  | { type: 'static_select' }
  | { type: 'datepicker' };

// ========== Block Types ==========

export interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  accessory?: SlackBlockElement;
}

export interface SlackImageBlock {
  type: 'image';
  image_url: string;
  alt_text: string;
  title?: SlackTextObject;
  slack_file?: SlackFileObject; // Custom extension for files uploaded via Slack API, containing xyne_file_id for retrieval
  xyne_file_id?: string; // DB CUID from filesCompleteUploadExternal response
}

export interface SlackActionsBlock {
  type: 'actions';
  elements: SlackBlockElement[];
}

export interface SlackContextBlock {
  type: 'context';
  elements: Array<SlackTextObject | SlackImageElement>;
}

export interface SlackHeaderBlock {
  type: 'header';
  text: SlackTextObject;
}

// ========== Rich Text Block Types ==========

interface SlackRichTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

export interface SlackRichTextTextElement {
  type: 'text';
  text: string;
  style?: SlackRichTextStyle;
}

export interface SlackRichTextLinkElement {
  type: 'link';
  url: string;
  text?: string;
  style?: SlackRichTextStyle;
}

export type SlackRichTextInlineElement =
  | SlackRichTextTextElement
  | SlackRichTextLinkElement
  | { type: 'emoji'; name: string }
  | { type: 'user'; user_id: string }
  | { type: 'channel'; channel_id: string }
  | { type: 'broadcast'; range: 'channel' | 'here' | 'everyone' }
  | { type: 'usergroup'; usergroup_id: string };

export interface SlackRichTextSection {
  type: 'rich_text_section';
  elements: SlackRichTextInlineElement[];
}

export interface SlackRichTextList {
  type: 'rich_text_list';
  style: 'bullet' | 'ordered';
  indent?: number;
  elements: SlackRichTextSection[];
}

export interface SlackRichTextPreformatted {
  type: 'rich_text_preformatted';
  elements: SlackRichTextInlineElement[];
}

export interface SlackRichTextQuote {
  type: 'rich_text_quote';
  elements: SlackRichTextInlineElement[];
}

export type SlackRichTextBlockElement =
  | SlackRichTextSection
  | SlackRichTextList
  | SlackRichTextPreformatted
  | SlackRichTextQuote;

export interface SlackRichTextBlock {
  type: 'rich_text';
  elements: SlackRichTextBlockElement[];
}

// ========== Table Block Types ==========

/** A plain-text table cell. */
export interface SlackRawTextCell {
  type: 'raw_text';
  text: string;
}

/** A table cell is either a rich-text block or a raw-text cell. */
export type SlackTableCell = SlackRichTextBlock | SlackRawTextCell;

/** Slack's `table` block — a grid of cells (rows of cells). */
export interface SlackTableBlock {
  type: 'table';
  block_id?: string;
  rows: SlackTableCell[][];
}

// ========== Combined Block Types ==========
export interface SlackTableColumnSetting {
  align?: 'left' | 'center' | 'right';
  is_wrapped?: boolean;
}

export interface SlackTableBlock {
  type: 'table';
  block_id?: string;
  rows: SlackTableCell[][];             // required — array of rows, each row is an array of cells
  column_settings?: Array<SlackTableColumnSetting | null>;
}

export interface SlackMarkdownBlock {
  type: 'markdown';
  block_id?: string;
  text: string;                         // standard markdown-formatted text
}

export type SlackBlock =
  | SlackSectionBlock
  | { type: 'divider' }
  | SlackImageBlock
  | SlackActionsBlock
  | SlackContextBlock
  | SlackHeaderBlock
  | SlackRichTextBlock
  | SlackTableBlock
  | SlackMarkdownBlock;

// ========== Attachment Types ==========

export interface SlackAttachment {
  color?: string;
  blocks?: SlackBlock[];
  text?: string;
  pretext?: string;
  author_name?: string;
  author_link?: string;
  title?: string;
  title_link?: string;
  fields?: Array<{
    title?: string;
    value?: string;
  }>;
  image_url?: string;
  thumb_url?: string;
  footer?: string;
  /** Permalink to the original message, present on forwarded/shared attachments. */
  from_url?: string;
}

// ========== Message Types ==========

export interface SlackBlockKitMessage {
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  text?: string;
}
