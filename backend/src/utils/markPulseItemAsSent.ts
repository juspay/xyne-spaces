import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';

/**
 * Rewrite a Pulse actionables message's YAML frontmatter to move `itemId`
 * from the `pulseItems` array into the `pulseSent` array.
 *
 * Mirrors the backend equivalent of replaceTicketSuggestionWithCreated from
 * markdownTicketSuggestions.ts but for the Pulse schema.
 */
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

export function markPulseItemAsSent(
  markdown: string,
  itemId: string,
  sentAt: string,
): string {
  const frontmatter = parseFrontmatter(markdown);
  if (!frontmatter?.data) return markdown;

  const { data, end } = frontmatter;
  const dataObj = data as Record<string, unknown>;

  const rawItems = Array.isArray(dataObj['pulseItems']) ? [...dataObj['pulseItems']] : [];
  const rawSent = Array.isArray(dataObj['pulseSent']) ? [...dataObj['pulseSent']] : [];

  const sentItem = rawItems.find(
    (i: unknown) => (i as Record<string, unknown>)['itemId'] === itemId,
  );
  if (!sentItem) return markdown; // already moved or not found

  const updatedItems = rawItems.filter(
    (i: unknown) => (i as Record<string, unknown>)['itemId'] !== itemId,
  );
  const sentRecord = { ...(sentItem as Record<string, unknown>), sentAt };
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
