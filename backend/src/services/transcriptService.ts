import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { AttachmentEntityType } from '@prisma/client';
import { config } from '@/config/env';
import { Storage, Bucket } from '@google-cloud/storage';
import { Agent, createUserMessage, createSystemMessage } from '@framework';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType } from '@xyne/shared';

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

export class TranscriptService {
  private transcriptBucket: Bucket;
  private storage: Storage;
  private agent: Agent | null = null;

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

    // Initialize Agent for AI summary generation
    this.initializeAgent();
  }

  /**
   * Initialize Agent using framework's factory pattern
   */
  private initializeAgent(): void {
    try {
      const apiKey = config.llm.litellmApiKey;
      const baseUrl = config.llm.litellmBaseUrl;

      if (!apiKey || !baseUrl) {
        logger.warn('LiteLLM credentials not configured. AI summary generation will be disabled.');
        return;
      }

      this.agent = Agent.create({
        model: {
          provider: {
            type: 'litellm',
            config: {
              apiKey,
              baseUrl,
              timeout: 120000, // 2 minutes timeout
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
          mode: 'single',
          timeouts: { llm: 120000 },
          limits: {},
          errorHandling: {},
        },
        events: {
          logging: 'error', // Minimal logging for transcript service
        },
      });

      logger.info(
        `Agent initialized for AI summary generation (model: ${config.llm.litellmModel || 'glm-latest'})`
      );
    } catch (error) {
      logger.error('Failed to initialize Agent:', error);
      this.agent = null;
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
    if (!this.agent) {
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
      const result = await this.agent.execute({
        messages: [
          createSystemMessage(systemInstructions),
          createUserMessage(transcript)
        ],
      });

      // Early exit if agent didn't complete successfully (allow both 'completed' and 'max_turns')
      if (result.status !== 'completed' && result.status !== 'max_turns') {
        logger.warn(`Post-processing not completed (status: ${result.status}), using original`);
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
    if (!this.agent) return null;

    const prompt = CALL_SUMMARY_PROMPT.replace('{transcript}', transcript);

    const result = await this.agent.execute({
      messages: [createUserMessage(prompt)],
    });

    if (result.status === 'error' || !result.messages.length) {
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
   * Post AI summary as a reply to the call message in the same conversation
   * @param conversationId - The conversation ID of the call message
   * @param callId - The external call ID
   * @param markdownSummary - The AI-generated Markdown summary
   * @param _createdByUserId - The user who initiated the call (no longer used as sender)
   */
  async postSummaryAsReply(
    conversationId: string,
    callId: string,
    markdownSummary: string,
    _createdByUserId: string
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

    // Use repository pattern for database operations
    const message = await repositories.messages.create({
      conversationId,
      senderId: xyneAutomaticBot.id,
      content: markdownSummary,
      msgType: MessageType.BOT,
      showInChannel: false,
      metadata: {
        messageSubtype: 'call_summary',
        callId,
        isAiGenerated: true,
        contentFormat: 'markdown',
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
      await this.postCallTranscript(callId, messageId);

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

      // Generate AI summary
      const summary = await this.generateCallSummary(formattedTranscript);

      if (summary) {
        // Save summary to call record
        await repositories.calls.update(call.id, {
          aiSummary: summary,
        });
        logger.info(`Saved AI summary to call record: ${callId}`);

        // Post summary as reply to the call message
        await this.postSummaryAsReply(
          callMessage.conversationId,
          callId,
          summary,
          call.createdByUserId
        );
      } else {
        logger.warn(`AI summary generation skipped or failed for call: ${callId}`);
      }
    } catch (error) {
      logger.error(`Failed to process call with summary for ${callId}:`, error);
      // Don't re-throw - the transcript was already processed successfully
    }
  }
}

export const transcriptService = new TranscriptService();
