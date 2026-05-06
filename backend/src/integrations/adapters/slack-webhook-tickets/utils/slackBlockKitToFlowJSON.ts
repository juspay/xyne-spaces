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
 * Convert a BlockKit message to a FlowDefinition (v2).
 *
 * @param input    BlockKit payload (text / blocks / attachments)
 * @param botToken Kept for API compatibility; mention resolution is now done
 *                 client-side via MentionRenderer so this is intentionally ignored.
 * @returns        FlowDefinition when structured content is found, null otherwise
 */
export async function convertBlockKitToFlowJSON(
  input: BlockKitInput,
  _botToken?: string,
): Promise<FlowDefinition | null> {
  // Mentions are NOT pre-resolved here. Instead, Slack's <@USERID> tokens are
  // normalised to Xyne's <userid:USERID> format inside mrkdwnToFlowComponent
  // so the dashboard's MentionRenderer can look up display names at render time.
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

  const components: FlowComponent[] = [];

  // Prepend plain text that accompanies a blocks payload
  if (plainText && blocks?.length) {
    components.push(mrkdwnToFlowComponent(plainText));
  }

  // Convert modern blocks
  for (const block of blocks ?? []) {
    const component = slackBlockToFlowComponent(block);
    if (component) components.push(component);
  }

  // Convert legacy attachments → bordered stripe components
  for (const attachment of resolvedAttachments ?? []) {
    const card = slackAttachmentToFlowComponent(attachment);
    if (card) components.push(card);
  }

  if (!components.length) return null;

  // When there are only modern blocks (no attachments), wrap them in a
  // default-colour stripe so the layout is always a single bordered container.
  const finalComponents: FlowComponent[] =
    !resolvedAttachments?.length && components.length
      ? [withColorStripe(components, resolveAttachmentColor(undefined))]
      : components;

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
function normalizeSlackMentions(text: string): string {
  return text
    .replace(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `<userid:${id}>`)
    .replace(/<#([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `<channelid:${id}>`)
    .replace(/<!([a-z]+)(?:\|[^>]*)?>/g,       (_, name) => `@${name}`);
}

/**
 * Convert a Slack text object (or raw mrkdwn string) to a single `text`
 * FlowComponent.  The content is stored as-is (with Slack mentions normalised)
 * so that the frontend TextNode inline parser renders bold, italic, code, links,
 * and mentions correctly without splitting the text into multiple components.
 */
export function mrkdwnToFlowComponent(textObj: SlackTextObject | string): FlowComponent {
  const raw      = typeof textObj === 'string' ? textObj : textObj.text;
  const isMrkdwn = typeof textObj === 'string' || textObj.type === 'mrkdwn';
  const content  = isMrkdwn ? normalizeSlackMentions(raw) : raw;
  return { id: crypto.randomUUID(), type: 'text', props: { content } };
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

/**
 * Resolve a Slack attachment color (named string or hex) to a CSS hex value.
 * Falls back to a neutral grey when absent.
 */
function resolveAttachmentColor(color?: string): string {
  if (!color) return '#d1d5db'; // neutral grey
  return NAMED_COLORS[color.toLowerCase()] ?? (color.startsWith('#') ? color : `#${color}`);
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

// ============================================================================
// Block converters
// ============================================================================

/** Convert a single modern Slack block to a FlowComponent (returns null for unknown types). */
export function slackBlockToFlowComponent(block: SlackBlock): FlowComponent | null {
  switch (block.type) {
    case 'header':
      return {
        id: crypto.randomUUID(),
        type: 'heading',
        props: { content: block.text.text, level: 2 },
      };

    case 'divider':
      return { id: crypto.randomUUID(), type: 'divider' };

    case 'image': {
      const imgBlock = block as SlackImageBlock;
      const imageComponent: FlowComponent = {
        id: crypto.randomUUID(),
        type: 'image',
        props: { src: imgBlock.image_url, alt: imgBlock.alt_text },
      };
      if (imgBlock.title) {
        return {
          id: crypto.randomUUID(),
          type: 'column',
          children: [
            mrkdwnToFlowComponent(imgBlock.title),
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
        sectionChildren.push(mrkdwnToFlowComponent(sectionBlock.text));
      }

      if (sectionBlock.fields?.length) {
        const fieldComponents: FlowComponent[] = sectionBlock.fields.map(
          (field): FlowComponent => mrkdwnToFlowComponent(field),
        );
        sectionChildren.push({
          id: crypto.randomUUID(),
          type: 'row',
          children: fieldComponents,
        });
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
      // Render each context text element parsed through mrkdwn, then collect into a row
      const parsed = textSegments.map((el) => mrkdwnToFlowComponent(el));
      return {
        id: crypto.randomUUID(),
        type: 'row',
        style: { gap: '4px' },
        children: parsed.map((c) => ({ ...c, style: { ...((c as any).style ?? {}), ...{ fontSize: 'sm' } } })),
      };
    }

    case 'rich_text': {
      const richTextBlock = block as SlackRichTextBlock;
      const children = richTextBlockToComponents(richTextBlock);
      if (!children.length) return null;
      if (children.length === 1) return children[0];
      return { id: crypto.randomUUID(), type: 'column', children };
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
export function slackAttachmentToFlowComponent(attachment: SlackAttachment): FlowComponent | null {
  const children: FlowComponent[] = [];

  if (attachment.pretext) {
    children.push(mrkdwnToFlowComponent(attachment.pretext));
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
      const component = slackBlockToFlowComponent(block);
      if (component) children.push(component);
    }
  } else if (attachment.text) {
    children.push(mrkdwnToFlowComponent(attachment.text));
  }

  // Key-value fields — each field value is parsed through mrkdwn
  if (attachment.fields?.length) {
    const fieldColumns: FlowComponent[] = attachment.fields.map(
      (field): FlowComponent => ({
        id: crypto.randomUUID(),
        type: 'column',
        children: [
          { id: crypto.randomUUID(), type: 'text', props: { content: field.title, bold: true } },
          mrkdwnToFlowComponent(field.value),
        ],
      }),
    );
    children.push({ id: crypto.randomUUID(), type: 'row', children: fieldColumns });
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

  const color = resolveAttachmentColor(attachment.color);

  // Single container with left colour stripe — no extra card wrapper
  return withColorStripe(children, color);
}

// ============================================================================
// Rich-text block → FlowComponent helpers
// ============================================================================

/**
 * Convert a rich_text block's elements to an array of FlowComponents,
 * preserving bold/italic/code/link styling from the inline elements.
 */
function richTextBlockToComponents(block: SlackRichTextBlock): FlowComponent[] {
  return block.elements
    .map(richTextBlockElementToComponent)
    .filter((c): c is FlowComponent => c !== null);
}

function richTextBlockElementToComponent(el: SlackRichTextBlockElement): FlowComponent | null {
  switch (el.type) {
    case 'rich_text_section': {
      const parts = el.elements.map(richTextInlineToComponent).filter(Boolean) as FlowComponent[];
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      return { id: crypto.randomUUID(), type: 'row', children: parts };
    }
    case 'rich_text_list': {
      const items = el.elements.map((item): FlowComponent => {
        const parts = item.elements.map(richTextInlineToComponent).filter(Boolean) as FlowComponent[];
        const bullet: FlowComponent = {
          id: crypto.randomUUID(),
          type: 'text',
          props: { content: el.style === 'ordered' ? '' : '•' },
        };
        return {
          id: crypto.randomUUID(),
          type: 'row',
          children: [bullet, ...(parts.length ? parts : [{ id: crypto.randomUUID(), type: 'text', props: { content: '' } } as FlowComponent])],
        };
      });
      return { id: crypto.randomUUID(), type: 'column', children: items };
    }
    case 'rich_text_preformatted': {
      const text = el.elements.map(richTextInlineToString).join('');
      return { id: crypto.randomUUID(), type: 'text', props: { content: text, variant: 'muted' } };
    }
    case 'rich_text_quote': {
      const parts = el.elements.map(richTextInlineToComponent).filter(Boolean) as FlowComponent[];
      if (!parts.length) return null;
      return withColorStripe(parts, '#d1d5db');
    }
    default:
      return null;
  }
}

function richTextInlineToComponent(el: SlackRichTextInlineElement): FlowComponent | null {
  switch (el.type) {
    case 'text': {
      const props: Record<string, unknown> = { content: el.text };
      if (el.style?.bold)   props['bold']   = true;
      if (el.style?.italic) props['italic'] = true;
      if (el.style?.code)   props['variant'] = 'muted';
      return { id: crypto.randomUUID(), type: 'text', props };
    }
    case 'link': {
      // Emit as a parseable <url|label> token so TextNode renders it as an <a>.
      const label = el.text || el.url;
      const token = label !== el.url ? `<${el.url}|${label}>` : `<${el.url}>`;
      const props: Record<string, unknown> = { content: token };
      if (el.style?.bold)   props['bold']   = true;
      if (el.style?.italic) props['italic'] = true;
      return { id: crypto.randomUUID(), type: 'text', props };
    }
    case 'emoji':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `:${el.name}:` } };
    case 'user':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<userid:${el.user_id}>` } };
    case 'channel':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `<channelid:${el.channel_id}>` } };
    case 'broadcast':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `@${el.range}` } };
    case 'usergroup':
      return { id: crypto.randomUUID(), type: 'text', props: { content: `@${el.usergroup_id}` } };
    default:
      return null;
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
