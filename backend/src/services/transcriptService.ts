import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { AttachmentEntityType } from '@prisma/client';
import { config } from '@/config/env';
import { Storage, Bucket } from '@google-cloud/storage';
import { Agent, createUserMessage, createSystemMessage } from '@framework';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType } from '@xyne/shared';
import { db } from '@/database/client';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';

interface TranscriptEntry {
  user: string;
  text: string;
  timestamp: number;
  participant_identity: string;
}

// Consolidation gap: if same speaker speaks within this gap, merge into single entry
const TRANSCRIPT_CONSOLIDATION_GAP_SECONDS = 30;

// AI Summary prompt for call transcripts - Markdown format
const CALL_SUMMARY_PROMPT = `
You are generating a call summary for a professional collaboration product.

CRITICAL RULES:
- Output ONLY valid Markdown
- Do NOT include explanations, reasoning, or analysis
- Do NOT mention the transcript
- Do NOT judge or label user behavior
- Use neutral, professional language
- This will be rendered directly in the UI

MARKDOWN TEMPLATE (FOLLOW EXACTLY):

## Summary:
[2-3 sentence overview of the call]

## Key outcomes:
1. [First key outcome or decision]
2. [Second key outcome or decision]
3. [Third key outcome or decision if applicable]

## Action Items:
- [Action item 1] or "None"
- [Action item 2 if applicable]

## Participants:
- [Participant 1 name]
- [Participant 2 name]

Only output the Markdown above.
No extra text.

TRANSCRIPT:
{transcript}
`;

// AI Title prompt for call transcripts - Concise, 50 char max
const CALL_TITLE_PROMPT = `
You are generating a concise title for a call based on its transcript.

CRITICAL RULES:
- Output ONLY the title text (no quotes, no explanations)
- Maximum 50 characters
- Use title case (capitalize first letter of main words)
- Be specific and descriptive
- Focus on the main topic or outcome

Examples:
- "Project Roadmap Discussion"
- "Q1 Sales Review"
- "Bug Fix Planning"
- "Client Onboarding Call"
- "Sprint Planning Session"

Generate a title for this call:
{transcript}
`;

// AI Ticket Suggestions prompt - analyzes transcript for actionable work items
const TICKET_SUGGESTIONS_PROMPT = `
You are analyzing a call transcript to identify actionable work items that should be tracked as tickets.

CRITICAL RULES:
- Output ONLY valid JSON
- Generate 1-10 actionable ticket suggestions based on the call content
- Each suggestion must be a concrete task mentioned or implied in the call
- Extract assignee names ONLY if explicitly mentioned in the transcript (e.g., "John will handle this")
- Use "unassigned" if no specific person is mentioned
- Prioritize based on urgency indicators in the call
- Keep titles concise and action-oriented (5-10 words)
- Keep descriptions clear and context-rich (2-3 sentences)

JSON STRUCTURE (FOLLOW EXACTLY):
{
  "suggestions": [
    {
      "title": "[Action-oriented title]",
      "description": "[Detailed description with context from the call]",
      "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "suggestedAssignee": "[Name from transcript]" or "unassigned"
    }
  ]
}

Only output valid JSON.
No explanations.

TRANSCRIPT:
{transcript}

SUMMARY:
{summary}
`;

export interface TicketSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAssignee: string;
  status: 'pending' | 'created' | 'dismissed';
  createdTicketId?: string;
}

export class TranscriptService {
  private transcriptBucket: Bucket;
  private storage: Storage;
  private summaryAgent: Agent | null = null;
  private titleAgent: Agent | null = null;
  private ticketAgent: Agent | null = null;

  constructor() {
    // Initialize dedicated GCS storage for transcripts
    const isDevelopment = process.env.NODE_ENV === 'development';
    const storageOptions: any = {
      projectId: config.gcs.projectId,
    };

    if (isDevelopment && config.gcs.fakeGcsHost) {
      storageOptions.apiEndpoint = `http://${config.gcs.fakeGcsHost}`;
    }

    this.storage = new Storage(storageOptions);
    this.transcriptBucket = this.storage.bucket(config.gcs.transcriptionBucketName);
    logger.info(
      `TranscriptService initialized with transcript bucket: ${config.gcs.transcriptionBucketName}`
    );

    // Initialize separate agents for parallel execution
    this.initializeAgents();
  }

  /**
   * Initialize three separate agents for parallel AI generation
   */
  private initializeAgents(): void {
    try {
      const apiKey = config.llm.litellmApiKey;
      const baseUrl = config.llm.litellmBaseUrl;

      if (!apiKey || !baseUrl) {
        logger.warn('LiteLLM credentials not configured. AI features will be disabled.');
        return;
      }

      const agentConfig = {
        model: {
          provider: {
            type: 'litellm' as const,
            config: {
              apiKey,
              baseUrl,
              timeout: 120000,
            },
          },
          defaultModel: config.llm.litellmModel || 'glm-latest',
        },
        tools: {
          enabled: [],
          config: {},
          execution: { timeout: 120000 },
        },
        execution: {
          maxTurns: 1,
          mode: 'single' as const,
          timeouts: { llm: 120000 },
          limits: {},
          errorHandling: {},
        },
        events: {
          logging: 'error' as const,
        },
      };

      // Create three independent agents for parallel execution
      this.summaryAgent = Agent.create(agentConfig);
      this.titleAgent = Agent.create(agentConfig);
      this.ticketAgent = Agent.create(agentConfig);

      logger.info(`Initialized 3 AI agents for parallel execution (model: ${config.llm.litellmModel || 'glm-latest'})`);
    } catch (error) {
      logger.error('Failed to initialize AI agents:', error);
    }
  }

  /**
   * Main entry point - attach transcript to existing call message when call ends
   * @param callId - The external call ID
   * @param messageId - The message ID of the call message from frontend
   */
  async postCallTranscript(callId: string, messageId: string): Promise<void> {
    try {
      logger.info(`Starting transcript processing for call: ${callId}, message: ${messageId}`);

      // 0. Check if transcript attachment already exists to avoid redundant processing
      const transcriptAttachment =
        await repositories.messageAttachments.findTranscriptByMessageId(messageId);

      if (transcriptAttachment) {
        logger.warn(
          `Transcript for message ${messageId} already exists. Skipping redundant processing.`
        );
        return;
      }

      // 1. Get call details
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`Call not found: ${callId}`);
        return;
      }

      // Note: Status check removed - webhook only fires when room disconnects,
      // which means all users have left (agent is always the last to leave)

      // 2. Get the call message to retrieve conversationId
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.warn(
          `Call system message not found for messageId ${messageId} - skipping transcript`
        );
        return;
      }

      // 3. Retrieve transcript from GCS or local file
      const transcriptContent = await this.retrieveTranscript(callId);

      if (!transcriptContent) {
        logger.error(`Transcript file not found for call: ${callId}`);
        throw new Error(`Transcript file not found for call: ${callId}`);
      }

      // 4. Parse JSONL entries
      const entries = this.parseTranscriptEntries(transcriptContent);
      if (entries.length === 0) {
        logger.error(`No valid transcript entries found for call: ${callId}`);
        throw new Error(`No valid transcript entries found for call: ${callId}`);
      }

      // 5. Format as plain text (usernames are already included in transcript entries)
      const formattedTranscript = this.formatTranscript(entries);

      // 6. Post-process transcript: translate to English
      const processedTranscript = await this.postProcessTranscript(formattedTranscript);

      // 7. Upload processed transcript to GCS as .txt file
      const txtGcsPath = await this.uploadFormattedTranscript(callId, processedTranscript);

      // 8. Keep the original JSONL file for debugging/archival purposes
      // Note: Not deleting the JSONL file as it may be useful for troubleshooting
      logger.info(`Keeping original JSONL file: transcriptions/${callId}.jsonl`);

      // 9. Build GCS URL using transcript bucket
      const gcsUrl = `gs://${config.gcs.transcriptionBucketName}/${txtGcsPath}`;

      // 10. Calculate metadata
      const firstTimestamp = entries[0].timestamp;
      const lastTimestamp = entries[entries.length - 1].timestamp;
      const durationSeconds = Math.round(lastTimestamp - firstTimestamp);
      const uniqueParticipants = Array.from(new Set(entries.map((e) => e.user))).filter(Boolean);

      // 11. Create attachment linked to the existing call message
      await repositories.messageAttachments.create({
        entityId: messageId,
        entityType: AttachmentEntityType.CHAT,
        originalFilename: `call_transcript.txt`,
        size: processedTranscript.length,
        mimetype: 'text/plain',
        url: gcsUrl,
        uploadedByUserId: call.createdByUserId,
        createdBy: call.createdByUserId,
        storageProvider: 'gcs',
        conversationId: callMessage.conversationId,
        metadata: {
          callId,
          type: 'transcript',
          duration: durationSeconds,
          participantCount: uniqueParticipants.length,
        },
      });

      // 12. Save transcript URL to Call record for easier access (used by recordings feature)
      await repositories.calls.update(call.id, {
        transcript: gcsUrl,
      });

      // 13. Update the call message to indicate it has an attachment
      await repositories.messages.update(messageId, {
        hasAttachment: true,
      });

      logger.info(`Successfully attached processed transcript to call message: ${messageId}`);
    } catch (error) {
      logger.error(`Failed to process transcript for call ${callId}:`, error);
      // Throw error to allow controller to return proper error response
      throw error;
    }
  }

  /**
   * Retrieve transcript from dedicated transcript GCS bucket
   * Returns raw JSONL content or null if not found
   */
  private async retrieveTranscript(callId: string): Promise<string | null> {
    try {
      const gcsPath = `transcriptions/${callId}.jsonl`;
      logger.info(
        `Attempting to fetch transcript from transcript bucket ${config.gcs.transcriptionBucketName}: ${gcsPath}`
      );

      // Use dedicated transcript bucket
      const file = this.transcriptBucket.file(gcsPath);
      const [exists] = await file.exists();

      if (!exists) {
        logger.error(
          `Transcript file not found in bucket: gs://${config.gcs.transcriptionBucketName}/${gcsPath}`
        );
        throw new Error(
          `Transcript file not found in bucket: gs://${config.gcs.transcriptionBucketName}/${gcsPath}`
        );
      }

      const [buffer] = await file.download();
      logger.info(`Successfully fetched transcript from transcript bucket for call: ${callId}`);
      return buffer.toString('utf-8');
    } catch (error) {
      logger.error(`Failed to fetch transcript from transcript bucket for ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Parse JSONL content into transcript entries
   */
  private parseTranscriptEntries(jsonlContent: string): TranscriptEntry[] {
    const lines = jsonlContent
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    const entries: TranscriptEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry;
        entries.push(entry);
      } catch (error) {
        logger.warn(`Skipping malformed JSONL line:`, error);
      }
    }

    return entries;
  }

  /**
   * Consolidate transcript entries by merging consecutive entries from the same speaker
   * when they occur within TRANSCRIPT_CONSOLIDATION_GAP_SECONDS of each other.
   * Speaker changes always create a new entry.
   */
  private consolidateEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
    if (entries.length === 0) {
      return [];
    }

    const consolidated: TranscriptEntry[] = [];
    let currentEntry: TranscriptEntry = { ...entries[0] };

    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i];
      const timeSinceLastEntry = entry.timestamp - currentEntry.timestamp;
      const sameUser = entry.user === currentEntry.user;

      // Merge if same speaker and within the consolidation gap
      if (sameUser && timeSinceLastEntry <= TRANSCRIPT_CONSOLIDATION_GAP_SECONDS) {
        // Append text to current entry (with space separator)
        currentEntry.text = `${currentEntry.text} ${entry.text}`.trim();
        // Keep the original timestamp (first entry's timestamp)
      } else {
        // Different speaker or gap too large - save current and start new
        consolidated.push(currentEntry);
        currentEntry = { ...entry };
      }
    }

    // Don't forget the last entry
    consolidated.push(currentEntry);

    logger.info(
      `Consolidated ${entries.length} transcript entries into ${consolidated.length} entries`
    );
    return consolidated;
  }

  /**
   * Format transcript entries into plain text
   */
  private formatTranscript(entries: TranscriptEntry[]): string {
    if (entries.length === 0) {
      return 'No transcript available.';
    }

    // Consolidate consecutive entries from same speaker within 30s gap
    const consolidatedEntries = this.consolidateEntries(entries);

    const firstTimestamp = consolidatedEntries[0].timestamp;
    let formatted = '';

    consolidatedEntries.forEach((entry) => {
      const time = this.formatTimestamp(entry.timestamp - firstTimestamp);
      const speaker = entry.user || 'Unknown';
      const text = entry.text || '';
      formatted += `[${time}] ${speaker}: ${text}\n`;
    });

    return formatted;
  }

  /**
   * Upload formatted transcript to transcript GCS bucket as .txt file
   * Returns GCS path
   */
  private async uploadFormattedTranscript(callId: string, content: string): Promise<string> {
    const filepath = `attachments/${callId}_formatted.txt`;
    const buffer = Buffer.from(content, 'utf-8');

    logger.info(`Uploading formatted transcript to transcript bucket: ${filepath}`);

    // Use dedicated transcript bucket
    const file = this.transcriptBucket.file(filepath);

    await file.save(buffer, {
      contentType: 'text/plain',
      metadata: {
        callId,
        type: 'transcript',
      },
    });

    logger.info(`Successfully uploaded formatted transcript to transcript bucket: ${filepath}`);
    return filepath;
  }

  /**
   * Format timestamp (seconds from start) to MM:SS or HH:MM:SS
   */
  private formatTimestamp(secondsFromStart: number): string {
    const hours = Math.floor(secondsFromStart / 3600);
    const minutes = Math.floor((secondsFromStart % 3600) / 60);
    const seconds = Math.floor(secondsFromStart % 60);

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }

  /**
   * Get formatted transcript content for a call
   * Used by recordings feature to display transcript in detail view
   * @param callId - The external call ID
   * @returns Formatted transcript text or null if not found
   */
  async getTranscriptContent(callId: string): Promise<string | null> {
    try {
      // Try to fetch formatted transcript first
      const formattedPath = `attachments/${callId}_formatted.txt`;
      const formattedFile = this.transcriptBucket.file(formattedPath);
      const [formattedExists] = await formattedFile.exists();

      if (formattedExists) {
        const [buffer] = await formattedFile.download();
        return buffer.toString('utf-8');
      }

      // Fall back to raw JSONL and format it
      const rawContent = await this.retrieveTranscript(callId);
      if (!rawContent) {
        return null;
      }

      const entries = this.parseTranscriptEntries(rawContent);
      if (entries.length === 0) {
        return null;
      }

      return this.formatTranscript(entries);
    } catch (error) {
      logger.error(`Failed to get transcript content for ${callId}:`, error);
      return null;
    }
  }

  /**
   * Post-process transcript: translate to English
   * @param transcript - The formatted transcript text
   * @returns Post-processed transcript or original if processing fails
   */
  async postProcessTranscript(transcript: string): Promise<string> {
    if (!this.summaryAgent) {
      logger.warn('Agent not initialized. Skipping transcript post-processing.');
      return transcript;
    }

    const systemInstructions = `You are processing a call transcript. Your task is to translate any non-English text to English.

IMPORTANT:
- Keep ALL timestamps exactly as they are: [MM:SS] format
- Keep ALL speaker names exactly as they are
- Only translate the spoken text to English
- Do not modify, fix, or improve the text beyond translation
- Do not add new lines or remove existing ones
- Do not add commentary or explanations
- Preserve the exact line-by-line structure: [MM:SS] Speaker Name: text

Output ONLY the processed transcript, nothing else.`;

    try {
      const result = await this.summaryAgent.execute({
        messages: [createSystemMessage(systemInstructions),
          createUserMessage(transcript)],
      });

      if (!['completed', 'max_turns'].includes(result.status as string)) {
        logger.warn('Failed to post-processed transcript, using original');
        return transcript;
      }

      const last = result.messages.at(-1);
      if (!last || !('content' in last) || !last.content) {
        logger.warn('No content in post-processing result, using original');
        return transcript;
      }

      const processedTranscript = last.content.trim();
      logger.info('Successfully post-processed transcript (translation)');
      return processedTranscript;
    } catch (error) {
      logger.error('Error during transcript post-processing:', error);
      return transcript; // Fallback to original if processing fails
    }
  }

  /**
   * Generate AI summary from the formatted transcript
   * @param transcript - The formatted transcript text
   * @returns AI-generated Markdown summary or null if generation fails
   */
  async generateCallSummary(transcript: string): Promise<string | null> {
    if (!this.summaryAgent) return null;

    const prompt = CALL_SUMMARY_PROMPT.replace('{transcript}', transcript);

    const result = await this.summaryAgent.execute({
      messages: [createUserMessage(prompt)],
    });

    if (!['completed', 'max_turns'].includes(result.status as string)) {
      return null;
    }

    const last = result.messages.at(-1);
    if (!last) return null;

    const markdownContent = 'content' in last ? last.content?.trim() : null;
    if (!markdownContent) return null;

    // Return raw markdown - no sanitization needed for markdown
    return markdownContent;
  }

  /**
   * Generate a short AI title from transcript
   * @param transcript - The formatted transcript text
   * @returns AI-generated title (max 100 chars) or null if generation fails
   */
  async generateCallTitle(transcript: string): Promise<string | null> {
    if (!this.titleAgent) return null;

    const prompt = CALL_TITLE_PROMPT.replace('{transcript}', transcript);

    const result = await this.titleAgent.execute({
      messages: [createUserMessage(prompt)],
    });

    if (!['completed', 'max_turns'].includes(result.status as string)) {
      return null;
    }

    const last = result.messages.at(-1);
    if (!last || !('content' in last)) return null;

    const title = last.content?.trim() || null;
    
    // Truncate to 100 chars max
    return title ? title.substring(0, 100) : null;
  }

  /**
   * Generate ticket suggestions from call transcript and summary
   * @param transcript - The formatted transcript text
   * @param summary - The AI-generated call summary
   * @returns Array of ticket suggestions or empty array if generation fails
   */
  async generateTicketSuggestions(
    transcript: string
  ): Promise<TicketSuggestion[]> {
    if (!this.ticketAgent) {
      logger.warn('Agent not initialized. Skipping ticket suggestions generation.');
      return [];
    }

    const prompt = TICKET_SUGGESTIONS_PROMPT
      .replace('{transcript}', transcript)
      .replace('{summary}', 'Summary not available (analyze transcript directly)');

    try {
      const result = await this.ticketAgent.execute({
        messages: [createUserMessage(prompt)],
      });

      if (!['completed', 'max_turns'].includes(result.status as string)) {
        logger.warn('Failed to generate ticket suggestions: Agent returned error or no messages');
        return [];
      }

      const last = result.messages.at(-1);
      if (!last || !('content' in last) || !last.content) {
        logger.warn('Failed to generate ticket suggestions: No content in agent response');
        return [];
      }

      let jsonContent = last.content.trim();
      
      // Strip markdown code fences if present (```json...``` or ```...```)
      const codeBlockMatch = jsonContent.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        jsonContent = codeBlockMatch[1].trim();
      }
      
      // Parse JSON response
      const parsed = JSON.parse(jsonContent);
      
      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        logger.warn('Invalid ticket suggestions format: missing or invalid suggestions array');
        return [];
      }

      // Transform and validate suggestions
      const suggestions: TicketSuggestion[] = parsed.suggestions
        .slice(0, 10) // Limit to 10 suggestions
        .map((s: any, index: number) => ({
          id: `suggestion-${Date.now()}-${index}`,
          title: s.title || 'Untitled Task',
          description: s.description || '',
          priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s.priority) 
            ? s.priority 
            : 'MEDIUM',
          suggestedAssignee: s.suggestedAssignee || 'unassigned',
          status: 'pending' as const,
        }));

      logger.info(`Generated ${suggestions.length} ticket suggestions`);
      return suggestions;
    } catch (error) {
      logger.error('Failed to generate ticket suggestions:', error);
      return [];
    }
  }

  /**
   * Post AI summary as a reply to the call message in the same conversation
   * @param conversationId - The conversation ID of the call message
   * @param callId - The external call ID
   * @param markdownSummary - The AI-generated Markdown summary
   * @param _createdByUserId - The user who initiated the call (no longer used as sender)
   * @param ticketSuggestions - Optional array of ticket suggestions to append as markdown
   */
  async postSummaryAsReply(
    conversationId: string,
    callId: string,
    markdownSummary: string,
    _createdByUserId: string,
    ticketSuggestions?: TicketSuggestion[]
  ) {    
    logger.info(`[postSummaryAsReply] Starting for callId: ${callId}, conversationId: ${conversationId}`);

    let xyneAutomaticBot;
    try {
      xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
    } catch (error) {
      logger.error('Failed to retrieve Xyne Automatic bot', { error: JSON.stringify(error) });
      throw new Error(`Failed to retrieve bot user: ${JSON.stringify(error)}`);
    }

    if (!xyneAutomaticBot) {
      logger.error('Xyne Automatic bot not found - cannot post summary');
      throw new Error('Xyne Automatic bot not found');
    }

    logger.info(`[postSummaryAsReply] Bot found: ${xyneAutomaticBot.id} (${xyneAutomaticBot.email})`);

    // Build markdown content with ticket suggestions in YAML frontmatter
    let fullMarkdownContent = '';
    
    if (ticketSuggestions && ticketSuggestions.length > 0) {
      const frontmatterData = {
        suggestions: ticketSuggestions.map((suggestion) => ({
          suggestionId: randomUUID(),
          title: suggestion.title,
          priority: suggestion.priority,
          description: suggestion.description,
          assignee: suggestion.suggestedAssignee,
        })),
      };
      
      fullMarkdownContent = '---\n' + yaml.dump(frontmatterData) + '---\n\n';
      logger.info(`Added ${ticketSuggestions.length} ticket suggestions in YAML frontmatter`);
    }
    
    // Append the markdown summary after frontmatter
    fullMarkdownContent += markdownSummary;

    // Use repository pattern for database operations
    const message = await repositories.messages.create({
      conversationId,
      senderId: xyneAutomaticBot.id,
      content: fullMarkdownContent,
      msgType: MessageType.BOT,
      showInChannel: false,
      metadata: {
        messageSubtype: 'call_summary',
        callId,
        isAiGenerated: true,
        contentFormat: 'markdown',
        hasSuggestedTickets: ticketSuggestions && ticketSuggestions.length > 0,
        suggestedTicketsCount: ticketSuggestions?.length || 0,
      },
    });

    logger.info(`[postSummaryAsReply] Message created: ${message.messageId} in conversation ${conversationId}`);

    await repositories.conversations.incrementReplyCount(conversationId);
    logger.info(`[postSummaryAsReply] Reply count incremented for conversation ${conversationId}`);
  }

  /**
   * Process call transcript and generate AI summary
   * This is the main orchestration method that:
   * 1. Processes the transcript (existing functionality)
   * 2. Generates AI summary
   * 3. Saves summary to call record
   * 4. Posts summary to channel
   */
  async processCallWithSummary(callId: string, messageId: string): Promise<void> {
    try {
      // First, process the transcript (existing functionality)
      // await this.postCallTranscript(callId, messageId);

      // Get call details for summary generation
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`Call not found for summary generation: ${callId}`);
        return;
      }

      // Get the call message to retrieve conversationId for the reply
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.error(`Call message not found for summary: ${messageId}`);
        return;
      }

      // Retrieve and format transcript for AI
      const transcriptContent = await this.retrieveTranscript(callId);
      if (!transcriptContent) {
        logger.warn(`No transcript content available for AI summary: ${callId}`);
        return;
      }

      const entries = this.parseTranscriptEntries(transcriptContent);
      if (entries.length === 0) {
        logger.warn(`No transcript entries for AI summary: ${callId}`);
        return;
      }

      const formattedTranscript = this.formatTranscript(entries);

      const startTime = Date.now();
      const [summary, title, ticketSuggestions] = await Promise.all([
        this.generateCallSummary(formattedTranscript).catch(err => {
          logger.error(`Failed to generate summary: ${err}`);
          return null;
        }),
        this.generateCallTitle(formattedTranscript).catch(err => {
          logger.error(`Failed to generate title: ${err}`);
          return null;
        }),
        this.generateTicketSuggestions(formattedTranscript).catch(err => {
          logger.error(`Failed to generate ticket suggestions: ${err}`);
          return [];
        })
      ]);

      const duration = Date.now() - startTime;
      logger.info(`AI generation completed in ${duration}ms. Summary: ${!!summary}, Title: ${!!title}, Tickets: ${ticketSuggestions.length}`);

      if (summary) {
        // Save summary and title to call record
        await repositories.calls.update(call.id, {
          aiSummary: summary,
          title: title || undefined,  // Update title if generated
        });
        logger.info(`Saved AI summary${title ? ' and title' : ''} to call record: ${callId}`);

        // Update the call system message with the title (if generated)
        if (title) {
          try {
            // Use Prisma transaction for atomic message update
            await db.$transaction(async (tx) => {
              // Fetch the message within the transaction
              const message = await tx.message.findUnique({
                where: { messageId },
              });
              
              if (message) {
                const currentContent = message.content || '';
                const updatedContent = `${title} • ${currentContent}`;
                
                // Update message with title
                await tx.message.update({
                  where: { messageId },
                  data: {
                    content: updatedContent,
                    metadata: {
                      ...(message.metadata as any),
                      callTitle: title,
                    },
                  },
                });
                
                logger.info(`Updated call message ${messageId} with title: ${title}`);
              } else {
                logger.warn(`Call message ${messageId} not found for title update`);
              }
            });
          } catch (error) {
            logger.error(`Failed to update call message with title:`, error);
            // Don't fail the whole process if message update fails
          }
        }

        // Post summary as reply to the call message with ticket suggestions
        await this.postSummaryAsReply(
          callMessage.conversationId,
          callId,
          summary,
          call.createdByUserId,
          ticketSuggestions
        );
      } else {
        logger.warn(`AI summary generation returned null for call: ${callId}`);
      }
    } catch (error) {
      logger.error(`Failed to process call with summary for ${callId}:`, error);
      // Don't re-throw - the transcript was already processed successfully
    }
  }
}

export const transcriptService = new TranscriptService();
