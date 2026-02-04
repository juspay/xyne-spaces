/**
 * Utility to parse markdown content with ticket suggestions in frontmatter blocks
 * Extracts structured data from frontmatter blocks and returns clean markdown
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

export interface TicketSuggestion {
  suggestionId: string; // Unique UUID for this suggestion
  title: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  suggestedAssignee: string;
}

export interface TicketCreatedInfo {
  ticketId: string;
  xyneId: string;
  title: string;
  conversationId: string;
  createdBy: string;
  createdAt: string;
}

export interface ParsedMarkdown {
  ticketSuggestions: TicketSuggestion[];
  ticketsCreated: TicketCreatedInfo[];
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
 * Parse markdown content that may contain ticket data in frontmatter
 * @param markdown - Raw markdown content with optional frontmatter containing ticket data
 * @returns Parsed ticket suggestions, created tickets, and clean markdown content
 */
export function parseMarkdownWithTicketSuggestions(markdown: string): ParsedMarkdown {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    return {
      ticketSuggestions: [],
      ticketsCreated: [],
      content: markdown,
    };
  }

  const { data, end } = frontmatter;

  // Type guard and extract suggestions
  const dataObj = data as Record<string, unknown>;
  const suggestions = Array.isArray(dataObj['suggestions']) ? dataObj['suggestions'] : [];
  const created = Array.isArray(dataObj['created']) ? dataObj['created'] : [];

  // Extract suggestions and created tickets from YAML structure
  const ticketSuggestions: TicketSuggestion[] = suggestions
    .map((s: unknown) => {
      const suggestion = s as Record<string, unknown>;
      return {
        suggestionId:
          typeof suggestion['suggestionId'] === 'string' ? suggestion['suggestionId'] : '',
        title: typeof suggestion['title'] === 'string' ? suggestion['title'] : '',
        priority:
          typeof suggestion['priority'] === 'string'
            ? (suggestion['priority'] as TicketSuggestion['priority'])
            : ('MEDIUM' as const),
        description: typeof suggestion['description'] === 'string' ? suggestion['description'] : '',
        suggestedAssignee: typeof suggestion['assignee'] === 'string' ? suggestion['assignee'] : '',
      };
    })
    .filter(s => s.suggestionId && s.title);

  const ticketsCreated: TicketCreatedInfo[] = created
    .map((c: unknown) => {
      const ticket = c as Record<string, unknown>;
      return {
        ticketId: typeof ticket['ticketId'] === 'string' ? ticket['ticketId'] : '',
        xyneId: typeof ticket['xyneId'] === 'string' ? ticket['xyneId'] : '',
        title: typeof ticket['title'] === 'string' ? ticket['title'] : '',
        conversationId:
          typeof ticket['conversationId'] === 'string' ? ticket['conversationId'] : '',
        createdBy: typeof ticket['createdBy'] === 'string' ? ticket['createdBy'] : '',
        createdAt: typeof ticket['createdAt'] === 'string' ? ticket['createdAt'] : '',
      };
    })
    .filter(t => t.ticketId && t.xyneId);

  // Remove frontmatter from content
  const cleanContent = markdown.substring(end).trim();

  return {
    ticketSuggestions,
    ticketsCreated,
    content: cleanContent,
  };
}

/**
 * Replace a ticket suggestion with a created ticket in the frontmatter
 * @param markdown - Full markdown content
 * @param suggestionId - UUID of the suggestion to replace
 * @param ticketInfo - Created ticket information
 * @returns Updated markdown with suggestion moved to created array
 */
export function replaceTicketSuggestionWithCreated(
  markdown: string,
  suggestionId: string,
  ticketInfo: TicketCreatedInfo,
): string {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    return markdown;
  }

  const { data, end } = frontmatter;

  // Type guard
  const dataObj = data as Record<string, unknown>;
  const suggestions = Array.isArray(dataObj['suggestions']) ? dataObj['suggestions'] : [];
  const created = Array.isArray(dataObj['created']) ? dataObj['created'] : [];

  // Remove the suggestion from suggestions array
  const updatedSuggestions = suggestions.filter((s: unknown) => {
    const suggestion = s as Record<string, unknown>;
    return suggestion['suggestionId'] !== suggestionId;
  });

  // Add to created array - safely spread existing created items
  const createdItems = created.map((item: unknown) => item as Record<string, unknown>);
  const updatedCreated = [
    ...createdItems,
    {
      ticketId: ticketInfo.ticketId,
      xyneId: ticketInfo.xyneId,
      title: ticketInfo.title,
      conversationId: ticketInfo.conversationId,
      createdBy: ticketInfo.createdBy,
      createdAt: ticketInfo.createdAt,
    },
  ];

  // Reconstruct YAML frontmatter
  const updatedData: Record<string, unknown> = { ...dataObj };
  if (updatedSuggestions.length > 0) {
    updatedData['suggestions'] = updatedSuggestions;
  } else {
    delete updatedData['suggestions'];
  }
  if (updatedCreated.length > 0) {
    updatedData['created'] = updatedCreated;
  }

  // Generate new YAML frontmatter
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const newFrontmatter = '---\n' + yamlDump(updatedData) + '---\n';

  // Replace frontmatter and keep rest of content
  const contentAfterFrontmatter = markdown.substring(end);
  return newFrontmatter + contentAfterFrontmatter;
}
