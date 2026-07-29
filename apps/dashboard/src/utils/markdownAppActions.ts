/**
 * Utility to parse markdown content with app actions in frontmatter blocks.
 * Extracts appActions and actioned arrays from YAML frontmatter.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad } from 'js-yaml';

export interface AppAction {
  actionId: string;
  label: string;
  type: 'button' | 'link';
  color: string;
  actionableUrl: string;
  context?: Record<string, unknown> | undefined;
}

export interface ActionedItem {
  actionId: string;
  label: string;
  color: string;
  actionedAt: string;
}

export interface ParsedAppActions {
  appActions: AppAction[];
  actioned: ActionedItem[];
  content: string;
}

function parseFrontmatter(markdown: string): { data: unknown; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const data = yamlLoad(node.value);
        return { data, end: node.position?.end.offset ?? 0 };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function parseMarkdownWithAppActions(markdown: string): ParsedAppActions {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    return { appActions: [], actioned: [], content: markdown };
  }

  const { data, end } = frontmatter;
  const dataObj = data as Record<string, unknown>;
  const rawActions = Array.isArray(dataObj['appActions']) ? dataObj['appActions'] : [];
  const rawActioned = Array.isArray(dataObj['actioned']) ? dataObj['actioned'] : [];

  const appActions: AppAction[] = rawActions
    .map((a: unknown) => {
      const action = a as Record<string, unknown>;
      return {
        actionId: typeof action['actionId'] === 'string' ? action['actionId'] : '',
        label: typeof action['label'] === 'string' ? action['label'] : '',
        type: action['type'] === 'link' ? ('link' as const) : ('button' as const),
        color: typeof action['color'] === 'string' ? action['color'] : '#6b7280',
        actionableUrl: typeof action['actionableUrl'] === 'string' ? action['actionableUrl'] : '',
        context:
          typeof action['context'] === 'object' && action['context'] !== null
            ? (action['context'] as Record<string, unknown>)
            : undefined,
      };
    })
    .filter(a => a.actionId && a.label && a.actionableUrl);

  const actioned: ActionedItem[] = rawActioned
    .map((a: unknown) => {
      const item = a as Record<string, unknown>;
      return {
        actionId: typeof item['actionId'] === 'string' ? item['actionId'] : '',
        label: typeof item['label'] === 'string' ? item['label'] : '',
        color: typeof item['color'] === 'string' ? item['color'] : '#6b7280',
        actionedAt: typeof item['actionedAt'] === 'string' ? item['actionedAt'] : '',
      };
    })
    .filter(a => a.actionId && a.label);

  const content = markdown.substring(end).trim();

  return { appActions, actioned, content };
}
