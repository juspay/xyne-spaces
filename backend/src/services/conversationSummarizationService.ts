import { LLMClient, UserMessage, createUserMessage } from '@framework';
import {logger} from '@/utils/logger';

/**
 * Progress stages for summarization operations
 */
export type SummarizationStage = 
  | 'starting' 
  | 'analyzing' 
  | 'chunking' 
  | 'summarizing' 
  | 'combining' 
  | 'complete';

/**
 * Progress information for summarization operations
 */
export interface SummarizationProgress {
  stage: SummarizationStage;
  message: string;
  progress: number; // 0-100
  currentChunk?: number;
  totalChunks?: number;
}

/**
 * Context type for different summarization scenarios
 */
export type SummarizationContextType = 
  | 'general' 
  | 'search' 
  | 'bot' 
  | 'user' 
  | 'custom';

/**
 * Summarization context configuration
 */
export interface SummarizationContext {
  type: SummarizationContextType;
  customPrompt?: string;
}

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  enabled: boolean;
  chunkSize?: number; // Max tokens per chunk
  maxChunks?: number; // Maximum number of chunks to process
}

/**
 * Options for summarization operations
 */
export interface SummarizationOptions {
  messages: string[]; // Array of message strings to summarize
  context?: SummarizationContext; // Optional context for custom prompts
  chunkingConfig?: ChunkingConfig; // Optional chunking configuration
  onProgress?: (progress: SummarizationProgress) => void; // Progress callback
  signal?: AbortSignal; // For cancellation support
}

/**
 * Result of a summarization operation
 */
export interface SummarizationResult {
  summary: string; // The generated summary
  originalMessageCount: number; // How many messages were summarized
  chunksProcessed?: number; // Number of chunks processed
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number; // Optional cost tracking
  metadata?: Record<string, unknown>; // Additional metadata
}

/**
 * Model limits configuration
 */
export interface ModelLimits {
  contextWindow: number; // Total model capacity
  maxOutputTokens: number; // Reserve for LLM response
  safetyMargin: number; // Use percentage of limit (e.g., 0.85 = 85%)
}

/**
 * Generic conversation summarization service
 * 
 * This service provides intelligent summarization of conversations with support for:
 * - Chunking for long conversations that exceed token limits
 * - Progressive summarization (chunk summaries → final summary)
 * - Multiple context types (general, search agent, bot, user, custom)
 * - Progress tracking with real-time callbacks
 * - Token counting and cost tracking
 * - Cancellation support via AbortSignal
 * 
 * @example
 * ```typescript
 * const service = new ConversationSummarizationService(llmClient, {
 *   defaultChunkSize: 55500,
 *   modelLimits: {
 *     contextWindow: 200000,
 *     maxOutputTokens: 4000,
 *     safetyMargin: 0.85
 *   }
 * });
 * 
 * const result = await service.summarize({
 *   messages: ['message 1', 'message 2', ...],
 *   context: { type: 'bot' },
 *   chunkingConfig: { enabled: true },
 *   onProgress: (progress) => logger.info(progress)
 * });
 * ```
 */
export class ConversationSummarizationService {
  private readonly defaultChunkSize: number;
  private readonly defaultModel: string;

  /**
   * Create a new ConversationSummarizationService
   * 
   * @param llmClient - The LLM client to use for summarization
   * @param config - Optional configuration for chunk sizes and model limits
   */
  constructor(
    private readonly llmClient: LLMClient,
    config?: {
      defaultChunkSize?: number;
      modelLimits?: ModelLimits;
      defaultModel?: string;
    }
  ) {
    this.defaultChunkSize = config?.defaultChunkSize || 55500;
    this.defaultModel = config?.defaultModel || 'glm-46-fp8';
  }

  /**
   * Summarize messages with optional chunking and progress tracking
   * 
   * @param options - Summarization options
   * @returns Summarization result with summary text and metadata
   */
  async summarize(options: SummarizationOptions): Promise<SummarizationResult> {
    const { 
      messages, 
      context = { type: 'general' }, 
      chunkingConfig = { enabled: false },
      onProgress,
      signal 
    } = options;

    if (messages.length === 0) {
      throw new Error('No messages to summarize');
    }

    logger.info(`[SummarizationService] Starting summarization for ${messages.length} messages`);
    
    // Check for cancellation
    this.checkCancellation(signal);

    onProgress?.({
      stage: 'starting',
      message: 'Starting summarization...',
      progress: 0
    });

    try {
      onProgress?.({
        stage: 'analyzing',
        message: 'Analyzing message content...',
        progress: 10
      });

      // Estimate total tokens
      const totalText = messages.join('\n\n');
      const totalTokens = this.estimateTokens(totalText);
      logger.info(`[SummarizationService] Total estimated tokens: ${totalTokens}`);

      // Determine chunking size
      const chunkSize = chunkingConfig.chunkSize || this.defaultChunkSize;
      const needsChunking = chunkingConfig.enabled && totalTokens > chunkSize;

      let summary: string;
      let chunksProcessed = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      if (needsChunking) {
        logger.info(`[SummarizationService] Messages exceed chunk size, using chunked summarization`);
        
        onProgress?.({
          stage: 'chunking',
          message: 'Splitting messages into chunks...',
          progress: 20
        });

        // Chunk and progressively summarize
        const result = await this.chunkAndSummarize(
          messages,
          chunkSize,
          context,
          chunkingConfig.maxChunks,
          onProgress,
          signal
        );

        summary = result.summary;
        chunksProcessed = result.chunksProcessed;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } else {
        logger.info(`[SummarizationService] Messages within size limit, summarizing all at once`);
        
        onProgress?.({
          stage: 'summarizing',
          message: 'Generating summary...',
          progress: 50
        });

        // Summarize all messages at once
        const result = await this.summarizeChunk(messages, context, signal);
        summary = result.summary;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      }

      this.checkCancellation(signal);

      onProgress?.({
        stage: 'complete',
        message: 'Summarization complete',
        progress: 100
      });

      logger.info(`[SummarizationService] Summarization completed successfully`);

      return {
        summary,
        originalMessageCount: messages.length,
        chunksProcessed: chunksProcessed > 0 ? chunksProcessed : undefined,
        tokensUsed: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens
        },
        metadata: {
          chunkingUsed: needsChunking,
          contextType: context.type
        }
      };

    } catch (error) {
      if (signal?.aborted) {
        logger.info(`[SummarizationService] Summarization cancelled`);
        throw new Error('Summarization cancelled');
      }
      
      logger.error(`[SummarizationService] Summarization failed:`, error);
      throw error;
    }
  }

  /**
   * Chunk messages and progressively summarize them
   */
  private async chunkAndSummarize(
    messages: string[],
    chunkSize: number,
    context: SummarizationContext,
    maxChunks: number | undefined,
    onProgress: ((progress: SummarizationProgress) => void) | undefined,
    signal: AbortSignal | undefined
  ): Promise<{ summary: string; chunksProcessed: number; inputTokens: number; outputTokens: number }> {
    // Split into chunks
    const chunks = this.chunkMessages(messages, chunkSize);
    const totalChunks = maxChunks ? Math.min(chunks.length, maxChunks) : chunks.length;
    
    logger.info(`[SummarizationService] Created ${totalChunks} chunks (max: ${maxChunks || 'unlimited'})`);

    // Summarize each chunk
    const chunkSummaries: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < totalChunks; i++) {
      this.checkCancellation(signal);

      const chunkProgress = 30 + Math.floor((i / totalChunks) * 40); // Progress from 30% to 70%
      
      onProgress?.({
        stage: 'summarizing',
        message: `Summarizing chunk ${i + 1} of ${totalChunks}...`,
        progress: chunkProgress,
        currentChunk: i + 1,
        totalChunks
      });

      logger.info(`[SummarizationService] Summarizing chunk ${i + 1}/${totalChunks} (${chunks[i].length} messages)`);
      
      const result = await this.summarizeChunk(chunks[i], context, signal);
      chunkSummaries.push(result.summary);
      totalInputTokens += result.inputTokens;
      totalOutputTokens += result.outputTokens;
    }

    // If we have multiple summaries, combine them
    let finalSummary: string;
    if (chunkSummaries.length > 1) {
      this.checkCancellation(signal);

      onProgress?.({
        stage: 'combining',
        message: 'Combining chunk summaries...',
        progress: 80
      });

      logger.info(`[SummarizationService] Combining ${chunkSummaries.length} chunk summaries`);
      
      const combineResult = await this.combineSummaries(chunkSummaries, context, signal);
      finalSummary = combineResult.summary;
      totalInputTokens += combineResult.inputTokens;
      totalOutputTokens += combineResult.outputTokens;
    } else {
      finalSummary = chunkSummaries[0];
    }

    return {
      summary: finalSummary,
      chunksProcessed: totalChunks,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };
  }

  /**
   * Summarize a single chunk of messages
   */
  private async summarizeChunk(
    messages: string[],
    context: SummarizationContext,
    signal?: AbortSignal
  ): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
    this.checkCancellation(signal);

    const formattedMessages = messages.join('\n\n');
    const prompt = this.createPrompt(context, formattedMessages);

    const llmMessages: UserMessage[] = [createUserMessage(prompt)];

    try {
      const response = await this.llmClient.generate({
        model: this.defaultModel,
        messages: llmMessages,
      });

      const summary = response.content || 'Could not generate summary.';
      
      // Estimate tokens (since we don't have actual usage data from all providers)
      const inputTokens = this.estimateTokens(prompt);
      const outputTokens = this.estimateTokens(summary);

      return { summary, inputTokens, outputTokens };
    } catch (error) {
      logger.error(`[SummarizationService] Error summarizing chunk:`, error);
      throw new Error(`Failed to summarize chunk: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Combine multiple chunk summaries into a final summary
   */
  private async combineSummaries(
    summaries: string[],
    context: SummarizationContext,
    signal?: AbortSignal
  ): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
    this.checkCancellation(signal);

    const combinedText = summaries
      .map((summary, index) => `Part ${index + 1}:\n${summary}`)
      .join('\n\n');

    const prompt = `Please combine the following ${context.type} summaries into a single coherent summary:

${combinedText}

Provide a comprehensive but concise final summary:`;

    const llmMessages: UserMessage[] = [createUserMessage(prompt)];

    try {
      const response = await this.llmClient.generate({
        model: this.defaultModel,
        messages: llmMessages,
      });

      const summary = response.content || summaries.join('\n\n');
      
      const inputTokens = this.estimateTokens(prompt);
      const outputTokens = this.estimateTokens(summary);

      return { summary, inputTokens, outputTokens };
    } catch (error) {
      logger.error(`[SummarizationService] Error combining summaries:`, error);
      // Fallback: return concatenated summaries
      return {
        summary: summaries.join('\n\n'),
        inputTokens: this.estimateTokens(prompt),
        outputTokens: this.estimateTokens(summaries.join('\n\n'))
      };
    }
  }

  /**
   * Split messages into chunks based on token limits
   * If a single message is too large, it will be split into smaller pieces
   */
  private chunkMessages(messages: string[], maxTokensPerChunk: number): string[][] {
    const chunks: string[][] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const message of messages) {
      const messageTokens = this.estimateTokens(message);
      
      // If this single message exceeds chunk size, split it
      if (messageTokens > maxTokensPerChunk) {
        logger.info(`[SummarizationService] Message exceeds chunk size (${messageTokens} > ${maxTokensPerChunk}), splitting...`);
        
        // Save current chunk if it has content
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentTokens = 0;
        }
        
        // Split the large message into smaller pieces
        const messagePieces = this.splitLargeMessage(message, maxTokensPerChunk);
        logger.info(`[SummarizationService] Split large message into ${messagePieces.length} pieces`);
        
        // Add each piece as a separate chunk
        for (const piece of messagePieces) {
          chunks.push([piece]);
        }
        
        continue;
      }
      
      // If adding this message would exceed chunk size, start a new chunk
      if (currentTokens + messageTokens > maxTokensPerChunk && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      
      currentChunk.push(message);
      currentTokens += messageTokens;
    }
    
    // Add the last chunk if it has messages
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  /**
   * Split a large message into smaller pieces based on token limit
   * Tries to split on paragraph boundaries first, then sentence boundaries, then character count
   */
  private splitLargeMessage(message: string, maxTokensPerPiece: number): string[] {
    const pieces: string[] = [];
    
    // First try to split by paragraphs (double newlines)
    const paragraphs = message.split(/\n\n+/);
    
    let currentPiece = '';
    let currentTokens = 0;
    
    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);
      
      // If a single paragraph is too large, split it by sentences
      if (paragraphTokens > maxTokensPerPiece) {
        // Save current piece if it has content
        if (currentPiece) {
          pieces.push(currentPiece.trim());
          currentPiece = '';
          currentTokens = 0;
        }
        
        // Split paragraph by sentences
        const sentences = this.splitBySentences(paragraph, maxTokensPerPiece);
        pieces.push(...sentences);
        continue;
      }
      
      // Check if adding this paragraph would exceed limit
      if (currentTokens + paragraphTokens > maxTokensPerPiece && currentPiece) {
        pieces.push(currentPiece.trim());
        currentPiece = paragraph;
        currentTokens = paragraphTokens;
      } else {
        currentPiece += (currentPiece ? '\n\n' : '') + paragraph;
        currentTokens += paragraphTokens;
      }
    }
    
    // Add remaining content
    if (currentPiece) {
      pieces.push(currentPiece.trim());
    }
    
    return pieces;
  }

  /**
   * Split text by sentences when paragraphs are too large
   */
  private splitBySentences(text: string, maxTokensPerPiece: number): string[] {
    const pieces: string[] = [];
    
    // Split by sentence boundaries (., !, ?, followed by space or newline)
    const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
    
    let currentPiece = '';
    let currentTokens = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);
      
      // If a single sentence is still too large, split by character count
      if (sentenceTokens > maxTokensPerPiece) {
        // Save current piece if it has content
        if (currentPiece) {
          pieces.push(currentPiece.trim());
          currentPiece = '';
          currentTokens = 0;
        }
        
        // Split by character count as last resort
        const charPieces = this.splitByCharCount(sentence, maxTokensPerPiece);
        pieces.push(...charPieces);
        continue;
      }
      
      // Check if adding this sentence would exceed limit
      if (currentTokens + sentenceTokens > maxTokensPerPiece && currentPiece) {
        pieces.push(currentPiece.trim());
        currentPiece = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentPiece += (currentPiece ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }
    
    // Add remaining content
    if (currentPiece) {
      pieces.push(currentPiece.trim());
    }
    
    return pieces;
  }

  /**
   * Split text by character count as a last resort
   */
  private splitByCharCount(text: string, maxTokensPerPiece: number): string[] {
    const pieces: string[] = [];
    const maxChars = maxTokensPerPiece * 4; // 4 chars ≈ 1 token
    
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push(text.substring(i, i + maxChars));
    }
    
    return pieces;
  }

  /**
   * Estimate token count from text (4 characters ≈ 1 token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Create appropriate prompt based on context type
   */
  private createPrompt(context: SummarizationContext, messages: string): string {
    if (context.customPrompt) {
      return context.customPrompt.replace('{messages}', messages);
    }

    switch (context.type) {
      case 'bot':
        return this.createBotMessagePrompt(messages);
      case 'user':
        return this.createUserMessagePrompt(messages);
      case 'search':
        return this.createSearchAgentPrompt(messages);
      case 'general':
      default:
        return this.createGeneralPrompt(messages);
    }
  }

  /**
   * Create prompt for bot message summarization
   */
  private createBotMessagePrompt(messages: string): string {
    return `Please summarize the following bot responses from a conversation. Focus on highlighting:
- Key actions taken by the bot
- Important results or outputs
- Any errors or issues encountered
- Relevant information for understanding what the bot did

Bot messages:
${messages}

Provide a concise but informative summary:`;
  }

  /**
   * Create prompt for user message summarization
   */
  private createUserMessagePrompt(messages: string): string {
    return `Please summarize the following user messages from a conversation:

User messages:
${messages}

Provide a concise summary capturing the key points:`;
  }

  /**
   * Create prompt for search agent summarization (prevents re-exploration)
   */
  private createSearchAgentPrompt(messages: string): string {
    return `Your task is to create a comprehensive search summary that prevents RE-EXPLORATION of already analyzed code and enables efficient continuation of deep codebase investigation.

CRITICAL: This is a SEARCH AGENT performing systematic codebase analysis. The summary will replace the entire conversation history, so it MUST contain ALL discovered information to avoid redundant searches.

MANDATORY SECTIONS - Include ALL of these:

## 1. COMPLETED EXPLORATIONS (CRITICAL - Prevents Re-searching)
List EVERY file, directory, and code location that has been fully analyzed:
- **Fully Analyzed Files**: Complete file paths with summary of findings
- **Searched Directories**: Directory paths explored and what was found
- **Investigated Functions/Classes**: Specific code entities examined
- **Explored Code Patterns**: Architectural patterns already documented

## 2. KEY FINDINGS & INSIGHTS  
Document what was discovered to avoid losing context:
- **Technical Architecture**: System design patterns, frameworks, technologies identified
- **Code Relationships**: Dependencies, imports, inheritance chains, communication patterns
- **Implementation Details**: How key features are implemented, algorithms used, data flow
- **Important Code Snippets**: Critical code examples that demonstrate patterns or solutions

## 3. SEARCH METHODOLOGY & TOOLS USED
- **Search Strategies**: What approaches were used
- **Tools Employed**: Which search tools were used and their effectiveness
- **Query Patterns**: Successful search terms and patterns that yielded results

## 4. CURRENT INVESTIGATION STATUS
- **Original Search Goal**: What the search was trying to accomplish
- **Progress Assessment**: How much of the goal has been achieved
- **Current Focus**: What aspect is currently being investigated
- **Partial Discoveries**: Incomplete findings that need follow-up

## 5. NEXT SEARCH TARGETS (Prevents Redundant Work)
Be extremely specific about what remains to be explored:
- **Specific Files to Investigate**: Exact file paths not yet examined
- **Directories to Explore**: Unvisited directory paths
- **Code Patterns to Find**: Specific patterns, functions, or implementations to locate
- **Search Queries to Try**: Suggested search terms or strategies for continuation

## 6. AVOID RE-SEARCHING (Critical for Efficiency)
Explicitly state what should NOT be searched again:
- "DO NOT re-examine: [list specific files, directories, patterns]"
- "Already confirmed absent: [list things searched for but not found]"
- "Fully documented: [list completed investigation areas]"

Conversation:
${messages}`;
  }

  /**
   * Create general conversation summarization prompt (comprehensive)
   */
  private createGeneralPrompt(messages: string): string {
    return `Your task is to create a concise but comprehensive summary of this conversation. This summary will be used as context for ticket creation and future reference, so capture all important information clearly.

What you should include in the summary:

1. **Main Topic/Issue**: What is the primary subject or problem being discussed?

2. **User Requests**: What did the user explicitly ask for or request?

3. **Key Discussion Points**: What important topics, decisions, or technical details were discussed?

4. **Actions Taken**: What actions were performed during the conversation (by bots or users)?
   - Commands executed
   - Configurations changed
   - Files created or modified
   - Searches performed

5. **Important Technical Details**: List any specific technical information that's relevant:
   - Technology stack mentioned
   - Error messages encountered
   - Code snippets or configurations
   - URLs or file paths referenced

6. **Problems & Solutions**: Document any problems encountered and their solutions

7. **Current Status**: What is the current state? Is something:
   - Completed
   - In progress
   - Blocked/waiting on something
   - Needs follow-up

8. **Next Steps** (if applicable): What should happen next based on this conversation?

**Important:** 
- Keep the summary focused and actionable
- Use bullet points for clarity
- Include specific details (file names, error messages, URLs, etc.)
- Avoid generic statements - be specific
- This is text-only, no markdown formatting needed

Conversation:
${messages}`;
  }

  /**
   * Check if operation was cancelled
   */
  private checkCancellation(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }
  }
}
