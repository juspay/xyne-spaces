import { logger } from '@/utils/logger';
/**
 * Slack BlockKit → FlowDefinition (v2) converter
 *
 * Converts both modern Slack Block Kit payloads and legacy attachment-style
 * messages into a FlowDefinition that can be rendered by the Xyne Flow UI.
 *
 * Supports:
 *  - Modern block types: header, section (text / fields / accessory),
 *    divider, image, actions (buttons), context, rich_text
 *  - Legacy attachments: pretext, author, title/link, text, fields,
 *    image_url, thumb_url, footer, nested modern blocks
 *  - `text` may also be a serialised Slack message JSON containing `blocks`
 *
 * Returns null when there is nothing structured to convert (plain-text only),
 * so callers can fall back to HTML via the BlockKit HTML parser.
 *
 * Usage:
 *   import { convertBlockKitToFlowJSON } from '.../slackBlockKitToFlowJSON';
 *   const flowDef = await convertBlockKitToFlowJSON({ text, blocks, attachments }, botOauthToken);
 */

import type { FlowDefinition, FlowComponent } from '@xyne/shared';
import { resolveSlackIds } from './slackUserResolver';
import { parseMrkdwnBlocks } from './slackUtils';
import type {
  SlackAttachment,
  SlackBlock,
  SlackSectionBlock,
  SlackImageBlock,
  SlackActionsBlock,
  SlackContextBlock,
  SlackRichTextBlock,
  SlackRichTextBlockElement,
  SlackRichTextInlineElement,
  SlackBlockElement,
  SlackButtonElement,
  SlackImageElement,
  SlackTextObject,
  SlackTableBlock,
  SlackMarkdownBlock,
} from './slackBlockKitTypes';

// ============================================================================
// Public entry point
// ============================================================================

export interface BlockKitInput {
  /** Plain mrkdwn text, or a serialised Slack message JSON ({ blocks?, text?, attachments? }) */
  text?: string;
  /** Modern Slack blocks — takes precedence over text-embedded blocks */
  blocks?: SlackBlock[];
  /** Legacy Slack attachments */
  attachments?: SlackAttachment[];
}

/**
 * Collect every Slack user ID (<@USERID> in mrkdwn strings, or user_id fields
 * inside rich_text elements) that appear anywhere in a BlockKit payload so
 * they can be bulk-resolved to Xyne IDs before conversion begins.
 */
function collectAllSlackUserIds(input: BlockKitInput): string[] {
  const ids = new Set<string>();
  const mrkdwnRegex = /<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g;

  const fromText = (text: string) => {
    for (const m of text.matchAll(mrkdwnRegex)) ids.add(m[1]);
  };

  const fromBlocks = (blocks: SlackBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'rich_text') {
        for (const section of (block as SlackRichTextBlock).elements) {
          if ('elements' in section) {
            for (const el of (section as SlackRichTextBlockElement).elements) {
              if ((el as SlackRichTextInlineElement).type === 'user') {
                ids.add((el as Extract<SlackRichTextInlineElement, { type: 'user' }>).user_id);
              }
            }
          }
        }
      } else if (block.type === 'section') {
        const s = block as SlackSectionBlock;
        if (s.text) fromText(s.text.text);
        if (s.fields) s.fields.forEach(f => fromText(f.text));
      } else if (block.type === 'context') {
        (block as SlackContextBlock).elements.forEach(el => {
          if ('text' in el) fromText((el as SlackTextObject).text);
        });
      } else if (block.type === 'header') {
        fromText(block.text.text);
      }
    }
  };

  if (input.text) fromText(input.text);
  if (input.blocks) fromBlocks(input.blocks);
  if (input.attachments) {
    for (const att of input.attachments) {
      if (att.pretext) fromText(att.pretext);
      if (att.text) fromText(att.text);
      if (att.fields) att.fields.forEach(f => f.value != null && fromText(f.value));
      if (att.blocks) fromBlocks(att.blocks);
    }
  }

  return [...ids];
}

function collectAllSlackGroupIds(input: BlockKitInput): string[] {
  const ids = new Set<string>();
  const groupRegex = /<!subteam\^([A-Za-z0-9]+)(?:\|[^>]*)?>/g;

  const fromText = (text: string) => {
    for (const m of text.matchAll(groupRegex)) ids.add(m[1]);
  };

  const fromBlocks = (blocks: SlackBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'section') {
        const s = block as SlackSectionBlock;
        if (s.text) fromText(s.text.text);
        if (s.fields) s.fields.forEach(f => fromText(f.text));
      } else if (block.type === 'context') {
        (block as SlackContextBlock).elements.forEach(el => {
          if ('text' in el) fromText((el as SlackTextObject).text);
        });
      } else if (block.type === 'markdown') {
        const mdBlock = block as { type: 'markdown'; text?: string };
        if (mdBlock.text) fromText(mdBlock.text);
      }
    }
  };

  if (input.text) fromText(input.text);
  if (input.blocks) fromBlocks(input.blocks);
  if (input.attachments) {
    for (const att of input.attachments) {
      if (att.pretext) fromText(att.pretext);
      if (att.text) fromText(att.text);
      if (att.fields) att.fields.forEach(f => f.value != null && fromText(f.value));
      if (att.blocks) fromBlocks(att.blocks);
    }
  }

  return [...ids];
}

/**
 * Convert a BlockKit message to a FlowDefinition (v2).
 *
 * @param input       BlockKit payload (text / blocks / attachments)
 * @param botToken    Bot token for Slack API calls to resolve user mentions
 *                    that are not yet stored in the Xyne DB by slackId metadata.
 * @param workspaceId Xyne workspace ID used when looking up users by email.
 * @returns           FlowDefinition when structured content is found, null otherwise
 */
export async function convertBlockKitToFlowJSON(
  input: BlockKitInput,
  botToken?: string,
  workspaceId?: string,
): Promise<FlowDefinition | null> {
  if (!botToken) {
    logger.warn('No bot token provided, skipping Slack user ID resolution. User mentions may not render correctly.');
  }
  const rawText = input.text;
  let resolvedAttachments = input.attachments ? [...input.attachments] : undefined;

  // If caller already provided an explicit blocks array, prefer it.
  // Otherwise, check whether `text` is a serialised Slack message JSON.
  let blocks: SlackBlock[] | undefined = input.blocks?.length ? input.blocks : undefined;
  let plainText: string | undefined;

  if (!blocks && rawText) {
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (Array.isArray(parsed['blocks'])) {
          blocks = parsed['blocks'] as SlackBlock[];
          plainText = typeof parsed['text'] === 'string' ? parsed['text'] : undefined;
          // Merge attachments embedded in the JSON payload
          if (Array.isArray(parsed['attachments'])) {
            resolvedAttachments = [
              ...(resolvedAttachments ?? []),
              ...(parsed['attachments'] as SlackAttachment[]),
            ];
          }
        } else {
          plainText = rawText;
        }
      } else {
        plainText = rawText;
      }
    } catch {
      // Not JSON — treat as plain mrkdwn text
      plainText = rawText;
    }
  } else if (!blocks) {
    plainText = rawText;
  }

  // Nothing structured to convert → signal the caller to fall back to HTML
  if (!blocks?.length && !resolvedAttachments?.length) {
    return null;
  }

  // Pre-resolve all Slack user IDs (<@USERID> in mrkdwn / user_id in rich_text)
  // to their corresponding Xyne DB IDs so mentions render correctly.
  // Strategy:
  //   1. Look up users whose metadata.slackId matches (fast DB query — populated during migration).
  //   2. For any remaining IDs, call the Slack API, get their email, then find the
  //      matching Xyne user by email.
  // If botToken is not provided we skip resolution and fall back to passing the
  // raw Slack ID; the dashboard MentionRenderer will show an unresolved mention.
  let slackToXyneMap: Map<string, string> | undefined;
  let slackToXyneGroupMap: Map<string, string> | undefined;
  if (botToken) {
    const blockKitInput = { text: plainText ?? rawText, blocks, attachments: resolvedAttachments };
    const slackUserIds = collectAllSlackUserIds(blockKitInput);
    if (slackUserIds.length > 0) {
      const resolved = await resolveSlackIds(slackUserIds, botToken, 'user', workspaceId);
      if (resolved) {
        slackToXyneMap = new Map<string, string>();
        for (const [slackId, entry] of resolved) {
          if (entry.dbId) slackToXyneMap.set(slackId, entry.dbId);
        }
      }
    }
    const slackGroupIds = collectAllSlackGroupIds(blockKitInput);
    if (slackGroupIds.length > 0) {
      const resolvedGroups = await resolveSlackIds(slackGroupIds, botToken, 'group', workspaceId);
      if (resolvedGroups) {
        slackToXyneGroupMap = new Map<string, string>();
        for (const [slackId, entry] of resolvedGroups) {
          if (entry.dbId) slackToXyneGroupMap.set(slackId, entry.dbId);
        }
      }
    }
  }

  const components: FlowComponent[] = [];

  // Prepend plain text — render whenever present, whether it accompanies
  // modern blocks, legacy attachments, or both.
  if (plainText) {
    components.push(mrkdwnToFlowComponent(plainText, slackToXyneMap, slackToXyneGroupMap));
  }

  // Convert modern blocks
  for (const block of blocks ?? []) {
    const component = slackBlockToFlowComponent(block, slackToXyneMap, slackToXyneGroupMap);
    if (component) components.push(component);
  }

  // Convert legacy attachments → bordered stripe components
  for (const attachment of resolvedAttachments ?? []) {
    const card = slackAttachmentToFlowComponent(attachment, slackToXyneMap, slackToXyneGroupMap);
    if (card) components.push(card);
  }

  if (!components.length) return null;

  // Top-level blocks render directly — no card, no border (matches Slack behaviour).
  // Attachments already wrap themselves in a bordered stripe inside
  // slackAttachmentToFlowComponent, so no additional wrapping is needed here.
  const finalComponents: FlowComponent[] = components;

  return {
    version: '2.0',
    screenId: crypto.randomUUID(),
    components: finalComponents,
    state: {
      values: {},
      touched: {},
      errors: {},
      submitting: false,
      submitted: false,
      history: [],
      loadingComponentIds: [],
    },
  };
}

// ============================================================================
// mrkdwn → FlowComponent helper
// ============================================================================

/**
 * Normalise Slack's native mention tokens to Xyne's TextNode format so that
 * MentionRenderer / ChannelMentionRenderer in the dashboard can resolve them:
 *
 *   <@USERID>          → <userid:USERID>
 *   <@USERID|name>     → <userid:USERID>  (display name discarded — renderer looks it up)
 *   <#CHANID|name>     → <channelid:CHANID>
 *   <!here>, <!channel>→ @here / @channel  (kept as plain text)
 *
 * Other mrkdwn markers (*bold*, _italic_, `code`, <url|label>) are kept as-is;
 * the TextNode inline parser handles them at render time on the frontend.
 */
function normalizeSlackMentions(text: string, slackToXyneMap?: Map<string, string>, slackToXyneGroupMap?: Map<string, string>): string {
  return text
    .replace(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, slackId) => {
      const xyneId = slackToXyneMap?.get(slackId);
      return `<userid:${xyneId ?? slackId}>`;
    })
    .replace(/<!subteam\^([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, slackGroupId) => {
      const xyneGroupId = slackToXyneGroupMap?.get(slackGroupId);
      return `<groupid:${xyneGroupId ?? slackGroupId}>`;
    })
    .replace(/<#([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `<channelid:${id}>`)
    .replace(/<!([a-z]+)(?:\|[^>]*)?>/g,        (_, name) => `<broadcast:${name}>`);
}

/**
 * Convert a Slack text object (or raw mrkdwn string) to a single `text`
 * FlowComponent.  The content is stored as-is (with Slack mentions normalised)
 * so that the frontend TextNode inline parser renders bold, italic, code, links,
 * and mentions correctly without splitting the text into multiple components.
 */
export function mrkdwnToFlowComponent(
  textObj: SlackTextObject | string,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
  checkTables = false,
): FlowComponent {
  const raw      = typeof textObj === 'string' ? textObj : textObj.text;
  const isMrkdwn = typeof textObj === 'string' || textObj.type === 'mrkdwn';
  const content  = isMrkdwn ? normalizeSlackMentions(raw, slackToXyneMap, slackToXyneGroupMap) : raw;
  if (isMrkdwn) {
    const structuredComponent = mrkdwnWithBlocksToFlowComponent(content, checkTables);
    if (structuredComponent) return structuredComponent;
  }
  return { id: crypto.randomUUID(), type: 'text', props: { content } };
}

function parseMarkdownTable(content: string): FlowComponent | null {
  const lines = content.trim().split('\n').map(l => l.trim()).filter(Boolean);
  // Need at least: header row + separator row + one data row
  if (lines.length < 3) return null;
  // Separator row must consist only of |, -, :, and spaces
  if (!/^\|?[\s|:\-]+\|?$/.test(lines[1])) return null;

  const parseRow = (line: string): string[] =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

  const sepCells = parseRow(lines[1]);
  const columnAlignments = sepCells.map((cell): 'left' | 'center' | 'right' => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
    if (cell.endsWith(':')) return 'right';
    return 'left';
  });

  const rows = [parseRow(lines[0]), ...lines.slice(2).map(parseRow)];
  return {
    id: crypto.randomUUID(),
    type: 'table',
    props: { rows, hasHeader: true, columnAlignments },
  };
}

function mrkdwnWithBlocksToFlowComponent(content: string, checkTables = false): FlowComponent | null {
  const trimmed = content.trim();

  const gtRun = /^>+/.exec(trimmed);
  if (gtRun) {
    const runLen = gtRun[0].length;
    const consumed = runLen >= 3 ? 3 : 1; // Slack matches `>>>` or `>`
    const rest = trimmed.slice(consumed);
    const leftover = (/^[>\t ]*/.exec(rest) as RegExpExecArray)[0];
    const body = rest.slice(leftover.length);

    if (runLen >= 3 || /^```/.test(body)) {
      const children: FlowComponent[] = [];
      const leftoverText = leftover.trim();
      if (leftoverText) {
        children.push({ id: crypto.randomUUID(), type: 'text', props: { content: '​' + leftoverText } });
      }
      const inner = body.trim() ? mrkdwnWithBlocksToFlowComponent(body, checkTables) : null;
      if (inner) {
        children.push(inner);
      } else if (body.trim()) {
        children.push({ id: crypto.randomUUID(), type: 'text', props: { content: body } });
      }
      if (children.length) return withChatQuoteStyle(children);
    }
  }

  const lines = trimmed.split('\n');

  // GFM table detection — only enabled for block types that emit raw markdown
  // (e.g. `markdown` blocks). `section`+`mrkdwn` blocks must NOT trigger this
  // so that pipe-table content wrapped in ``` fences renders as a code block.
  if (checkTables) {
    const tableLineIndex = lines.findIndex(l => /^\|.+\|/.test(l.trim()));
    if (tableLineIndex !== -1) {
      const tableContent = lines.slice(tableLineIndex).join('\n').trim();
      const table = parseMarkdownTable(tableContent);
      if (table) {
        const preText = lines.slice(0, tableLineIndex).join('\n').trim();
        if (!preText) return table;
        return {
          id: crypto.randomUUID(),
          type: 'column',
          children: [
            { id: crypto.randomUUID(), type: 'text', props: { content: preText } },
            table,
          ],
        };
      }
    }
  }

  if (!/(^|\n)(```|>\s?.+|\s*[-*•]\s+.+|\s*\d+\.\s+.+)/m.test(content)) return null;

  const textComponent = (text: string): FlowComponent => ({
    id: crypto.randomUUID(),
    type: 'text',
    props: { content: text },
  });

  const components = parseMrkdwnBlocks<FlowComponent>(content, {
    onRegular: (lines) => textComponent(lines.join('\n')),
    onQuote: (lines) => withChatQuoteStyle([textComponent(lines.join('\n'))]),
    onList: (type, items) => {
      const text = items
        .map((item) => `${type === 'ul' ? '•' : `${item.num}.`} ${item.text}`)
        .join('\n');
      return textComponent(text);
    },
    onCode: (lines) => ({
      id: crypto.randomUUID(),
      type: 'text',
      props: { content: lines.join('\n'), variant: 'muted', codeBlock: true },
    }),
  }).filter((c) => {
    // Defensive: drop empty code blocks so a stray trailing ``` never renders an
    // empty gray box.
    const p = c.props as { codeBlock?: boolean; content?: string } | undefined;
    return !(p?.codeBlock && !p.content?.trim());
  });

  if (!components.length) return null;
  if (components.length === 1) return components[0];
  return { id: crypto.randomUUID(), type: 'column', children: components };
}

// ============================================================================
// Attachment color helpers
// ============================================================================

const NAMED_COLORS: Record<string, string> = {
  good:    '#36a64f',
  warning: '#ECB22E',
  danger:  '#dc2626',
  success: '#36a64f',
};

// #RGB, #RGBA, #RRGGBB, or #RRGGBBAA — leading '#' optional (Slack allows both)
const HEX_COLOR_REGEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Resolve a Slack attachment color (named string or hex) to a CSS hex value.
 * Falls back to a neutral grey for anything invalid — absent, empty, not a
 * string (e.g. `{}`), an unknown name ('meow'), or a malformed hex code —
 * since payloads are unvalidated and a bad value must not throw or emit
 * broken CSS that the browser would silently drop.
 */
function resolveAttachmentColor(color?: unknown): string {
  const FALLBACK = '#d1d5db'; // neutral grey
  if (typeof color !== 'string') return FALLBACK;
  const trimmed = color.trim();
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) return named;
  if (HEX_COLOR_REGEX.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return FALLBACK;
}

/**
 * Wrap content children inside a column that carries a Slack-style left
 * colour stripe via CSS `borderLeft`.
 */
function withColorStripe(children: FlowComponent[], color: string): FlowComponent {
  return {
    id: crypto.randomUUID(),
    type: 'column',
    style: { borderLeft: `4px solid ${color}`, padding: '2px 0 2px 10px' },
    children,
  };
}

/**
 * Lay out Slack section/attachment `fields` the way Slack does: a 2-column
 * grid that wraps onto new rows. Each cell is wrapped in a flex column so the
 * two columns share the width evenly and long values wrap instead of
 * overflowing the message width.
 */
function fieldsToGrid(fields: FlowComponent[], columns = 2): FlowComponent {
  const rows: FlowComponent[] = [];
  for (let i = 0; i < fields.length; i += columns) {
    const cells = fields.slice(i, i + columns).map((cell) => ({
      id: crypto.randomUUID(),
      type: 'column' as const,
      children: [cell],
    }));
    rows.push({ id: crypto.randomUUID(), type: 'row', children: cells });
  }
  if (rows.length === 1) return rows[0];
  return { id: crypto.randomUUID(), type: 'column', children: rows };
}

function withChatQuoteStyle(children: FlowComponent[]): FlowComponent {
  return {
    id: crypto.randomUUID(),
    type: 'column',
    style: {
      borderLeft: '4px solid hsl(var(--muted-foreground))',
      padding: '0 0 0 1rem',
    },
    children,
  };
}

function applyContextTextStyle(component: FlowComponent): FlowComponent {
  if (component.type === 'text') {
    return {
      ...component,
      props: { ...(component.props ?? {}), variant: 'muted', size: 'sm' },
    };
  }
  if (component.children?.length) {
    return { ...component, children: component.children.map(applyContextTextStyle) };
  }
  return component;
}

// ============================================================================
// Block converters
// ============================================================================

/** Convert a single modern Slack block to a FlowComponent (returns null for unknown types). */
export function slackBlockToFlowComponent(
  block: SlackBlock,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
): FlowComponent | null {
  switch (block.type) {
    case 'header':
      return {
        id: crypto.randomUUID(),
        type: 'heading',
        props: { content: block.text.text, level: 2 },
      };

    case 'divider':
      return { id: crypto.randomUUID(), type: 'divider' };

    case 'table': {
      const tableBlock = block as SlackTableBlock;
      if (!tableBlock.rows?.length) return null;

      const rows: string[][] = tableBlock.rows.map(row =>
        row.map(cell => {
          if (cell.type === 'raw_text') return cell.text ?? '';
          if (cell.type === 'rich_text' && Array.isArray(cell.elements)) {
            return (cell.elements as Array<{ type?: string; elements?: Array<{ type?: string; text?: string; url?: string; name?: string }> }>)
              .flatMap(section => section.elements ?? [])
              .map(el => {
                // Emit mrkdwn tokens so TableNode's inline parser renders them correctly
                if (el.type === 'link' && el.url) return `<${el.url}|${el.text ?? el.url}>`;
                if (el.type === 'emoji' && el.name) return `:${el.name}:`;
                return el.text ?? '';
              })
              .join('');
          }
          return '';
        }),
      );

      const columnAlignments = tableBlock.column_settings
        ?.map(s => (s?.align ?? 'left') as 'left' | 'center' | 'right');

      return {
        id: crypto.randomUUID(),
        type: 'table',
        props: { rows, hasHeader: false, columnAlignments },
      };
    }

    case 'image': {
      const imgBlock = block as SlackImageBlock;
      const xyneFileId = imgBlock.slack_file?.id ?? imgBlock.xyne_file_id;
      const src = xyneFileId
        ? `/api/attachments/${xyneFileId}/download`
        : imgBlock.image_url;
      const imageComponent: FlowComponent = {
        id: crypto.randomUUID(),
        type: 'image',
        props: { src, alt: imgBlock.alt_text, ...(xyneFileId && { xyne_file_id: xyneFileId }) },
      };
      if (imgBlock.title) {
        return {
          id: crypto.randomUUID(),
          type: 'column',
          children: [
            mrkdwnToFlowComponent(imgBlock.title, slackToXyneMap),
            imageComponent,
          ],
        };
      }
      return imageComponent;
    }

    case 'section': {
      const sectionBlock = block as SlackSectionBlock;
      const sectionChildren: FlowComponent[] = [];

      if (sectionBlock.text) {
        sectionChildren.push(mrkdwnToFlowComponent(sectionBlock.text, slackToXyneMap, slackToXyneGroupMap));
      }

      if (sectionBlock.fields?.length) {
        const fieldComponents: FlowComponent[] = sectionBlock.fields.map(
          (field): FlowComponent => mrkdwnToFlowComponent(field, slackToXyneMap, slackToXyneGroupMap),
        );
        // Slack lays section `fields` out in a 2-column grid that wraps onto
        // additional rows — not a single full-width row. Chunk into rows of 2.
        sectionChildren.push(fieldsToGrid(fieldComponents));
      }

      const accessoryComponent = sectionBlock.accessory
        ? slackBlockElementToFlowComponent(sectionBlock.accessory)
        : null;

      if (accessoryComponent && sectionChildren.length) {
        return {
          id: crypto.randomUUID(),
          type: 'row',
          children: [
            { id: crypto.randomUUID(), type: 'column', children: sectionChildren },
            accessoryComponent,
          ],
        };
      }
      if (accessoryComponent) sectionChildren.push(accessoryComponent);

      if (sectionChildren.length === 1) return sectionChildren[0];
      if (sectionChildren.length > 1) {
        return { id: crypto.randomUUID(), type: 'column', children: sectionChildren };
      }
      return null;
    }

    case 'actions': {
      const actionsBlock = block as SlackActionsBlock;
      const actionComponents = actionsBlock.elements
        .map((el) => slackBlockElementToFlowComponent(el))
        .filter((c): c is FlowComponent => c !== null);
      if (!actionComponents.length) return null;
      return { id: crypto.randomUUID(), type: 'row', children: actionComponents };
    }

    case 'context': {
      const contextBlock = block as SlackContextBlock;
      const textSegments = contextBlock.elements
        .filter((el): el is SlackTextObject => !('image_url' in el));
      if (!textSegments.length) return null;
      // Render each context text element parsed through mrkdwn, then collect into a row.
      // Slack shows context blocks as small, muted (gray) secondary text — mirror that
      // so metadata recedes and the primary section content stays prominent.
      const parsed = textSegments.map((el) =>
        applyContextTextStyle(mrkdwnToFlowComponent(el, slackToXyneMap, slackToXyneGroupMap)),
      );
      return {
        id: crypto.randomUUID(),
        type: 'row',
        style: { gap: '4px' },
        children: parsed,
      };
    }

    case 'rich_text': {
      const richTextBlock = block as SlackRichTextBlock;
      const children = richTextBlockToComponents(richTextBlock, slackToXyneMap, slackToXyneGroupMap);
      if (!children.length) return null;
      if (children.length === 1) return children[0];
      return { id: crypto.randomUUID(), type: 'column', children };
    }

    case 'markdown': {
      // Non-standard but used by some Slack apps — treat `text` as raw GFM markdown.
      // checkTables=true enables GFM pipe-table detection for this block type.
      // `section`+`mrkdwn` blocks deliberately pass checkTables=false so that
      // pipe-table content inside ``` fences renders as a code block, not a table.
      const mdBlock = block as SlackMarkdownBlock;
      if (!mdBlock.text) return null;
      return mrkdwnToFlowComponent(mdBlock.text, slackToXyneMap, slackToXyneGroupMap, true);
    }

    default:
      return null;
  }
}

/** Convert a Slack block element (button, image) to a FlowComponent. */
export function slackBlockElementToFlowComponent(element: SlackBlockElement): FlowComponent | null {
  switch (element.type) {
    case 'button': {
      const btn = element as SlackButtonElement;
      const variant =
        btn.style === 'primary' ? 'primary'
        : btn.style === 'danger' ? 'destructive'
        : 'secondary';
      return {
        id: crypto.randomUUID(),
        type: 'button',
        props: { label: btn.text.text, variant },
      };
    }
    case 'image': {
      const img = element as SlackImageElement;
      return {
        id: crypto.randomUUID(),
        type: 'image',
        props: { src: img.image_url, alt: img.alt_text },
      };
    }
    default:
      return null;
  }
}

/** Convert a legacy Slack attachment to a card FlowComponent with a left colour stripe. */
export function slackAttachmentToFlowComponent(
  attachment: SlackAttachment,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
): FlowComponent | null {
  const children: FlowComponent[] = [];

  if (attachment.pretext) {
    children.push(mrkdwnToFlowComponent(attachment.pretext, slackToXyneMap, slackToXyneGroupMap));
  }

  if (attachment.author_name) {
    children.push({
      id: crypto.randomUUID(),
      type: 'text',
      props: { content: attachment.author_name, variant: 'muted', size: 'sm' },
    });
  }

  if (attachment.title) {
    if (attachment.title_link) {
      children.push({
        id: crypto.randomUUID(),
        type: 'link',
        props: { href: attachment.title_link, label: attachment.title, external: true },
      });
    } else {
      children.push({
        id: crypto.randomUUID(),
        type: 'heading',
        props: { content: attachment.title, level: 3 },
      });
    }
  }

  // Modern blocks inside the attachment take priority over legacy text
  if (attachment.blocks?.length) {
    for (const block of attachment.blocks) {
      const component = slackBlockToFlowComponent(block, slackToXyneMap, slackToXyneGroupMap);
      if (component) children.push(component);
    }
  } else if (attachment.text) {
    children.push(mrkdwnToFlowComponent(attachment.text, slackToXyneMap, slackToXyneGroupMap));
  }

  // Key-value fields — each field value is parsed through mrkdwn.
  // Slack renders these in a 2-column grid that wraps; mirror that layout.
  if (attachment.fields?.length) {
    const fieldColumns: FlowComponent[] = attachment.fields.map(
      (field): FlowComponent => ({
        id: crypto.randomUUID(),
        type: 'column',
        children: [
          { id: crypto.randomUUID(), type: 'text', props: { content: field.title, bold: true } },
          mrkdwnToFlowComponent(field.value ?? '', slackToXyneMap, slackToXyneGroupMap),
        ],
      }),
    );
    children.push(fieldsToGrid(fieldColumns));
  }

  if (attachment.image_url) {
    children.push({
      id: crypto.randomUUID(),
      type: 'image',
      props: { src: attachment.image_url, alt: 'attachment image' },
    });
  }

  if (attachment.footer) {
    children.push({
      id: crypto.randomUUID(),
      type: 'text',
      props: { content: attachment.footer, variant: 'muted', size: 'xs' },
    });
  }

  if (!children.length) return null;

  // Only add a left colour stripe when the attachment explicitly sets a color.
  // Attachments without color get a plain subtle border — NO left bar (matches Slack).
  // Invalid values (empty string, `{}`, null) still get the stripe, in the
  // default grey — the caller set `color`, so they wanted a bar.
  if (attachment.color !== undefined) {
    return withColorStripe(children, resolveAttachmentColor(attachment.color));
  }

  return {
    id: crypto.randomUUID(),
    type: 'column',
    style: {
      border: '1px solid var(--border, #e5e7eb)',
      borderRadius: '4px',
      padding: '8px 12px',
    },
    children,
  };
}

// ============================================================================
// Rich-text block → FlowComponent helpers
// ============================================================================

/**
 * Convert a rich_text block's elements to an array of FlowComponents,
 * preserving bold/italic/code/link styling from the inline elements.
 */
function richTextBlockToComponents(
  block: SlackRichTextBlock,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
): FlowComponent[] {
  return block.elements
    .map(el => richTextBlockElementToComponent(el, slackToXyneMap, slackToXyneGroupMap))
    .filter((c): c is FlowComponent => c !== null);
}

function richTextBlockElementToComponent(
  el: SlackRichTextBlockElement,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
): FlowComponent | null {
  switch (el.type) {
    case 'rich_text_section': {
      const parts = el.elements
        .map(e => richTextInlineToComponent(e, slackToXyneMap, slackToXyneGroupMap))
        .filter(Boolean) as FlowComponent[];
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      return { id: crypto.randomUUID(), type: 'row', children: parts };
    }
    case 'rich_text_list': {
      const lines = el.elements.map((item, index) => {
        const marker = el.style === 'ordered' ? `${index + 1}.` : '•';
        const content = item.elements
          .map(e => richTextInlineToMrkdwn(e, slackToXyneMap))
          .join('');
        return `${marker} ${content}`;
      });
      return { id: crypto.randomUUID(), type: 'text', props: { content: lines.join('\n') } };
    }
    case 'rich_text_preformatted': {
      const text = el.elements.map(richTextInlineToString).join('');
      return {
        id: crypto.randomUUID(),
        type: 'text',
        props: { content: text, variant: 'muted', codeBlock: true },
      };
    }
    case 'rich_text_quote': {
      const parts = el.elements.map(e => richTextInlineToComponent(e, slackToXyneMap, slackToXyneGroupMap)).filter(Boolean) as FlowComponent[];
      if (!parts.length) return null;
      return withChatQuoteStyle(parts);
    }
    default:
      return null;
  }
}

function richTextInlineToComponent(
  el: SlackRichTextInlineElement,
  slackToXyneMap?: Map<string, string>,
  slackToXyneGroupMap?: Map<string, string>,
): FlowComponent | null {
  switch (el.type) {
    case 'text': {
      const props: Record<string, unknown> = {
        content: richTextTextToMrkdwn(el.text, el.style),
      };
      if (el.style?.bold)   props['bold']   = true;
      if (el.style?.italic) props['italic'] = true;
      return { id: crypto.randomUUID(), type: 'text', props };
    }
    case 'link': {
      // Emit as a parseable <url|label> token so TextNode renders it as an <a>.
      const label = el.text || el.url;
      const token = label !== el.url ? `<${el.url}|${label}>` : `<${el.url}>`;
      const props: Record<string, unknown> = { content: richTextTextToMrkdwn(token, el.style) };
      if (el.style?.bold)   props['bold']   = true;
      if (el.style?.italic) props['italic'] = true;
      return { id: crypto.randomUUID(), type: 'text', props };
    }
    case 'emoji':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `:${el.name}:` } };
    case 'user': {
      // Resolve the Slack user_id to a Xyne DB ID when available so the
      // dashboard MentionRenderer can look up the display name correctly.
      const xyneId = slackToXyneMap?.get(el.user_id) ?? el.user_id;
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<userid:${xyneId}>` } };
    }
    case 'channel':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<channelid:${el.channel_id}>` } };
    case 'broadcast':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<broadcast:${el.range}>` } };
    case 'usergroup': {
      const xyneGroupId = slackToXyneGroupMap?.get(el.usergroup_id) ?? el.usergroup_id;
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<groupid:${xyneGroupId}>` } };
    }
    default:
      return null;
  }
}

function richTextTextToMrkdwn(text: string, style?: { strike?: boolean; code?: boolean }): string {
  let content = text;
  if (style?.code) content = `\`${content}\``;
  if (style?.strike) content = `~${content}~`;
  return content;
}

function richTextInlineToMrkdwn(
  el: SlackRichTextInlineElement,
  slackToXyneMap?: Map<string, string>,
): string {
  switch (el.type) {
    case 'text': {
      let text = richTextTextToMrkdwn(el.text, el.style);
      if (el.style?.bold) text = `*${text}*`;
      if (el.style?.italic) text = `_${text}_`;
      return text;
    }
    case 'link': {
      const label = el.text || el.url;
      const token = label !== el.url ? `<${el.url}|${label}>` : `<${el.url}>`;
      return richTextTextToMrkdwn(token, el.style);
    }
    case 'emoji':
      return `:${el.name}:`;
    case 'user': {
      const xyneId = slackToXyneMap?.get(el.user_id) ?? el.user_id;
      return `<userid:${xyneId}>`;
    }
    case 'channel':
      return `<channelid:${el.channel_id}>`;
    case 'broadcast':
      return `<broadcast:${el.range}>`;
    case 'usergroup':
      return `@${el.usergroup_id}`;
    default:
      return '';
  }
}

// Kept for preformatted text (needs plain string, not components)
function richTextInlineToString(el: SlackRichTextInlineElement): string {
  switch (el.type) {
    case 'text':      return el.text;
    case 'link':      return el.text ?? el.url;
    case 'emoji':     return `:${el.name}:`;
    case 'user':      return `@${el.user_id}`;
    case 'channel':   return `#${el.channel_id}`;
    case 'broadcast': return `@${el.range}`;
    case 'usergroup': return `@${el.usergroup_id}`;
    default:          return '';
  }
}
