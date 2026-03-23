import { z } from 'zod';
import { BaseTool, Tool } from '@framework';
import type { ToolExecutionContext, ToolExecutionResult } from '@framework';
import { searchMemory } from '@/services/memoryService';
import { MemoryScope, VespaDocType } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

const InputSchema = z.object({
  query: z.string().describe('Search query to find relevant SOPs or Facts'),
  excludeSessionId: z.string().optional().describe('Session ID to exclude from results (pass current session ID to avoid self-referencing)'),
  docType: z.enum(['SOP', 'FACT']).optional().describe('Filter by document type'),
  tags: z.array(z.string()).optional().describe('Filter by tags (OR-matched)'),
  repoUrl: z.string().optional().describe('Filter by repository URL'),
  userId: z.string().optional().describe('Owner userId to scope results'),
});

const OutputSchema = z.object({
  results: z.string().describe('Formatted search results for LLM consumption'),
  totalCount: z.number(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

const DESCRIPTION = `Search the knowledge base for APPROVED SOPs and Facts from OTHER sessions.

Use this to learn from existing approved knowledge to inform your analysis.
NOTE: This only returns approved knowledge (reviewStatus='approved') and excludes the current session.

PARAMETERS:
- query: (required) What to search for
- excludeSessionId: (recommended) Pass the current session ID to exclude it from results
- docType: (optional) 'SOP' or 'FACT' — omit to search both
- tags: (optional) Filter by tags (OR-matched)
- repoUrl: (optional) Filter by repository URL
- userId: (optional) Owner to scope results

RETURNS: Matching APPROVED documents from other sessions with their userQuery, chatSummary, tags, and filePointers.

WHEN TO USE:
- To learn from similar patterns in approved knowledge
- To understand how similar topics have been documented before
- To ensure consistency with existing approved knowledge
`;

@Tool({
  name: 'search-memory',
  description: DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  llmOutputSchema: OutputSchema,
  version: '1.0.0',
  tags: ['memory', 'search', 'sop', 'facts'],
  category: 'memory',
})
export class SearchMemoryTool extends BaseTool<Input, Output, Output> {
  protected readonly inputSchema = InputSchema;
  protected readonly outputSchema = OutputSchema;
  protected readonly toolName = 'search-memory';

  public getLLMOutput(result: ToolExecutionResult<Output>): Output {
    if (!result.success || !result.data) {
      return { results: result.error?.message ?? 'Search failed', totalCount: 0 };
    }
    return result.data;
  }

  protected async executeInternal(input: Input, _context: ToolExecutionContext): Promise<Output> {
    logger.info(`[search-memory] query="${input.query}" excludeSessionId=${input.excludeSessionId ?? 'none'} docType=${input.docType ?? 'any'}`);

    const userId = input.userId ?? '';

    const result = await searchMemory(
      {
        query: input.query,
        scope: MemoryScope.ALL,
        limit: 10,
        offset: 0,
        reviewStatus: 'approved',
        ...(input.docType && { docType: input.docType as VespaDocType }),
        ...(input.tags && { tags: input.tags }),
        ...(input.repoUrl && { repoUrl: input.repoUrl }),
      },
      userId,
    );

    const filteredDocs = input.excludeSessionId
      ? result.documents.filter((doc) => doc.sessionId !== input.excludeSessionId)
      : result.documents;

    if (!filteredDocs.length) {
      return { results: 'No matching approved knowledge found from other sessions.', totalCount: 0 };
    }

    const formatted = filteredDocs.map((doc, i) => {
      return [
        `[${i + 1}] docId: ${doc.docId}`,
        `    type: ${doc.docType}`,
        `    userQuery: ${doc.userQuery}`,
        `    tags: ${(doc.tags ?? []).join(', ') || 'none'}`,
        `    filePointers: ${(doc.filePointers ?? []).join(', ') || 'none'}`,
        `    summary: ${(doc.chatSummary ?? []).slice(0, 2).join(' | ')}`,
      ].join('\n');
    });

    return {
      results: `Found ${filteredDocs.length} approved document(s) from other sessions:\n\n${formatted.join('\n\n')}`,
      totalCount: filteredDocs.length,
    };
  }
}
