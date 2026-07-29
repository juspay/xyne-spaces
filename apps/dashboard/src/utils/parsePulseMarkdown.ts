/**
 * Utility to parse a Pulse actionables message.
 * The message content follows the same YAML frontmatter convention as
 * markdownTicketSuggestions.ts, but uses a `pulseItems` / `pulseSent` schema.
 *
 * Frontmatter shape produced by transcriptService.postPulseTicketsAsMessage:
 *
 *   ---
 *   pulseItems:
 *     - itemId: <uuid>
 *       content: <text>
 *       assignee: <email>
 *   pulseSent:
 *     - itemId: <uuid>
 *       content: <text>
 *       assignee: <email>
 *       sentAt: <ISO timestamp>
 *   ---
 *
 *   ## Suggested Pulse Actionables
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PulseMerchant {
  id: string; // m1, m2, etc.
  name: string;
  orgId: string;
  merchantId?: string | null | undefined;
  productId?: string | null | undefined;
}

export interface PulseItem {
  itemId: string;
  merchantId: string; // references PulseMerchant.id
  content: string;
  assignee: string;
}

export interface PulseSentItem extends PulseItem {
  sentAt: string;
}

export interface ParsedPulseMarkdown {
  merchants: PulseMerchant[];
  pulseItems: PulseItem[];
  pulseSent: PulseSentItem[];
  content: string; // clean markdown (frontmatter stripped)
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseFrontmatter(markdown: string): { data: unknown; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        const data = yamlLoad(node.value);
        return { data, end: node.position?.end.offset ?? 0 };
      } catch {
        return null;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a Pulse actionables bot message. */
export function parsePulseMarkdown(markdown: string): ParsedPulseMarkdown {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter?.data) {
    return { merchants: [], pulseItems: [], pulseSent: [], content: markdown };
  }

  const { data, end } = frontmatter;
  const dataObj = data as Record<string, unknown>;

  const toItems = (arr: unknown[]): PulseItem[] =>
    arr
      .map((raw: unknown) => {
        const r = raw as Record<string, unknown>;
        return {
          itemId: typeof r['itemId'] === 'string' ? r['itemId'] : '',
          merchantId: typeof r['merchantId'] === 'string' ? r['merchantId'] : '',
          content: typeof r['content'] === 'string' ? r['content'] : '',
          assignee: typeof r['assignee'] === 'string' ? r['assignee'] : '',
        };
      })
      .filter(i => i.itemId && i.content);

  const toSentItems = (arr: unknown[]): PulseSentItem[] =>
    arr
      .map((raw: unknown) => {
        const r = raw as Record<string, unknown>;
        return {
          itemId: typeof r['itemId'] === 'string' ? r['itemId'] : '',
          merchantId: typeof r['merchantId'] === 'string' ? r['merchantId'] : '',
          content: typeof r['content'] === 'string' ? r['content'] : '',
          assignee: typeof r['assignee'] === 'string' ? r['assignee'] : '',
          sentAt: typeof r['sentAt'] === 'string' ? r['sentAt'] : new Date().toISOString(),
        };
      })
      .filter(i => i.itemId && i.content);

  const toMerchants = (arr: unknown[]): PulseMerchant[] =>
    arr
      .map((raw: unknown) => {
        const r = raw as Record<string, unknown>;
        return {
          id: typeof r['id'] === 'string' ? r['id'] : '',
          name: typeof r['name'] === 'string' ? r['name'] : '',
          orgId: typeof r['orgId'] === 'string' ? r['orgId'] : '',
          merchantId: typeof r['merchantId'] === 'string' ? r['merchantId'] : undefined,
          productId: typeof r['productId'] === 'string' ? r['productId'] : undefined,
        };
      })
      .filter(m => m.id && m.name && m.orgId);

  const rawItems = Array.isArray(dataObj['pulseItems']) ? dataObj['pulseItems'] : [];
  const rawSent = Array.isArray(dataObj['pulseSent']) ? dataObj['pulseSent'] : [];
  const rawMerchants = Array.isArray(dataObj['merchants']) ? dataObj['merchants'] : [];

  return {
    merchants: toMerchants(rawMerchants),
    pulseItems: toItems(rawItems),
    pulseSent: toSentItems(rawSent),
    content: markdown.substring(end).trim(),
  };
}

/**
 * Rewrite the frontmatter to move a pulseItem into pulseSent.
 * Returns the updated full markdown string.
 */
export function markPulseItemAsSent(markdown: string, itemId: string, sentAt: string): string {
  const frontmatter = parseFrontmatter(markdown);
  if (!frontmatter?.data) return markdown;

  const { data, end } = frontmatter;
  const dataObj = data as Record<string, unknown>;

  const rawItems: Record<string, unknown>[] = Array.isArray(dataObj['pulseItems'])
    ? (dataObj['pulseItems'] as unknown[]).map(i => i as Record<string, unknown>)
    : [];
  const rawSent: Record<string, unknown>[] = Array.isArray(dataObj['pulseSent'])
    ? (dataObj['pulseSent'] as unknown[]).map(i => i as Record<string, unknown>)
    : [];

  const sentItem = rawItems.find(i => i['itemId'] === itemId);
  if (!sentItem) return markdown; // already moved or not found

  const updatedItems = rawItems.filter(i => i['itemId'] !== itemId);
  const sentRecord: Record<string, unknown> = { ...sentItem, sentAt };
  const updatedSent = [...rawSent, sentRecord];

  const updatedData: Record<string, unknown> = { ...dataObj };
  if (updatedItems.length > 0) {
    updatedData['pulseItems'] = updatedItems;
  } else {
    delete updatedData['pulseItems'];
  }
  updatedData['pulseSent'] = updatedSent;

  const newFrontmatter = '---\n' + yamlDump(updatedData) + '---\n';
  return newFrontmatter + markdown.substring(end);
}
