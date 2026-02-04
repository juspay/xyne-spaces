import { logger } from './logger';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

export interface TicketCreatedInfo {
  ticketId: string;
  xyneId: string;
  title: string;
  conversationId: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Parse frontmatter block at document start
 */
function parseFrontmatter(markdown: string): { data: any; end: number } | null {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .parse(markdown);

  for (const node of tree.children) {
    if (node.type === 'yaml') {
      try {
        const data = yamlLoad(node.value);
        return {
          data,
          end: node.position?.end.offset || 0,
        };
      } catch (error) {
        logger.error('Failed to parse YAML frontmatter', { error });
        return null;
      }
    }
  }

  return null;
}

/**
 * Replace a ticket suggestion with a created ticket in the frontmatter
 * @param markdown - Original markdown content with suggestions in frontmatter
 * @param suggestionId - UUID of the suggestion to replace
 * @param ticketInfo - Information about the created ticket
 * @returns Updated markdown with the suggestion moved to created array
 */
export function replaceTicketSuggestionWithCreated(
  markdown: string,
  suggestionId: string,
  ticketInfo: TicketCreatedInfo
): string {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    logger.error('No frontmatter found in markdown');
    return markdown;
  }

  const { data, end } = frontmatter;

  // Remove suggestion from suggestions array
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  const updatedSuggestions = suggestions.filter((s: any) => s.suggestionId !== suggestionId);

  // Add to created array
  const created = Array.isArray(data.created) ? data.created : [];
  const updatedCreated = [
    ...created,
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
  const updatedData: any = { ...data };
  if (updatedSuggestions.length > 0) {
    updatedData.suggestions = updatedSuggestions;
  } else {
    delete updatedData.suggestions;
  }
  if (updatedCreated.length > 0) {
    updatedData.created = updatedCreated;
  }

  // Generate new YAML frontmatter
  const newFrontmatter = '---\n' + yamlDump(updatedData) + '---\n';

  // Replace frontmatter and keep rest of content
  const contentAfterFrontmatter = markdown.substring(end);
  return newFrontmatter + contentAfterFrontmatter;
}

/**
 * Parse ticket-created blocks from markdown frontmatter
 * @param markdown - Markdown content with frontmatter
 * @returns Array of created ticket information
 */
export function parseTicketCreatedBlocks(markdown: string): TicketCreatedInfo[] {
  const frontmatter = parseFrontmatter(markdown);

  if (!frontmatter || !frontmatter.data) {
    return [];
  }

  const created = Array.isArray(frontmatter.data.created) ? frontmatter.data.created : [];
  
  return created
    .map((c: any) => {
      if (c.ticketId && c.xyneId && c.title && c.conversationId && c.createdBy && c.createdAt) {
        return {
          ticketId: c.ticketId,
          xyneId: c.xyneId,
          title: c.title,
          conversationId: c.conversationId,
          createdBy: c.createdBy,
          createdAt: c.createdAt,
        };
      }
      logger.warn('Incomplete ticket-created data:', c);
      return null;
    })
    .filter((t: TicketCreatedInfo | null): t is TicketCreatedInfo => t !== null);
}
