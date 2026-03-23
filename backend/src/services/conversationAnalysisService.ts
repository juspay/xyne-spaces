import { Agent } from 'agentic-framework';
import { createUserMessage } from '@framework';
import { agentService } from './agentService';
import { logger } from '@/utils/logger';
import { searchMemory } from './memoryService';
import { MemoryScope, VespaDocType, type VespaMemoryDocument } from '@/vespa/src/types';
import type { ConversationSourceAdapter, MemoryIngestionContext } from './conversationIngestion/types';

import './conversationIngestion/tools/searchMemoryTool';

const CONVERSATION_ANALYST_AGENT = 'conversation-analyst';
const CHUNK_SIZE = 40;
const MAX_SUMMARY_LENGTH = 2000;

export interface ExtractedSOP {
  userQuery: string;
  content: string;
  tags: string[];
  filePointers: string[];
  repoUrl?: string;
  commitId?: string;
  ticketId?: string;
}

export interface ExtractedFACT {
  userQuery: string;
  content: string;
  tags: string[];
  filePointers: string[];
  repoUrl?: string;
  commitId?: string;
  ticketId?: string;
}

export interface AnalysisResult {
  sops: ExtractedSOP[];
  facts: ExtractedFACT[];
  summary?: string;
}

const OUTPUT_FORMAT_INSTRUCTION = `
RESPOND WITH ONLY VALID JSON (no markdown, no explanation):

{
  "sops": [
    {
      "userQuery": "clear search query describing what this SOP addresses",
      "content": "complete SOP text with all procedural steps, file paths, commands, exact details. This should be in md format and proper formatting",
      "tags": ["keyword1", "keyword2"],
      "filePointers": ["relative/path/file.ts"],
      "repoUrl": "",
      "commitId": "",
      "ticketId": ""
    }
  ],
  "facts": [
    {
      "userQuery": "clear search query describing what question this answers",
      "content": "complete fact content with verbatim details - NO summarization. This should be in md format and proper formatting",
      "tags": ["keyword1"],
      "filePointers": ["relative/path/file.ts"],
      "repoUrl": "",
      "commitId": "",
      "ticketId": ""
    }
  ],
  "summary": "ONLY if NOT final chunk - brief summary for next iteration"
}

FIELD RULES:
- userQuery: Describes the topic for future search retrieval (e.g., "How to set up Bull queue with Redis")
- content: Include ALL details verbatim (exact paths, function names, code snippets, error messages)
- tags: Single-word keywords for categorization (e.g., "Bull", "Redis", "queue", "typescript")
- filePointers: Relative file paths contributing to this knowledge
- summary: ONLY include in non-final chunks to summarize context for next iteration
- Do NOT include debugging dead-ends or trial-and-error in SOPs
- Facts should preserve verbatim detail - do not lose information by summarizing
`;

/**
 * Fetch existing SOPs and Facts from Vespa for the given session
 */
async function fetchExistingKnowledge(
  sessionId: string,
  repoUrl?: string,
): Promise<{ sops: VespaMemoryDocument[]; facts: VespaMemoryDocument[] }> {
  const searchParams = {
    query: '',
    scope: MemoryScope.ALL,
    limit: 100,
    offset: 0,
    sessionId,
    ...(repoUrl && { repoUrl }),
  };

  const [sopsResult, factsResult] = await Promise.all([
    searchMemory({ ...searchParams, docType: VespaDocType.SOP }, ''),
    searchMemory({ ...searchParams, docType: VespaDocType.FACT }, ''),
  ]);

  return {
    sops: sopsResult.documents,
    facts: factsResult.documents,
  };
}

/**
 * Format existing knowledge for agent context
 */
function formatExistingKnowledge(
  sops: VespaMemoryDocument[],
  facts: VespaMemoryDocument[],
): string {
  if (sops.length === 0 && facts.length === 0) {
    return 'No existing knowledge found for this session.';
  }

  let formatted = '## EXISTING KNOWLEDGE FOR THIS SESSION:\n\n';

  if (sops.length > 0) {
    formatted += `### Existing SOPs (${sops.length}):\n`;
    sops.forEach((sop, i) => {
      formatted += `${i + 1}. userQuery: "${JSON.stringify(sop)}"\n`;
    });
  }

  if (facts.length > 0) {
    formatted += `### Existing Facts (${facts.length}):\n`;
    facts.forEach((fact, i) => {
      formatted += `${i + 1}. userQuery: "${JSON.stringify(fact)}"\n`;
    });
  }

  formatted += 'NOTE: You will REPLACE all existing knowledge with your updated analysis.\n\n';
  return formatted;
}

/**
 * Build prompt for first iteration with existing knowledge
 */
function buildFirstIterationPrompt(
  chunk: unknown[],
  ctx: MemoryIngestionContext,
  existingKnowledge: { sops: VespaMemoryDocument[]; facts: VespaMemoryDocument[] },
): string {
  return `
## CONTEXT:
- Session ID: ${ctx.sessionId}
${ctx.userId ? `- User ID: ${ctx.userId}` : ''}
${ctx.repoUrl ? `- Repository: ${ctx.repoUrl}` : ''}
${ctx.commitId ? `- Commit: ${ctx.commitId}` : ''}
${ctx.ticketId ? `- Ticket: ${ctx.ticketId}` : ''}

${formatExistingKnowledge(existingKnowledge.sops, existingKnowledge.facts)}

## CONVERSATION CHUNK 1:
${JSON.stringify(chunk)}

Note:
- Always pass excludeSessionId="${ctx.sessionId}" when calling search-memory
- The \`search-memory\` tool returns ONLY approved knowledge from other sessions`;
}

/**
 * Build prompt for subsequent iterations
 */
function buildSubsequentIterationPrompt(
  chunk: unknown[],
  ctx: MemoryIngestionContext,
  previousSummary: string,
  previousSOPs: ExtractedSOP[],
  previousFacts: ExtractedFACT[],
  isFinal: boolean,
  chunkIndex: number,
): string {
  let previousKnowledge = '## PREVIOUSLY EXTRACTED KNOWLEDGE:\n\n';
  
  if (previousSOPs.length > 0) {
    previousKnowledge += `### SOPs (${previousSOPs.length}):\n`;
    previousSOPs.forEach((sop, i) => {
      previousKnowledge += `${i + 1}. "${JSON.stringify(sop)}"\n`;
    });
    previousKnowledge += '\n';
  }

  if (previousFacts.length > 0) {
    previousKnowledge += `### Facts (${previousFacts.length}):\n`;
    previousFacts.forEach((fact, i) => {
      previousKnowledge += `${i + 1}. "${JSON.stringify(fact)}"\n`;
    });
    previousKnowledge += '\n';
  }

  return `## CONTEXT:
- Session ID: ${ctx.sessionId}
${ctx.userId ? `- User ID: ${ctx.userId}` : ''}
${ctx.repoUrl ? `- Repository: ${ctx.repoUrl}` : ''}
${ctx.commitId ? `- Commit: ${ctx.commitId}` : ''}
${ctx.ticketId ? `- Ticket: ${ctx.ticketId}` : ''}

## PREVIOUS SUMMARY:
${previousSummary}

${previousKnowledge}

## CONVERSATION CHUNK ${chunkIndex}:
${JSON.stringify(chunk)}

---

## YOUR TASK:
Continue analyzing this conversation and update/refine the SOPs and Facts.
${isFinal ? 'This is the FINAL chunk - provide complete final knowledge.' : 'Include a summary field for the next iteration.'}
- Use the \`search-memory\` tool to learn from approved knowledge in OTHER sessions
- Always pass excludeSessionId="${ctx.sessionId}" when calling search-memory
- The \`search-memory\` tool returns ONLY approved knowledge from other sessions (not this session)`;
}

export class ConversationAnalysisService {
  /**
   * Analyze conversation in chunks with iterative refinement
   */
  async analyse(adapter: ConversationSourceAdapter): Promise<AnalysisResult> {
    const [items, ctx] = await Promise.all([
      adapter.getItems(),
      adapter.buildMemoryContext(),
    ]);

    const chunks = this.chunkArray(items);

    const { config: agentConfig, systemPrompt: rawSystemPrompt } = await agentService.getAgentConfigWithSystemPrompt(
      CONVERSATION_ANALYST_AGENT,
    );

    const systemPrompt = `${rawSystemPrompt}\n\n${OUTPUT_FORMAT_INSTRUCTION}`;
    
    // Enable search-memory tool
    const configWithSearchTool = {
      ...agentConfig,
      tools: {
        ...agentConfig.tools,
        enabled: [...(agentConfig.tools?.enabled ?? []), 'search-memory'],
      },
    };

    const agent = Agent.create(configWithSearchTool);

    let currentSOPs: ExtractedSOP[] = [];
    let currentFacts: ExtractedFACT[] = [];
    let currentSummary = '';

    // First iteration: fetch existing knowledge and analyze first chunk
    logger.info(`[ConversationAnalysisService] Starting analysis with ${chunks.length} chunks`);
    
    const existingKnowledge = await fetchExistingKnowledge(ctx.sessionId, ctx.repoUrl);
    logger.info(`[ConversationAnalysisService] Found ${existingKnowledge.sops.length} existing SOPs, ${existingKnowledge.facts.length} existing Facts`);

    const firstPrompt = buildFirstIterationPrompt(chunks[0], ctx, existingKnowledge);
    const firstResult = await agent.execute({
      messages: [createUserMessage(firstPrompt)],
      systemPrompt,
    });

    if (firstResult.status === 'error') {
      throw new Error(`[ConversationAnalysisService] Agent failed on chunk 1: ${firstResult.error}`);
    }

    const firstContent = this.extractContent(firstResult.messages);
    const firstAnalysis = this.parseResult(firstContent);
    currentSOPs = firstAnalysis.sops;
    currentFacts = firstAnalysis.facts;
    currentSummary = firstAnalysis.summary || '';

    logger.info(`[ConversationAnalysisService] Chunk 1/${chunks.length}: ${currentSOPs.length} SOPs, ${currentFacts.length} Facts`);

    // Subsequent iterations (if multiple chunks)
    for (let i = 1; i < chunks.length; i++) {
      const isFinal = i === chunks.length - 1;
      const prompt = buildSubsequentIterationPrompt(
        chunks[i],
        ctx,
        currentSummary,
        currentSOPs,
        currentFacts,
        isFinal,
        i + 1,
      );

      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
        systemPrompt,
      });

      if (result.status === 'error') {
        throw new Error(`[ConversationAnalysisService] Agent failed on chunk ${i + 1}: ${result.error}`);
      }

      const content = this.extractContent(result.messages);
      const analysis = this.parseResult(content);
      
      // Replace with updated knowledge
      currentSOPs = analysis.sops;
      currentFacts = analysis.facts;
      currentSummary = analysis.summary || '';

      logger.info(`[ConversationAnalysisService] Chunk ${i + 1}/${chunks.length}: ${currentSOPs.length} SOPs, ${currentFacts.length} Facts`);
    }

    // Enrich context fields from adapter
    const enrichedSOPs = currentSOPs.map(sop => ({
      ...sop,
      repoUrl: sop.repoUrl || ctx.repoUrl,
      commitId: sop.commitId || ctx.commitId,
      ticketId: sop.ticketId || ctx.ticketId,
    }));

    const enrichedFacts = currentFacts.map(fact => ({
      ...fact,
      repoUrl: fact.repoUrl || ctx.repoUrl,
      commitId: fact.commitId || ctx.commitId,
      ticketId: fact.ticketId || ctx.ticketId,
    }));

    logger.info(`[ConversationAnalysisService] Analysis complete: ${enrichedSOPs.length} SOPs, ${enrichedFacts.length} Facts`);

    return {
      sops: enrichedSOPs,
      facts: enrichedFacts,
    };
  }

  private chunkArray(items: unknown[]): unknown[][] {
    const chunks: unknown[][] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      chunks.push(items.slice(i, i + CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push([]);
    return chunks;
  }

  private extractContent(messages: readonly unknown[]): string {
    const last = [...messages].reverse().find((m): m is { type: string; content: string } => 
      typeof m === 'object' && m !== null && (m as any).type === 'assistant',
    );
    if (!last || !last.content) {
      throw new Error(`[ConversationAnalysisService] No content in agent response`);
    }
    return last.content;
  }

  private parseResult(content: string): AnalysisResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error(`[ConversationAnalysisService] No JSON found in agent response`);
      return { sops: [], facts: [] };
    }
    try {
      const raw = JSON.parse(jsonMatch[0]) as {
        sops?: ExtractedSOP[];
        facts?: ExtractedFACT[];
        summary?: string;
      };
      
      // Truncate summary if too long
      let summary = raw.summary;
      if (summary && summary.length > MAX_SUMMARY_LENGTH) {
        summary = summary.substring(0, MAX_SUMMARY_LENGTH) + '...';
      }

      return {
        sops: raw.sops ?? [],
        facts: raw.facts ?? [],
        summary,
      };
    } catch (err) {
      logger.error(`[ConversationAnalysisService] Failed to parse JSON:`, err);
      return { sops: [], facts: [] };
    }
  }
}

export const conversationAnalysisService = new ConversationAnalysisService();
