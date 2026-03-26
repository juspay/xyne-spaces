import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { AttachmentEntityType, CallOrigin } from '@prisma/client';
import { config } from '@/config/env';
import { Storage, Bucket } from '@google-cloud/storage';
import { Agent, createUserMessage, createSystemMessage } from '@framework';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType } from '@xyne/shared';
import { db } from '@/database/client';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { GCSService } from '../services/gcsService';
import { pulseService, type PulseActionItem } from '@/services/pulseService';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';

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
- Generate 1-25 actionable ticket suggestions based on the call content
- Don't create small tickets for every minor work item. Instead, group related work items or tasks assigned to the same person into a single ticket when it makes sense.
- Do NOT force all work into a single ticket. Create separate tickets for fundamentally different, unrelated tasks.
- Each suggestion must be a concrete task (or cohesive group of related tasks) mentioned or implied in the call
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

// Pulse data extraction prompt — extracts multiple merchants and their actionable items from the transcript.
// This is completely separate from Xyne ticket suggestions.
const PULSE_DATA_PROMPT = `
You are analyzing a call/meeting transcript between a sales or support team and one or more merchants/customers.

CRITICAL RULES:
- Output ONLY valid JSON
- Extract a list of merchants or companies discussed in this call
- For each merchant, identify concrete action items that need to be done FOR them
- Each action item must have a clear task description and, if explicitly mentioned, an assignee email
- Use "unassigned" if no specific person is mentioned for a task
- Only include tasks that are clearly merchant-related (not internal team tasks)
- If no merchants are identifiable, return an empty array for "merchants"

MERCHANT NAME MATCHING:
- Use the REFERENCE_MERCHANTS list below to match merchant names
- Transcripts are lossy and may have errors (e.g., "Zypto" instead of "Zepto")
- If you detect a merchant name similar to one in the reference list, use the EXACT name from the list
- Common errors: phonetic errors, abbreviations, partial names
- Examples: "Zypto" → "Zepto", "Swiggy Insta" → "Swiggy"
- Make sure the surrounding context is about merchant only

REFERENCE_MERCHANTS:
{merchantList}

JSON STRUCTURE (FOLLOW EXACTLY):
{
  "merchants": [
    {
      "merchantName": "[Company or merchant name - use EXACT match from REFERENCE_MERCHANTS if similar]",
      "actionItems": [
        {
          "content": "[Clear description of what needs to be done for this specific merchant]",
          "assignee": "[Assignee email from transcript]" | "unassigned"
        }
      ]
    }
  ]
}

Only output valid JSON.
No explanations.

TRANSCRIPT:
{transcript}
`


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
  }

  /**
   * Create a fresh Agent instance for each request
   * This prevents state pollution and BUSY errors between concurrent requests
   */
  private createAgent(): Agent | null {
    try {
      const apiKey = config.llm.litellmApiKey;
      const baseUrl = config.llm.litellmBaseUrl;

      if (!apiKey || !baseUrl) {
        logger.warn('LiteLLM credentials not configured. AI features will be disabled.');
        return null;
      }

      const agentConfig = {
        model: {
          provider: {
            type: 'litellm' as const,
            config: {
              apiKey,
              baseUrl,
              timeout: 300000,
            },
          },
          defaultModel: config.llm.litellmModel || 'glm-latest',
        },
        tools: {
          enabled: [],
          config: {},
          execution: { timeout: 300000 },
        },
        execution: {
          maxTurns: 1,
          mode: 'single' as const,
          timeouts: { llm: 300000 },
          limits: {},
          errorHandling: {},
        },
        events: {
          logging: 'error' as const,
        },
      };

      return Agent.create(agentConfig);
    } catch (error) {
      logger.error('Failed to create AI agent:', error);
      return null;
    }
  }

  /**
   * Main entry point - attach transcript to existing call message when call ends
   * @param callId - The external call ID
   * @param messageId - The message ID of the call message from frontend
   */
  async postCallTranscript(callId: string, messageId: string): Promise<void> {
    try {
      logger.info(`[${callId}] transcript_processing_started | message_id=${messageId}`);

      // 0. Check if transcript attachment already exists for this CALL (not just this message)
      // This handles cases where multiple messages might be created for the same call
      let existingTranscriptAttachment =
        await repositories.messageAttachments.findTranscriptByCallId(callId);

      const isUpdate = !!existingTranscriptAttachment;
      if (isUpdate) {
        logger.info(
          `Transcript for call ${callId} already exists (attachment: ${existingTranscriptAttachment.id}). Will update with latest data.`
        );
      }

      // 1. Get call details
      logger.info(`[${callId}] call_lookup_started`);
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[${callId}] call_not_found`);
        return;
      }
      logger.info(
        `[${callId}] call_found | status=${call.status}, created_by=${call.createdByUserId}`
      );

      // Note: Status check removed - webhook only fires when room disconnects,
      // which means all users have left (agent is always the last to leave)

      // 2. Get the call message to retrieve conversationId
      logger.info(`[${callId}] message_lookup_started | message_id=${messageId}`);
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.warn(`[${callId}] message_not_found | message_id=${messageId}`);
        return;
      }
      logger.info(
        `[${callId}] message_found | message_id=${messageId}, conversation_id=${callMessage.conversationId}`
      );

      // 3. Retrieve transcript from GCS or local file
      const transcriptContent = await this.retrieveTranscript(callId);

      if (!transcriptContent) {
        logger.error(`Transcript file not found for call: ${callId}`);
        throw new Error(`Transcript file not found for call: ${callId}`);
      }

      // 4. Parse JSONL entries
      logger.info(`[${callId}] transcript_parsing_started`);
      const entries = this.parseTranscriptEntries(transcriptContent);
      if (entries.length === 0) {
        logger.error(`[${callId}] transcript_parsing_failed | entries_count=0`);
        throw new Error(`No valid transcript entries found for call: ${callId}`);
      }
      const uniqueSpeakers = new Set(entries.map((e) => e.user)).size;
      logger.info(
        `[${callId}] transcript_parsed | entries_count=${entries.length}, speakers_count=${uniqueSpeakers}`
      );

      // 5. Format as plain text (usernames are already included in transcript entries)
      logger.info(`[${callId}] transcript_formatting_started | format=plain_text`);
      const formattedTranscript = this.formatTranscript(entries, callId);
      logger.info(
        `[${callId}] transcript_formatted | format=plain_text, characters_count=${formattedTranscript.length}`
      );

      // 6. Upload raw formatted transcript immediately (no translation yet - non-blocking)
      const txtGcsPath = await this.uploadFormattedTranscript(callId, formattedTranscript);

      // 7. Keep the original JSONL file for debugging/archival purposes
      // Note: Not deleting the JSONL file as it may be useful for troubleshooting

      // 8. Build GCS URL using transcript bucket
      const gcsUrl = `gs://${config.gcs.transcriptionBucketName}/${txtGcsPath}`;

      // 9. Calculate metadata
      const firstTimestamp = entries[0].timestamp;
      const lastTimestamp = entries[entries.length - 1].timestamp;
      const durationSeconds = Math.round(lastTimestamp - firstTimestamp);
      const uniqueParticipants = Array.from(new Set(entries.map((e) => e.user))).filter(Boolean);

      // 11. Update existing attachment or create new one
      if (isUpdate && existingTranscriptAttachment) {
        // Get existing version or start at 1
        const existingMetadata = existingTranscriptAttachment.metadata as any;
        const currentVersion = existingMetadata?.version || 1;

        // IMPORTANT: Update entityId to point to current message
        // This ensures the attachment shows up with the correct message in the UI
        await repositories.messageAttachments.update(existingTranscriptAttachment.id, {
          url: gcsUrl,
          size: formattedTranscript.length,
          metadata: {
            callId,
            type: 'transcript',
            duration: durationSeconds,
            participantCount: uniqueParticipants.length,
            version: currentVersion + 1,
            lastUpdatedAt: new Date().toISOString(),
            entryCount: entries.length,
          },
        });
        logger.info(`Updated transcript attachment ${existingTranscriptAttachment.id} to version ${currentVersion + 1}, linked to message ${messageId}`);
      } else {
        logger.info(
          `[${callId}] attachment_creation_started | message_id=${messageId}, attachment_type=transcript`
        );
        const attachment = await repositories.messageAttachments.create({
          entityId: messageId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: `call_transcript.txt`,
          size: formattedTranscript.length,
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
            version: 1,
            createdAt: new Date().toISOString(),
            entryCount: entries.length,
          },
        });
        logger.info(
          `[${callId}] attachment_created | attachment_id=${attachment.id}, gcs_url=${gcsUrl}`
        );
      }

      // 11. Save transcript URL to Call record for easier access (used by recordings feature)
      await repositories.calls.update(call.id, {
        transcript: gcsUrl,
      });
      logger.info(`[${callId}] call_record_updated | fields_updated=transcript`);

      // 12. Update the call message to indicate it has an attachment
      await repositories.messages.update(messageId, {
        hasAttachment: true,
      });

      logger.info(`[${callId}] transcript_processing_completed | message_id=${messageId}`);

      // 13. Fire-and-forget: Translate transcript asynchronously in background
      // This updates the same GCS file without blocking the response
      this.translateTranscriptAsync(callId, txtGcsPath).catch((err) => {
        logger.error(`[${callId}] background_translation_failed | error=${err}`);
      });
    } catch (error) {
      logger.error(
        `[${callId}] transcript_processing_failed | message_id=${messageId}, error=${error instanceof Error ? error.message : JSON.stringify(error)}`,
        error
      );
      // Throw error to allow controller to return proper error response
      throw error;
    }
  }

  /**
   * Retrieve transcript from dedicated transcript GCS bucket
   * Returns raw JSONL content or null if not found
   *
   * TEST MODE: Set USE_TEST_TRANSCRIPT=true to use local transcript.json file
   */
  private async retrieveTranscript(callId: string): Promise<string | null> {
    const gcsPath = `transcriptions/${callId}.jsonl`;
    try {
      logger.info(`[${callId}] transcript_fetch_started | gcs_path=${gcsPath}`);

      // Use dedicated transcript bucket
      const file = this.transcriptBucket.file(gcsPath);
      const [exists] = await file.exists();

      if (!exists) {
        logger.error(`[${callId}] gcs_download_failed | error=file_not_found, gcs_path=${gcsPath}`);
        throw new Error(
          `Transcript file not found in bucket: gs://${config.gcs.transcriptionBucketName}/${gcsPath}`
        );
      }

      logger.info(`[${callId}] gcs_download_started`);
      const downloadStart = Date.now();
      const [buffer] = await file.download();
      logger.info(
        `[${callId}] gcs_download_completed | bytes_downloaded=${buffer.length}, duration_ms=${Date.now() - downloadStart}`
      );
      return buffer.toString('utf-8');
    } catch (error) {
      logger.error(`[${callId}] gcs_download_failed | error=${error instanceof Error ? error.message : JSON.stringify(error)}, gcs_path=${gcsPath}`, error);
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
  private consolidateEntries(entries: TranscriptEntry[], callId: string): TranscriptEntry[] {
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
      `[${callId}] transcript_consolidated | original_entries=${entries.length}, consolidated_entries=${consolidated.length}`
    );
    return consolidated;
  }

  /**
   * Format transcript entries into plain text
   */
  private formatTranscript(entries: TranscriptEntry[], callId?: string): string {
    if (entries.length === 0) {
      return 'No transcript available.';
    }

    // Consolidate consecutive entries from same speaker within 30s gap
    const consolidatedEntries = this.consolidateEntries(entries, callId || 'unknown');

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

    logger.info(`[${callId}] gcs_upload_started | type=formatted_transcript, gcs_path=${filepath}`);

    // Use dedicated transcript bucket
    const file = this.transcriptBucket.file(filepath);

    await file.save(buffer, {
      contentType: 'text/plain',
      metadata: {
        callId,
        type: 'transcript',
      },
    });

    logger.info(
      `[${callId}] gcs_upload_completed | type=formatted_transcript, gcs_path=${filepath}`
    );
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

      return this.formatTranscript(entries, callId);
    } catch (error) {
      logger.error(`Failed to get transcript content for ${callId}:`, error);
      return null;
    }
  }

  /**
   * Download formatted transcript file directly from GCS (txt file only, no fallback)
   * Used for direct file downloads
   * @param callId - The external call ID
   * @param gcsPath - The GCS path to the formatted transcript
   * @returns Buffer of the transcript file or null if not found
   */
  async downloadFormattedTranscript(callId: string, gcsPath: string): Promise<Buffer | null> {
    try {
      logger.info(
        `[${callId}] formatted_transcript_download_started | gcs_path=${gcsPath}, bucket=${config.gcs.transcriptionBucketName}`
      );

      const serviceToUse = new GCSService(config.gcs.transcriptionBucketName);
      const buffer = await serviceToUse.getFileBuffer(gcsPath);

      return buffer;
    } catch (error) {
      logger.error(
        `[${callId}] formatted_transcript_download_failed | gcs_path=${gcsPath}, error=${error}`
      );
      return null;
    }
  }

  /**
   * Translate transcript asynchronously in background (fire-and-forget)
   * Downloads raw transcript from GCS, translates it, and overwrites the same file
   * @param callId - The external call ID
   * @param gcsPath - The GCS path to the transcript file
   */
  private async translateTranscriptAsync(callId: string, gcsPath: string): Promise<void> {
    try {
      logger.info(`Starting background translation for call: ${callId}`);

      // 1. Download raw transcript from GCS
      const file = this.transcriptBucket.file(gcsPath);
      const [buffer] = await file.download();
      const rawTranscript = buffer.toString('utf-8');

      // 2. Translate the transcript
      const translatedTranscript = await this.postProcessTranscript(rawTranscript);

      // 3. Re-upload translated version (overwrites the same file)
      await file.save(Buffer.from(translatedTranscript, 'utf-8'), {
        contentType: 'text/plain',
        metadata: {
          callId,
          type: 'transcript',
          translated: 'true',
        },
      });

      // 4. Update database attachment metadata to mark as translated
      const attachments = await repositories.messageAttachments.findByCallId(callId);

      if (attachments.length > 0) {
        const transcriptAttachment = attachments[0];
        const current = await repositories.messageAttachments.findById(transcriptAttachment.id);
        const currentMetadata = (current?.metadata as Record<string, any>) || {}; // eslint-disable-line @typescript-eslint/no-explicit-any

        await repositories.messageAttachments.updateVersion(transcriptAttachment.id, {
          ...currentMetadata,
        });
        logger.info(`Updated database attachment metadata for call: ${callId}`);
      } else {
        logger.warn(`No attachment found in database for call: ${callId}`);
      }

      logger.info(`Successfully completed background translation for call: ${callId}`);
    } catch (error) {
      logger.error(`Failed to translate transcript in background for call ${callId}:`, error);
    }
  }

  /**
   * Post-process transcript: translate to English
   * Handles long transcripts by chunking them into smaller pieces
   * @param transcript - The formatted transcript text
   * @returns Post-processed transcript or original if processing fails
   */
  async postProcessTranscript(transcript: string): Promise<string> {
    const agent = this.createAgent();
    if (!agent) {
      logger.warn('Agent creation failed. Skipping transcript post-processing.');
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
- Do not use placeholders like "[...]" or "[content continues]"
- Preserve the exact line-by-line structure: [MM:SS] Speaker Name: text
- Translate EVERY line completely, do not skip or truncate any content

Output ONLY the processed transcript, nothing else.`;

    try {
      const lines = transcript.split('\n').filter((l) => l.trim());
      const MAX_LINES_PER_CHUNK = 100;

      if (lines.length <= MAX_LINES_PER_CHUNK) {
        const result = await agent.execute({
          messages: [createSystemMessage(systemInstructions), createUserMessage(transcript)],
        });

        if (!['completed', 'max_turns'].includes(result.status as string)) {
          logger.warn('Failed to post-process transcript, using original');
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
      }

      // For long transcripts, process in chunks CONCURRENTLY
      logger.info(
        `Transcript has ${lines.length} lines, processing in chunks of ${MAX_LINES_PER_CHUNK}`
      );

      // Split into chunks
      const chunkPromises: Array<Promise<string>> = [];
      for (let i = 0; i < lines.length; i += MAX_LINES_PER_CHUNK) {
        const chunkLines = lines.slice(i, i + MAX_LINES_PER_CHUNK);
        const chunkText = chunkLines.join('\n');
        const chunkIndex = Math.floor(i / MAX_LINES_PER_CHUNK) + 1;
        const totalChunks = Math.ceil(lines.length / MAX_LINES_PER_CHUNK);

        // Create a fresh agent for each chunk to avoid BUSY errors
        const chunkPromise = (async () => {
          const chunkAgent = this.createAgent();
          if (!chunkAgent) {
            logger.warn(`Agent creation failed for chunk ${chunkIndex}, using original`);
            return chunkText;
          }

          logger.info(
            `Processing chunk ${chunkIndex}/${totalChunks} (lines ${i + 1}-${i + chunkLines.length})`
          );

          try {
            const result = await chunkAgent.execute({
              messages: [createSystemMessage(systemInstructions), createUserMessage(chunkText)],
            });

            if (!['completed', 'max_turns'].includes(result.status as string)) {
              logger.warn(`Failed to process chunk ${chunkIndex}, using original`);
              return chunkText;
            }

            const last = result.messages.at(-1);
            if (!last || !('content' in last) || !last.content) {
              logger.warn(`No content in chunk ${chunkIndex}, using original`);
              return chunkText;
            }

            logger.info(`Chunk ${chunkIndex}/${totalChunks} completed`);
            return last.content.trim();
          } catch (error) {
            logger.error(`Error processing chunk ${chunkIndex}:`, error);
            return chunkText;
          }
        })();

        chunkPromises.push(chunkPromise);
      }

      // Process all chunks in parallel
      const processedChunks = await Promise.all(chunkPromises);
      const processedTranscript = processedChunks.join('\n');
      logger.info(
        `Successfully post-processed transcript in ${processedChunks.length} chunks (parallel translation)`
      );
      return processedTranscript;
    } catch (error) {
      logger.error('Error during transcript post-processing:', error);
      return transcript; // Fallback to original if processing fails
    }
  }

  /**
   * Generate AI summary from the formatted transcript
   * @param transcript - The formatted transcript text
   * @param callId - The call ID for logging
   * @returns AI-generated Markdown summary or null if generation fails
   */
  async generateCallSummary(transcript: string, callId?: string): Promise<string | null> {
    const agent = this.createAgent();
    const logCallId = callId || 'unknown';
    if (!agent) return null;

    logger.info(
      `[${logCallId}] ai_summary_generation_started | summary_type=call_summary, model=${config.llm.litellmModel || 'glm-latest'}`
    );
    const prompt = CALL_SUMMARY_PROMPT.replace('{transcript}', transcript);

    const summaryStart = Date.now();
    try {
      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      if (result.status === 'error' || !result.messages.length) {
        logger.error(
          `[${logCallId}] ai_summary_generation_failed | status=${result.status}, messages_count=${result.messages.length}, result=${JSON.stringify(result)}`
        );
        return null;
      }

      const last = result.messages.at(-1);
      if (!last) {
        logger.error(`[${logCallId}] ai_summary_generation_failed | error=no_last_message, messages_count=${result.messages.length}`);
        return null;
      }

      const markdownContent = 'content' in last ? last.content?.trim() : null;
      if (!markdownContent) {
        logger.error(`[${logCallId}] ai_summary_generation_failed | error=empty_content, last_message=${JSON.stringify(last)}`);
        return null;
      }

      logger.info(
        `[${logCallId}] ai_summary_generated | summary_length=${markdownContent.length}, duration_ms=${Date.now() - summaryStart}`
      );
      // Return raw markdown - no sanitization needed for markdown
      return markdownContent;
    } catch (error) {
      logger.error(
        `[${logCallId}] ai_summary_generation_failed | error=${error instanceof Error ? error.message : JSON.stringify(error)}, duration_ms=${Date.now() - summaryStart}`,
        error
      );
      return null;
    }
  }

  /**
   * Generate a short AI title from transcript
   * @param transcript - The formatted transcript text
   * @returns AI-generated title (max 100 chars) or null if generation fails
   */
  async generateCallTitle(transcript: string): Promise<string | null> {
    const agent = this.createAgent();
    if (!agent) return null;

    const prompt = CALL_TITLE_PROMPT.replace('{transcript}', transcript);

    const result = await agent.execute({
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
   * Format conversation messages for title generation
   */
  private async formatConversationMessagesForTitle(conversationId: string): Promise<string | null> {
    try {
      const messages = await repositories.messages.getConversationMessages(conversationId);
      const messagesArray = Array.isArray(messages) ? messages : messages.data;
      
      // Filter valid messages once
      const validMessages = messagesArray.filter(
        (msg) => msg.msgType !== 'SYSTEM' && msg.senderId && msg.content?.trim()
      );
      if (!validMessages.length) return null;

      // Get unique user IDs and fetch user names
      const userIds = [...new Set(validMessages.map((msg) => msg.senderId))];
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.name || u.email || u.id]));

      return validMessages
        .map((msg) => `${userMap.get(msg.senderId) || msg.senderId}: ${msg.content}`)
        .join('\n');
    } catch (error) {
      logger.error(`Failed to format conversation messages for title: ${conversationId}`, error);
      return null;
    }
  }

  /**
   * Generate a title for a call based on conversation messages
   */
  async generateCallTitleFromConversation(conversationId: string): Promise<string | null> {
    const formatted = await this.formatConversationMessagesForTitle(conversationId);
    return formatted ? await this.generateCallTitle(formatted) : null;
  }

  /**
   * Generate ticket suggestions from call transcript and summary
   * @param transcript - The formatted transcript text
   * @param summary - The AI-generated call summary
   * @returns Array of ticket suggestions or empty array if generation fails
   */
  async generateTicketSuggestions(transcript: string): Promise<TicketSuggestion[]> {
    const agent = this.createAgent();
    if (!agent) {
      logger.warn('Agent creation failed. Skipping ticket suggestions generation.');
      return [];
    }

    const prompt = TICKET_SUGGESTIONS_PROMPT.replace('{transcript}', transcript).replace(
      '{summary}',
      'Summary not available (analyze transcript directly)'
    );

    try {
      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      if (!['completed', 'max_turns'].includes(result.status as string)) {
        logger.error(`ticket_suggestions_generation_failed | status=${result.status}, messages_count=${result.messages.length}, result=${JSON.stringify(result)}`);
        return [];
      }

      const last = result.messages.at(-1);
      if (!last || !('content' in last) || !last.content) {
        logger.error(`ticket_suggestions_generation_failed | error=empty_content, last_message=${JSON.stringify(last)}`);
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
        logger.error(`ticket_suggestions_generation_failed | error=invalid_format, parsed=${JSON.stringify(parsed)}`);
        return [];
      }

      // Transform and validate suggestions
      const suggestions: TicketSuggestion[] = parsed.suggestions
        .slice(0, 25) // Limit to 25 suggestions
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
      logger.error(`ticket_suggestions_generation_failed | error=${error instanceof Error ? error.message : JSON.stringify(error)}`, error);
      return [];
    }
  }

  /**
   * Extract the primary merchant/customer name from the transcript using the LLM.
   * Returns null if no merchant is clearly identified.
   */
  /**
   * Run the dedicated Pulse LLM prompt against the transcript.
   * Returns extracted merchant name + merchant-specific action items in one call.
   * Completely independent of Xyne ticket suggestions.
   */
  async generatePulseData(
    transcript: string
  ): Promise<Array<{ merchantName: string; actionItems: PulseActionItem[] }>> {
    if (config.pulse.enabledChannels.length === 0) return [];

    const agent = this.createAgent();
    if (!agent) {
      logger.warn('[Pulse] Agent creation failed — cannot generate Pulse data');
      return [];
    }

    // Fetch merchant list for LLM reference
    const merchantList = await pulseService.fetchOrgList();
    const merchantNames = merchantList
      .map(org => org.name ?? org.orgName)
      .filter(name => name)
      .join(', ');

    const prompt = PULSE_DATA_PROMPT
      .replace('{merchantList}', merchantNames || 'No reference list available')
      .replace('{transcript}', transcript);

    try {
      const result = await agent.execute({ messages: [createUserMessage(prompt)] });

      if (!['completed', 'max_turns'].includes(result.status as string)) {
        logger.error(`[Pulse] generatePulseData_failed | status=${result.status}, messages_count=${result.messages.length}, result=${JSON.stringify(result)}`);
        return [];
      }

      const last = result.messages.at(-1);
      if (!last || !('content' in last) || !last.content) {
        logger.error(`[Pulse] generatePulseData_failed | error=empty_content, last_message=${JSON.stringify(last)}`);
        return [];
      }

      let jsonContent = last.content.trim();
      const fence = jsonContent.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
      if (fence) jsonContent = fence[1].trim();

      const parsed = JSON.parse(jsonContent) as {
        merchants: Array<{
          merchantName: string;
          actionItems: Array<{ content: string; assignee: string }>;
        }>;
      };

      if (!parsed.merchants || !Array.isArray(parsed.merchants)) {
        return [];
      }

      const groups = parsed.merchants.map((m) => ({
        merchantName: m.merchantName,
        actionItems: (m.actionItems ?? [])
          .filter((i) => i.content)
          .map((i) => ({ content: i.content, assignee: i.assignee || 'unassigned' })),
      }));

      logger.info(`[Pulse] generatePulseData: extracted ${groups.length} merchants`);
      return groups;
    } catch (error) {
      logger.error('[Pulse] generatePulseData failed:', error);
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
    logger.info(
      `[postSummaryAsReply] Starting for callId: ${callId}, conversationId: ${conversationId}`
    );

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

    logger.info(
      `[postSummaryAsReply] Bot found: ${xyneAutomaticBot.id} (${xyneAutomaticBot.email})`
    );

    // ── 1. Post / update the AI summary as its own standalone message ──────────
    const existingSummary = await repositories.messages.findSummaryByCallId(conversationId, callId);

    if (existingSummary) {
      const existingMetadata = existingSummary.metadata as any;
      const currentVersion = existingMetadata?.version || 1;

      await repositories.messages.update(existingSummary.messageId, {
        content: markdownSummary,
        metadata: {
          messageSubtype: 'call_summary',
          callId,
          isAiGenerated: true,
          contentFormat: 'markdown',
          hasSuggestedTickets: false,
          suggestedTicketsCount: 0,
          version: currentVersion + 1,
          lastUpdatedAt: new Date().toISOString(),
        },
      });
      logger.info(
        `[postSummaryAsReply] Updated existing summary message ${existingSummary.messageId} to version ${currentVersion + 1}`
      );
    } else {
      const summaryMessage = await repositories.messages.create({
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
          hasSuggestedTickets: false,
          suggestedTicketsCount: 0,
          version: 1,
          createdAt: new Date().toISOString(),
        },
      });
      await repositories.conversations.incrementReplyCount(conversationId);
      logger.info(
        `[postSummaryAsReply] Summary message created: ${summaryMessage.messageId} in conversation ${conversationId}`
      );
    }

    // ── 2. Post ticket suggestions as batched separate messages ──────────────
    // Update existing ticket messages in place (preserves chat position).
    // Delete extras if batch count shrinks. Create new ones if it grows.
    if (ticketSuggestions && ticketSuggestions.length > 0) {
      const BATCH_SIZE = 10;

      const batches: TicketSuggestion[][] = [];
      for (let i = 0; i < ticketSuggestions.length; i += BATCH_SIZE) {
        batches.push(ticketSuggestions.slice(i, i + BATCH_SIZE));
      }

      logger.info(
        `[postSummaryAsReply] Posting ${ticketSuggestions.length} tickets in ${batches.length} batch(es) of up to ${BATCH_SIZE}`
      );

      const existingTicketMessages = await repositories.messages.findTicketsByCallId(conversationId, callId);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        const frontmatterData = {
          suggestions: batch.map((suggestion) => ({
            suggestionId: randomUUID(),
            title: suggestion.title,
            priority: suggestion.priority,
            description: suggestion.description,
            assignee: suggestion.suggestedAssignee,
          })),
        };

        const batchContent =
          '---\n' + yaml.dump(frontmatterData) + '---\n' + (batchIndex === 0 ? '\n## Suggested Tickets:\n' : '');

        const existing = existingTicketMessages[batchIndex];

        if (existing) {
          // Update in place — preserves the message's position in the chat thread
          const existingMetadata = existing.metadata as any;
          const currentVersion = existingMetadata?.version || 1;
          await repositories.messages.update(existing.messageId, {
            content: batchContent,
            metadata: {
              messageSubtype: 'call_suggested_tickets',
              callId,
              isAiGenerated: true,
              contentFormat: 'markdown',
              hasSuggestedTickets: true,
              suggestedTicketsCount: batch.length,
              batchIndex,
              totalBatches: batches.length,
              version: currentVersion + 1,
              lastUpdatedAt: new Date().toISOString(),
            },
          });
          logger.info(
            `[postSummaryAsReply] Updated ticket batch message ${existing.messageId} (batch ${batchIndex + 1}/${batches.length})`
          );
        } else {
          // More batches than before — create the new ones
          const batchMessage = await repositories.messages.create({
            conversationId,
            senderId: xyneAutomaticBot.id,
            content: batchContent,
            msgType: MessageType.BOT,
            showInChannel: false,
            metadata: {
              messageSubtype: 'call_suggested_tickets',
              callId,
              isAiGenerated: true,
              contentFormat: 'markdown',
              hasSuggestedTickets: true,
              suggestedTicketsCount: batch.length,
              batchIndex,
              totalBatches: batches.length,
              version: 1,
              createdAt: new Date().toISOString(),
            },
          });
          await repositories.conversations.incrementReplyCount(conversationId);
          logger.info(
            `[postSummaryAsReply] Ticket batch message created: ${batchMessage.messageId} (batch ${batchIndex + 1}/${batches.length})`
          );
        }
      }

      // Fewer batches than before — delete the now-unused extra messages
      if (existingTicketMessages.length > batches.length) {
        const extras = existingTicketMessages.slice(batches.length);
        for (const extra of extras) {
          await repositories.messages.delete(extra.messageId);
          logger.info(
            `[postSummaryAsReply] Deleted surplus ticket batch message ${extra.messageId}`
          );
        }
      }
    }

    logger.info(`[postSummaryAsReply] Done for callId: ${callId}`);
  }

  /**
     * Process call transcript and generate AI summary
     * This is the main orchestration method that:
     * 1. Checks if transcript exists in GCS
     * 2. Processes the transcript (existing functionality)
     * 3. Generates AI summary
     * 4. Saves summary to call record
     * 5. Posts summary to channel
     */
  async processCallWithSummary(
    callId: string,
    messageId: string,
    hasTranscript: boolean = true
  ): Promise<void> {
    try {
      if (!hasTranscript) {
        return;
      }

      // First, process the transcript (existing functionality)
      await this.postCallTranscript(callId, messageId);

      // Get call details for summary generation
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[${callId}] call_not_found | context=summary_generation`);
        return;
      }

      // Get the call message to retrieve conversationId for the reply
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.error(
          `[${callId}] message_not_found | message_id=${messageId}, context=summary_generation`
        );
        return;
      }

      // Retrieve and format transcript for AI
      const transcriptContent = await this.retrieveTranscript(callId);
      if (!transcriptContent) {
        logger.warn(`[${callId}] ai_summary_skipped | reason=no_transcript_content`);
        return;
      }

      const entries = this.parseTranscriptEntries(transcriptContent);
      if (entries.length === 0) {
        logger.warn(`[${callId}] ai_summary_skipped | reason=no_transcript_entries`);
        return;
      }

      const formattedTranscript = this.formatTranscript(entries, callId);

      // For CONVERSATION origin calls, combine conversation messages with transcript for title
      let titleInput = formattedTranscript;
      if (call.callOrigin === CallOrigin.CONVERSATION && callMessage.conversationId) {
        const conversationMessages = await this.formatConversationMessagesForTitle(callMessage.conversationId).catch(() => null);
        if (conversationMessages) {
          titleInput = `CONVERSATION CONTEXT:\n${conversationMessages}\n\nCALL TRANSCRIPT:\n${formattedTranscript}`;
        }
      }

      const startTime = Date.now();
      const [summary, title, ticketSuggestions] = await Promise.all([
        this.generateCallSummary(formattedTranscript, callId).catch((err) => {
          logger.error(`[${callId}] generate_summary_threw | error=${err instanceof Error ? err.message : JSON.stringify(err)}`, err);
          return null;
        }),
        this.generateCallTitle(titleInput).catch((err) => {
          logger.error(`[${callId}] generate_title_threw | error=${err instanceof Error ? err.message : JSON.stringify(err)}`, err);
          return null;
        }),
        this.generateTicketSuggestions(formattedTranscript).catch((err) => {
          logger.error(`[${callId}] generate_ticket_suggestions_threw | error=${err instanceof Error ? err.message : JSON.stringify(err)}`, err);
          return [];
        }),
      ]);

      const duration = Date.now() - startTime;
      logger.info(
        `AI generation completed in ${duration}ms. Summary: ${!!summary}, Title: ${!!title}, Tickets: ${ticketSuggestions.length}`
      );

      if (summary) {
        // Save summary and title to call record.
        // Only set title from AI if the call doesn't already have one (scheduled calls have a pre-set title).
        await repositories.calls.update(call.id, {
          aiSummary: summary,
          ...(title && !call.title ? { title } : {}),
        });
        logger.info(`[${callId}] call_record_updated | fields_updated=aiSummary`);

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

        // Post summary + Xyne ticket suggestions as a reply in the chat
        await this.postSummaryAsReply(
          callMessage.conversationId,
          callId,
          summary,
          call.createdByUserId,
          ticketSuggestions
        );

        // Pulse block — completely separate from Xyne tickets.
        // Only activates when the call's channel is in PULSE_ENABLED_CHANNELS.
        if (config.pulse.enabledChannels.length > 0) {
          try {
            // Check if this call's channel is in the Pulse allowlist (by channel ID)
            const isPulseChannel = config.pulse.enabledChannels.includes(call.channelId);

            if (isPulseChannel) {
              logger.info(`[Pulse] Channel ${call.channelId} is in allowlist — generating Pulse data for call ${callId}`);
              const pulseGroups = await this.generatePulseData(formattedTranscript);
              const validatedGroups: Array<{
                merchantName: string;
                actionItems: PulseActionItem[];
                orgContext: import('@/services/pulseService').PulseOrgContext;
              }> = [];

              for (const group of pulseGroups) {
                if (group.actionItems.length > 0) {
                  // Validate the merchant exists in Pulse BEFORE showing the UI card.
                  const { pulseService } = await import('@/services/pulseService');
                  const orgContext = group.merchantName
                    ? await pulseService.resolveOrgForMerchant(group.merchantName)
                    : null;

                  if (orgContext) {
                    validatedGroups.push({
                      merchantName: group.merchantName,
                      actionItems: group.actionItems,
                      orgContext,
                    });
                  } else {
                    logger.warn(`[Pulse] Merchant "${group.merchantName}" not found in Pulse — skipping its action items`);
                  }
                }
              }

              if (validatedGroups.length > 0) {
                await this.postPulseTicketsAsMessage(
                  callMessage.conversationId,
                  callId,
                  validatedGroups,
                );
              } else {
                logger.info(`[Pulse] No valid merchant actionables for call ${callId}`);
              }
            } else {
              logger.info(`[Pulse] Channel ${call.channelId} not in allowlist — skipping Pulse for call ${callId}`);
            }
          } catch (err) {
            logger.error(`[Pulse] Failed to post Pulse tickets message for call ${callId}:`, err);
          }
        }

        try {
          const { callDocumentService } = await import('@/services/callDocumentService');
          await callDocumentService.generateAndPostDetailedSummary(
            callId,
            formattedTranscript,
            callMessage.conversationId
          );
          logger.info(`Auto-generated detailed summary for call: ${callId}`);
        } catch (error) {
          logger.error(`Failed to auto-generate detailed summary for call ${callId}:`, error);
        }
      } else {
        logger.warn(`[${callId}] ai_summary_skipped | reason=generation_failed`);
      }
    // Queue Vespa indexing for the transcript (using call.id as the identifier)
      try {
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: call.id,
          jobType: 'feed',
          userId: call.createdByUserId,
          app: SubApp.TRANSCRIPT,
        });
        logger.info(`[TranscriptService] Queued Vespa indexing for transcript ${call.id}`);
      } catch (vespaError) {
        logger.error(`[TranscriptService] Failed to queue Vespa job for transcript ${call.id}:`, vespaError);
      }

    } catch (error) {
      logger.error(`[${callId}] process_call_with_summary_failed | error=${error instanceof Error ? error.message : JSON.stringify(error)}`, error);
      // Don't re-throw - the transcript was already processed successfully
    }
  }

  /**
   * Posts a dedicated bot message for Pulse actionables.
   * Uses the same YAML frontmatter pattern as Xyne ticket suggestions so the
   * frontend can parse + track which items have been sent to Pulse.
   *
   * Frontmatter shape:
   *   pulseItems:
   *     - itemId: <uuid>
   *       content: <action item text>
   *       assignee: <email>
   *   pulseSent:    # moved here after user creates the actionable
   *     - ...
   */
  private async postPulseTicketsAsMessage(
    conversationId: string,
    callId: string,
    validatedGroups: Array<{
      merchantName: string;
      actionItems: PulseActionItem[];
      orgContext: import('@/services/pulseService').PulseOrgContext;
    }>,
  ): Promise<void> {
    const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
    if (!xyneAutomaticBot) {
      logger.error('[Pulse] xyne-automatic bot not found — cannot post Pulse tickets message');
      return;
    }

    const merchants = validatedGroups.map((g, idx) => ({
      id: `m${idx + 1}`,
      name: g.merchantName,
      orgId: g.orgContext.orgId,
      merchantId: g.orgContext.merchantId,
      productId: g.orgContext.productId,
    }));

    const pulseItems = validatedGroups.flatMap((g, gIdx) =>
      g.actionItems.map((item) => ({
        itemId: randomUUID(),
        merchantId: `m${gIdx + 1}`,
        content: item.content,
        assignee: item.assignee,
      }))
    );

    const frontmatterData = {
      merchants,
      pulseItems,
    };

    const content = '---\n' + yaml.dump(frontmatterData) + '---\n\n## Suggested Pulse Actionables';

    await repositories.messages.create({
      conversationId,
      senderId: xyneAutomaticBot.id,
      content,
      msgType: MessageType.BOT,
      showInChannel: false,
      metadata: {
        messageSubtype: 'pulse_actionables',
        callId,
        isAiGenerated: true,
        contentFormat: 'markdown',
        hasPulseItems: true,
        pulseItemCount: pulseItems.length,
      },
    });

    await repositories.conversations.incrementReplyCount(conversationId);
    logger.info(
      `[Pulse] Posted consolidated Pulse actionables message for call ${callId} (${merchants.length} merchants)`
    );
  }
}

export const transcriptService = new TranscriptService();
