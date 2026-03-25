/**
 * Utility to parse markdown content with workflow actions in frontmatter blocks
 * Extracts structured data from frontmatter blocks and returns clean markdown
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad } from 'js-yaml';

export interface WorkflowActionButton {
  label: string;
  action: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | undefined;
}

export interface WorkflowAction {
  workflowExecutionId: string;
  workflowStepId: string;
  responded: boolean;
  buttons: WorkflowActionButton[];
}

export interface ParsedWorkflowActions {
  workflowActions: WorkflowAction | null;
  content: string;
}

/**
 * Parse frontmatter block at document start
 * Returns parsed YAML data or null if no frontmatter found
 */
function parseFrontmatter(markdown: string): { data: unknown; end: number } | null {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(markdown);

  // Find the first yaml node
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const data = yamlLoad(node.value);
        return {
          data,
          end: node.position?.end.offset ?? 0,
        };
      } catch {
        // Failed to parse YAML frontmatter
        return null;
      }
    }
  }

  return null;
}

/**
 * Parse markdown content that may contain workflow actions in frontmatter
 * @param markdown - Raw markdown content with optional frontmatter containing workflow actions
 * @returns Parsed workflow actions and clean markdown content
 */
export function parseWorkflowActionsFromMarkdown(markdown: string): ParsedWorkflowActions {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    return {
      workflowActions: null,
      content: markdown,
    };
  }

  const { data, end } = frontmatter;

  // Type guard and extract workflow actions
  const dataObj = data as Record<string, unknown>;
  const workflowActionsData = dataObj['workflowActions'];

  if (!workflowActionsData || typeof workflowActionsData !== 'object') {
    return {
      workflowActions: null,
      content: markdown.substring(end).trim(),
    };
  }

  const actionsObj = workflowActionsData as Record<string, unknown>;

  // Parse buttons array
  const buttonsData = Array.isArray(actionsObj['buttons']) ? actionsObj['buttons'] : [];
  const buttons: WorkflowActionButton[] = buttonsData
    .map((b: unknown) => {
      const button = b as Record<string, unknown>;
      const variantRaw = typeof button['variant'] === 'string' ? button['variant'] : undefined;
      const validVariants: Array<WorkflowActionButton['variant']> = [
        'default',
        'outline',
        'secondary',
        'ghost',
        'destructive',
      ];
      const variant =
        variantRaw && validVariants.includes(variantRaw as WorkflowActionButton['variant'])
          ? (variantRaw as WorkflowActionButton['variant'])
          : undefined;
      return {
        label: typeof button['label'] === 'string' ? button['label'] : '',
        action: typeof button['action'] === 'string' ? button['action'] : '',
        variant,
      };
    })
    .filter(b => b.label && b.action);

  const workflowActions: WorkflowAction = {
    workflowExecutionId:
      typeof actionsObj['workflowExecutionId'] === 'string'
        ? actionsObj['workflowExecutionId']
        : '',
    workflowStepId:
      typeof actionsObj['workflowStepId'] === 'string' ? actionsObj['workflowStepId'] : '',
    responded: typeof actionsObj['responded'] === 'boolean' ? actionsObj['responded'] : false,
    buttons,
  };

  // Remove frontmatter from content
  const cleanContent = markdown.substring(end).trim();

  return {
    workflowActions: workflowActions.workflowExecutionId ? workflowActions : null,
    content: cleanContent,
  };
}
