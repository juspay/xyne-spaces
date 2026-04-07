import { Agent } from 'agentic-framework';
import { createUserMessage } from '@framework';
import { agentService } from './agentService';
import { logger } from '@/utils/logger';
import type { AnalysisResult, ExtractedFACT, ExtractedSOP } from './conversationAnalysisService';

// Re-export types for convenience
export type { AnalysisResult, ExtractedFACT, ExtractedSOP };

const DOCUMENT_ANALYST_AGENT = 'conversation-analyst';

const OUTPUT_FORMAT_INSTRUCTION = `
RESPOND WITH ONLY VALID JSON (no markdown, no explanation):

{
  "sops": [
    {
      "userQuery": "clear search query describing what this SOP addresses",
      "content": "complete SOP text with all procedural steps, file paths, commands, exact details. This should be in md format with proper formatting",
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
      "content": "complete fact content with verbatim details - NO summarization. This should be in md format with proper formatting",
      "tags": ["keyword1"],
      "filePointers": ["relative/path/file.ts"],
      "repoUrl": "",
      "commitId": "",
      "ticketId": ""
    }
  ]
}

FIELD RULES:
- userQuery: Describes the topic for future search retrieval (e.g., "How to deploy auth service")
- content: Include ALL details verbatim (exact paths, commands, code snippets, error messages)
- tags: Single-word keywords for categorization
- filePointers: Relative file paths mentioned in the document
- Do NOT include trial-and-error in SOPs
- Facts should preserve verbatim detail - do not lose information by summarizing
- If the document is a pure SOP, put everything in sops and leave facts empty
- If the document is pure facts/reference, put everything in facts and leave sops empty
- A document can have both SOPs and facts
`;

/**
 * Build the single prompt for analysing an entire document at once.
 */
function buildDocumentPrompt(
  content: string,
  filename: string,
  userId: string,
  sessionId: string,
): string {
  return `## DOCUMENT METADATA:
- Filename: ${filename}
- Session ID: ${sessionId}
- User ID: ${userId}

## YOUR TASK:
Analyse the document below. It is either a Standard Operating Procedure (SOP), a collection of facts/reference material, or a mix of both.
Extract all SOPs and facts from it. Preserve all details verbatim — do not summarise or lose information.

## DOCUMENT CONTENT:
${content}`;
}

export class DocumentAnalysisService {
  /**
   * Analyse an entire document in a single agent.execute() call.
   * No chunking — the full file content is sent at once.
   */
  async analyseDocument(
    content: string,
    filename: string,
    userId: string,
    sessionId: string,
  ): Promise<AnalysisResult> {
    logger.info(`[DocumentAnalysisService] Starting analysis for file=${filename} sessionId=${sessionId}`);

    const { config: agentConfig, systemPrompt: rawSystemPrompt } =
      await agentService.getAgentConfigWithSystemPrompt(DOCUMENT_ANALYST_AGENT);

    const systemPrompt = `${rawSystemPrompt}\n\n${OUTPUT_FORMAT_INSTRUCTION}`;

    const agent = Agent.create(agentConfig);

    const prompt = buildDocumentPrompt(content, filename, userId, sessionId);

    const result = await agent.execute({
      messages: [createUserMessage(prompt)],
      systemPrompt,
    });

    if (result.status === 'error') {
      throw new Error(`[DocumentAnalysisService] Agent failed for file=${filename}: ${result.error}`);
    }

    const responseContent = this.extractContent(result.messages);
    const analysis = this.parseResult(responseContent);

    logger.info(
      `[DocumentAnalysisService] Analysis complete for file=${filename}: ${analysis.sops.length} SOPs, ${analysis.facts.length} Facts`,
    );

    return analysis;
  }

  private extractContent(messages: readonly unknown[]): string {
    const last = [...messages].reverse().find(
      (m): m is { type: string; content: string } =>
        typeof m === 'object' && m !== null && (m as any).type === 'assistant',
    );
    if (!last || !last.content) {
      throw new Error('[DocumentAnalysisService] No content in agent response');
    }
    return last.content;
  }

  private parseResult(content: string): AnalysisResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('[DocumentAnalysisService] No JSON found in agent response');
      return { sops: [], facts: [] };
    }
    try {
      const raw = JSON.parse(jsonMatch[0]) as {
        sops?: ExtractedSOP[];
        facts?: ExtractedFACT[];
      };
      return {
        sops: raw.sops ?? [],
        facts: raw.facts ?? [],
      };
    } catch (err) {
      logger.error('[DocumentAnalysisService] Failed to parse JSON:', err);
      return { sops: [], facts: [] };
    }
  }
}

export const documentAnalysisService = new DocumentAnalysisService();
