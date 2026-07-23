import { repositories } from '@/database/repositories';
import { getCanvasUrl } from '@/services/canvasService';
import { logger } from '@/utils/logger';
import { AttachmentEntityType, CallOrigin, CallType, Prisma } from '@prisma/client';
import { config } from '@/config/env';
import { Agent, createUserMessage } from '@framework';
import { extractAgentContent } from '@/utils/agentUtils';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType, OrgLLMServiceAccountPurpose } from '@xyne/shared';
import { db } from '@/database/client';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { getStorageService } from '@/services/storage';
import type { StorageService } from '@/services/storage';
import { pulseService, type PulseActionItem } from '@/services/pulseService';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { CacConfigService } from '@/services/cacConfigService';
import { getCallTicketSuggestionsTotal } from '@/services/otel/suggestionMetrics';
import { executeStreamingLlmRequest } from './callLlmRetry';
import { callRecordingService } from '@/services/callRecordingService';
import { callDocumentService } from '@/services/callDocumentService';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';

const SPEAKER_IDENTIFICATION_CAC_KEY = 'speaker_identification_config';

interface TranscriptEntry {
  user: string;
  text: string;
  timestamp: number;
  participant_identity: string;
}

// Shape of the metadata stored on a transcript message attachment. Written in
// postCallTranscript/processCallWithSummary and read back by the reconcile dedup guard.
interface TranscriptAttachmentMetadata {
  callId: string;
  type: 'transcript' | 'identified_transcript';
  duration: number;
  participantCount: number;
  version: number;
  entryCount: number;
  createdAt?: string;
  lastUpdatedAt?: string;
}

// Consolidation gap: if same speaker speaks within this gap, merge into single entry
const TRANSCRIPT_CONSOLIDATION_GAP_SECONDS = 30;

// AI Summary prompt for call transcripts - Markdown format
const CALL_SUMMARY_SYSTEM_PROMPT = `
You are generating a call summary for a professional collaboration product.

CRITICAL RULES:
- Output ONLY valid Markdown
- Do NOT include explanations, reasoning, or analysis
- Do NOT mention the transcript
- Do NOT judge or label user behavior
- Use neutral, professional language
- This will be rendered directly in the UI

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

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
`;

// AI Title prompt for call transcripts - Two lines, descriptive
const CALL_TITLE_SYSTEM_PROMPT = `
You are summarizing the topic of a call in exactly 1 line.

CRITICAL RULES:
- Output EXACTLY 1 line
- One sentence summarizing the main topic (max 100 characters)
- No quotes, no labels, no bullet points, no explanations
- Write in plain, natural language

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

Generate a 1-line description for the call supplied by the user.
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

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

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

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

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

interface TranscriptPostProcessOptions {
  callId?: string;
  abortSignal?: AbortSignal;
}

export class TranscriptService {
  private transcriptStorage: StorageService;

  constructor() {
    this.transcriptStorage = getStorageService(config.gcs.transcriptionBucketName);
    logger.info(
      `TranscriptService initialized with transcript bucket: ${config.gcs.transcriptionBucketName}`
    );
  }

  /**
   * Create a fresh Agent instance for each request
   * This prevents state pollution and BUSY errors between concurrent requests
   */
  private async createAgent(callId?: string): Promise<Agent | null> {
    try {
      const userId = await this.getCreatedByUserIdForCall(callId);
      const credential = await orgLLMCredentialService.getCredentialByUserId(
        userId,
        OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT,
      );

      if (!credential) {
        logger.warn('Org LiteLLM credentials not configured. AI features will be disabled.', {
          userId,
        });
        return null;
      }

      const agentConfig = {
        model: {
          provider: {
            type: 'litellm' as const,
            config: {
              apiKey: credential.apiKey,
              baseUrl: credential.baseUrl,
              timeout: 300000,
            },
          },
          defaultModel: credential.defaultModel || config.llm.callLitellmModel || 'glm-latest',
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
          errorHandling: {
            maxRetries: 3,
            retryDelay: 120000,
            maxDelay: 960000,
          },
        },
        events: {
          logging: 'warn' as const,
        },
      }
      return Agent.create(agentConfig);
    } catch (error) {
      logger.error('ticket_suggestions_agent_creation_failed', {
        error: error instanceof Error ? error.message : String(error),
        callId: callId || 'unknown',
      });
      return null;
    }
  }

  private async getCreatedByUserIdForCall(callId: string | null | undefined): Promise<string | null> {
    if (!callId) {
      return null;
    }

    const call = await repositories.calls.findByExternalId(callId);
    return call?.createdByUserId ?? null;
  }

  /**
   * Main entry point - attach transcript to existing call message when call ends
   * @param callId - The external call ID
   * @param messageId - The message ID of the call message from frontend
   */
  async postCallTranscript(callId: string, messageId: string): Promise<void> {
    try {
      logger.info('transcript_processing_started', { callId, message_id: messageId });

      // 0. Check if transcript attachment already exists for this CALL (not just this message)
      // This handles cases where multiple messages might be created for the same call
      const existingTranscriptAttachment =
        await repositories.messageAttachments.findTranscriptByCallId(callId);

      const isUpdate = !!existingTranscriptAttachment;
      if (isUpdate) {
        logger.info('transcript_attachment_exists', {
          callId,
          attachment_id: existingTranscriptAttachment.id,
        });
      }

      // 1. Get call details
      logger.info('call_lookup_started', { callId });
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error('call_not_found', { callId });
        return;
      }
      logger.info('call_found', { callId, call_status: call.status, created_by: call.createdByUserId });

      // Get channel for workspaceId
      if (!call.channelId) {
        logger.error('channel_id_missing', { callId });
        return;
      }
      const channel = await repositories.channels.findById(call.channelId);
      if (!channel) {
        logger.error('channel_not_found', { callId, channel_id: call.channelId });
        return;
      }

      // Note: Status check removed - webhook only fires when room disconnects,
      // which means all users have left (agent is always the last to leave)

      // 2. Get the call message to retrieve conversationId
      logger.info('message_lookup_started', { callId, message_id: messageId });
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.warn('message_not_found', { callId, message_id: messageId });
        return;
      }
      logger.info('message_found', { callId, message_id: messageId, conversation_id: callMessage.conversationId });

      // 3. Retrieve transcript from GCS or local file
      const transcriptContent = await this.retrieveTranscript(callId);

      if (!transcriptContent) {
        logger.error('transcript_file_not_found', { callId });
        throw new Error(`Transcript file not found for call: ${callId}`);
      }

      // 4. Parse JSONL entries
      logger.info('transcript_parsing_started', { callId });
      const entries = this.parseTranscriptEntries(transcriptContent, callId);
      if (entries.length === 0) {
        logger.error('transcript_parsing_failed', { callId, entries_count: 0 });
        throw new Error(`No valid transcript entries found for call: ${callId}`);
      }
      const uniqueSpeakers = new Set(entries.map((e) => e.user)).size;
      logger.info('transcript_parsed', { callId, entries_count: entries.length, speakers_count: uniqueSpeakers });

      // 5. Format as plain text (usernames are already included in transcript entries)
      logger.info('transcript_formatting_started', { callId, format: 'plain_text' });
      const formattedTranscript = this.formatTranscript(entries, callId);
      logger.info('transcript_formatted', { callId, format: 'plain_text', characters_count: formattedTranscript.length });

      // 6. Upload raw formatted transcript immediately (no translation yet - non-blocking)
      const txtStoragePath = await this.uploadFormattedTranscript(callId, formattedTranscript);

      // 7. Keep the original JSONL file for debugging/archival purposes
      // Note: Not deleting the JSONL file as it may be useful for troubleshooting

      // 8. Use plain path (storage abstraction handles bucket routing)
      const storagePath = txtStoragePath;

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
          url: storagePath,
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
        logger.info('transcript_attachment_updated', {
          callId,
          attachment_id: existingTranscriptAttachment.id,
          version: currentVersion + 1,
          message_id: messageId,
        });
      } else {
        logger.info('attachment_creation_started', { callId, message_id: messageId, attachment_type: 'transcript' });
        const attachment = await repositories.messageAttachments.create({
          entityId: messageId,
          entityType: AttachmentEntityType.CHAT,
          originalFilename: `call_transcript.txt`,
          size: formattedTranscript.length,
          mimetype: 'text/plain',
          url: storagePath,
          uploadedByUserId: call.createdByUserId,
          createdBy: call.createdByUserId,
          storageProvider: config.fileStorage.provider,
          conversationId: callMessage.conversationId,
          workspaceId: channel.workspaceId,
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
        logger.info('attachment_created', { callId, attachment_id: attachment.id, path: storagePath });
      }

      // 11. Save transcript URL to Call record for easier access (used by recordings feature)
      await repositories.calls.update(call.id, {
        transcript: storagePath,
      });
      logger.info('call_record_updated', { callId, fields_updated: 'transcript' });

      // 12. Update the call message to indicate it has an attachment
      await repositories.messages.update(messageId, {
        hasAttachment: true,
      });

      logger.info('transcript_processing_completed', { callId, message_id: messageId });

      // 13. Fire-and-forget: Translate transcript asynchronously in background
      // This updates the same GCS file without blocking the response
      this.translateTranscriptAsync(callId, txtStoragePath).catch((err) => {
        logger.error('background_translation_failed', { callId, error: err });
      });

      // 14. Attach identified transcript (real-name labelled) as a second attachment when available.
      // Written by the Python agent's RealtimeIdentifier during the call into
      // transcriptions/{callId}_identified.jsonl — may not exist if no voiceprints were enrolled.
      void this.attachIdentifiedTranscriptIfExists(callId, messageId, call.createdByUserId, callMessage.conversationId, channel.workspaceId);
    } catch (error) {
      logger.error('transcript_processing_failed', { callId, message_id: messageId, error: error, stack: error instanceof Error ? error.stack : undefined });
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
    const storagePath = `transcriptions/${callId}.jsonl`;
    try {
      logger.info('transcript_fetch_started', { callId, path: storagePath });

      const exists = await this.transcriptStorage.fileExists(storagePath);

      if (!exists) {
        logger.error('transcript_download_failed', { callId, error: 'file_not_found', path: storagePath });
        throw new Error(`Transcript file not found: ${storagePath}`);
      }

      logger.info('transcript_download_started', { callId });
      const downloadStart = Date.now();
      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);
      logger.info('transcript_download_completed', { callId, bytes_downloaded: buffer.length, duration_ms: Date.now() - downloadStart });
      return buffer.toString('utf-8');
    } catch (error) {
      logger.error('transcript_download_failed', { callId, error: error, path: storagePath, stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }

  /**
   * Parse JSONL content into transcript entries
   */
  private parseTranscriptEntries(jsonlContent: string, callId?: string): TranscriptEntry[] {
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
        logger.warn('transcript_jsonl_line_malformed', {
          callId: callId ?? 'unknown',
          error: error instanceof Error ? error.message : String(error),
        });
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

    logger.info('transcript_consolidated', { callId, original_entries: entries.length, consolidated_entries: consolidated.length });
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

    logger.info('transcript_upload_started', { callId, type: 'formatted_transcript', path: filepath });

    await this.transcriptStorage.uploadFileV2(buffer, {
      path: filepath,
      contentType: 'text/plain',
      metadata: { callId, type: 'transcript' },
    });

    logger.info('transcript_upload_completed', { callId, type: 'formatted_transcript', path: filepath });
    return filepath;
  }

  private async isSpeakerIdentificationEnabled(): Promise<boolean> {
    const cfg = await CacConfigService.fetch(SPEAKER_IDENTIFICATION_CAC_KEY) as { enabled?: boolean } | null;
    return cfg?.enabled === true;
  }

  /**
   * Check if the Python agent wrote an identified transcript for this call, and if so
   * format it and attach it as a second message attachment.
   * Fire-and-forget — call errors are logged but do not affect the primary transcript.
   */
  private async attachIdentifiedTranscriptIfExists(
    callId: string,
    messageId: string,
    createdByUserId: string,
    conversationId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      const speakerIdentificationEnabled = await this.isSpeakerIdentificationEnabled();
      if (!speakerIdentificationEnabled) {
        logger.info('identified_transcript_skipped', { callId, reason: 'speaker_identification_disabled' });
        return;
      }

      const identifiedGcsPath = `transcriptions/${callId}_identified.jsonl`;
      const exists = await this.transcriptStorage.fileExists(identifiedGcsPath);
      if (!exists) {
        logger.info('identified_transcript_not_found', { callId, action: 'skip_attachment' });
        return;
      }

      const buffer = await this.transcriptStorage.getFileBuffer(identifiedGcsPath);
      const entries = this.parseTranscriptEntries(buffer.toString('utf-8'), callId);
      if (entries.length === 0) return;

      const formatted = this.formatTranscript(entries, callId);

      // Upload formatted identified transcript
      const formattedPath = `attachments/${callId}_identified_formatted.txt`;
      await this.transcriptStorage.uploadFileV2(Buffer.from(formatted, 'utf-8'), {
        path: formattedPath,
        contentType: 'text/plain',
        metadata: { callId, type: 'identified_transcript' },
      });
      const gcsUrl = `gs://${config.gcs.transcriptionBucketName}/${formattedPath}`;

      const durationSeconds = entries.length > 1
        ? Math.round(entries[entries.length - 1].timestamp - entries[0].timestamp)
        : 0;
      const uniqueParticipants = Array.from(new Set(entries.map((e) => e.user))).filter(Boolean);

      // Upsert: update existing identified attachment or create new one
      const existing = await repositories.messageAttachments.findIdentifiedTranscriptByCallId(callId);
      if (existing) {
        await repositories.messageAttachments.update(existing.id, {
          url: gcsUrl,
          size: formatted.length,
          metadata: {
            callId,
            type: 'identified_transcript',
            duration: durationSeconds,
            participantCount: uniqueParticipants.length,
            version: ((existing.metadata as any)?.version ?? 1) + 1,
            lastUpdatedAt: new Date().toISOString(),
            entryCount: entries.length,
          },
        });
        logger.info('identified_transcript_attachment_updated', { callId, attachment_id: existing.id });
      } else {
        const attachment = await repositories.messageAttachments.create({
          entityId: messageId,
          entityType: AttachmentEntityType.CHAT,
          workspaceId,
          originalFilename: `call_identified_transcript.txt`,
          size: formatted.length,
          mimetype: 'text/plain',
          url: gcsUrl,
          uploadedByUserId: createdByUserId,
          createdBy: createdByUserId,
          storageProvider: 'gcs',
          conversationId,
          metadata: {
            callId,
            type: 'identified_transcript',
            duration: durationSeconds,
            participantCount: uniqueParticipants.length,
            version: 1,
            createdAt: new Date().toISOString(),
            entryCount: entries.length,
          },
        });
        logger.info('identified_transcript_attachment_created', { callId, attachment_id: attachment.id });
      }

      // Apply the same background translation as the plain transcript
      this.translateIdentifiedTranscriptAsync(callId, formattedPath).catch((err) => {
        logger.error('identified_background_translation_failed', { callId, error: err });
      });
    } catch (err) {
      logger.error('identified_transcript_attach_failed', { callId, error: err });
    }
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

      const formattedExists = await this.transcriptStorage.fileExists(formattedPath);

      if (formattedExists) {
        const buffer = await this.transcriptStorage.getFileBuffer(formattedPath);
        return buffer.toString('utf-8');
      }

      // Fall back to raw JSONL and format it
      const rawContent = await this.retrieveTranscript(callId);
      if (!rawContent) {
        return null;
      }

      const entries = this.parseTranscriptEntries(rawContent, callId);
      if (entries.length === 0) {
        return null;
      }

      return this.formatTranscript(entries, callId);
    } catch (error) {
      logger.error('transcript_content_get_failed', {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch the real-time identified transcript (written by the Python agent during the call).
   * Reads transcriptions/{callId}_identified.jsonl from GCS and formats it.
   * Returns null if the file does not exist (call had no enrolled speakers or feature
   * was not yet active when the call ran).
   */
  async getIdentifiedTranscriptContent(callId: string): Promise<string | null> {
    try {
      // Try pre-formatted file first (faster, no re-parsing)
      const formattedPath = `attachments/${callId}_identified_formatted.txt`;
      const formattedExists = await this.transcriptStorage.fileExists(formattedPath);
      if (formattedExists) {
        const buf = await this.transcriptStorage.getFileBuffer(formattedPath);
        return buf.toString('utf-8');
      }

      // Fall back to raw JSONL
      const gcsPath = `transcriptions/${callId}_identified.jsonl`;
      const exists = await this.transcriptStorage.fileExists(gcsPath);
      if (!exists) return null;
      const buffer = await this.transcriptStorage.getFileBuffer(gcsPath);
      const entries = this.parseTranscriptEntries(buffer.toString('utf-8'), callId);
      if (entries.length === 0) return null;
      return this.formatTranscript(entries, callId);
    } catch (error) {
      logger.error('identified_transcript_content_get_failed', {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
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
  async downloadFormattedTranscript(callId: string, storagePath: string): Promise<Buffer | null> {
    try {
      logger.info('formatted_transcript_download_started', {
        callId,
        path: storagePath,
        bucket: config.gcs.transcriptionBucketName,
      });

      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);

      return buffer;
    } catch (error) {
      logger.error('formatted_transcript_download_failed', {
        callId,
        path: storagePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Translate transcript asynchronously in background (fire-and-forget)
   * Downloads raw transcript from GCS, translates it, and overwrites the same file
   * @param callId - The external call ID
   * @param gcsPath - The GCS path to the transcript file
   */
  private async translateTranscriptAsync(callId: string, storagePath: string): Promise<void> {
    try {
      logger.info('background_translation_started', { callId });

      // 1. Download raw transcript
      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);
      const rawTranscript = buffer.toString('utf-8');

      // 2. Translate the transcript
      const translatedTranscript = await this.postProcessTranscript(rawTranscript, { callId });

      // 3. Re-upload translated version (overwrites the same file)
      await this.transcriptStorage.uploadFileV2(Buffer.from(translatedTranscript, 'utf-8'), {
        path: storagePath,
        contentType: 'text/plain',
        metadata: { callId, type: 'transcript', translated: 'true' },
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
        logger.info('transcript_attachment_metadata_updated', {
          callId,
          attachment_id: transcriptAttachment.id,
        });
      } else {
        logger.warn('transcript_attachment_not_found', { callId });
      }

      logger.info('background_translation_completed', { callId });
    } catch (error) {
      logger.error('background_translation_failed', {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Same as translateTranscriptAsync but for the identified transcript GCS file.
   * Overwrites the identified formatted .txt with the translated version.
   */
  private async translateIdentifiedTranscriptAsync(callId: string, gcsPath: string): Promise<void> {
    try {
      logger.info('identified_translation_started', { callId });

      const buffer = await this.transcriptStorage.getFileBuffer(gcsPath);
      const rawTranscript = buffer.toString('utf-8');

      const translatedTranscript = await this.postProcessTranscript(rawTranscript, { callId });

      await this.transcriptStorage.uploadFileV2(Buffer.from(translatedTranscript, 'utf-8'), {
        path: gcsPath,
        contentType: 'text/plain',
        metadata: { callId, type: 'identified_transcript', translated: 'true' },
      });

      logger.info('identified_translation_completed', { callId });
    } catch (error) {
      logger.error('identified_translation_failed', { callId, error });
    }
  }

  /**
   * Post-process transcript: translate to English
   * Handles long transcripts by chunking them into smaller pieces
   * @param transcript - The formatted transcript text
   * @returns Post-processed transcript or original if processing fails
   */
  async postProcessTranscript(
    transcript: string,
    options: TranscriptPostProcessOptions = {},
  ): Promise<string> {
    const systemInstructions = `You are processing a call transcript. Your task is to translate any non-English text to English, and to fix one specific brand name spelling.

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

BRAND NAME CORRECTION:
- The word "Xyne" (a product/brand name, pronounced like "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any of word that phonetically sounds like XYNE appear as a standalone word or as part of a compound like "Zain Spaces", "Zine Calls", etc., replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls"), not when it is part of an unrelated proper noun or personal name

Output ONLY the processed transcript, nothing else.`;

    try {
      const lines = transcript.split('\n').filter((l) => l.trim());
      const MAX_LINES_PER_CHUNK = 100;

      if (lines.length <= MAX_LINES_PER_CHUNK) {
        const translated = await executeStreamingLlmRequest({
          userPrompt: transcript,
          systemPrompt: systemInstructions,
          operation: 'transcript_translation',
          callId: options.callId,
          abortSignal: options.abortSignal,
        });

        if (!translated.ok) {
          logger.warn('post_process_transcript_failed', {
            callId: options.callId ?? 'unknown',
            reason: translated.reason,
            using_original: true,
          });
          return transcript;
        }

        logger.info('post_process_transcript_completed', {
          callId: options.callId ?? 'unknown',
        });
        return translated.content;
      }

      // For long transcripts, process in chunks with LIMITED CONCURRENCY
      const CHUNK_CONCURRENCY = 3;
      const totalChunks = Math.ceil(lines.length / MAX_LINES_PER_CHUNK);

      logger.info('transcript_chunking_started', {
        callId: options.callId ?? 'unknown',
        lines_count: lines.length,
        max_lines_per_chunk: MAX_LINES_PER_CHUNK,
        concurrency: CHUNK_CONCURRENCY,
      });

      // Build chunk metadata
      const chunks: Array<{ chunkText: string; chunkIndex: number; startLine: number; endLine: number }> = [];
      for (let i = 0; i < lines.length; i += MAX_LINES_PER_CHUNK) {
        const chunkLines = lines.slice(i, i + MAX_LINES_PER_CHUNK);
        chunks.push({
          chunkText: chunkLines.join('\n'),
          chunkIndex: Math.floor(i / MAX_LINES_PER_CHUNK) + 1,
          startLine: i + 1,
          endLine: i + chunkLines.length,
        });
      }

      // Process with concurrency limit using worker pool pattern
      const results: string[] = new Array(chunks.length);
      let nextIndex = 0;

      const processChunk = async (chunk: typeof chunks[0], index: number): Promise<void> => {
        logger.info('transcript_chunk_processing_started', {
          callId: options.callId ?? 'unknown',
          chunk: `${chunk.chunkIndex}/${totalChunks}`,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
        });

        try {
          const translated = await executeStreamingLlmRequest({
            userPrompt: chunk.chunkText,
            systemPrompt: systemInstructions,
            operation: 'transcript_translation',
            callId: options.callId,
            abortSignal: options.abortSignal,
          });

          if (!translated.ok) {
            logger.warn('post_process_chunk_failed', {
              callId: options.callId ?? 'unknown',
              chunk: `${chunk.chunkIndex}/${totalChunks}`,
              reason: translated.reason,
              using_original: true,
            });
            results[index] = chunk.chunkText;
            return;
          }

          logger.info('transcript_chunk_processing_completed', {
            callId: options.callId ?? 'unknown',
            chunk: `${chunk.chunkIndex}/${totalChunks}`,
          });
          results[index] = translated.content;
        } catch (error) {
          logger.error('transcript_chunk_processing_error', {
            callId: options.callId ?? 'unknown',
            chunk: `${chunk.chunkIndex}/${totalChunks}`,
            error: error instanceof Error ? error.message : String(error),
          });
          results[index] = chunk.chunkText;
        }
      };

      const workers = Array.from(
        { length: Math.min(CHUNK_CONCURRENCY, chunks.length) },
        async () => {
          while (nextIndex < chunks.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await processChunk(chunks[currentIndex], currentIndex);
          }
        }
      );

      await Promise.all(workers);

      const processedChunks = results;
      const processedTranscript = processedChunks.join('\n');
      logger.info('post_process_transcript_chunks_completed', {
        callId: options.callId ?? 'unknown',
        chunks_count: processedChunks.length,
        mode: 'parallel_translation',
        concurrency: CHUNK_CONCURRENCY,
      });
      return processedTranscript;
    } catch (error) {
      logger.error('post_process_transcript_error', {
        callId: options.callId ?? 'unknown',
        error: error instanceof Error ? error.message : String(error),
      });
      return transcript; // Fallback to original if processing fails
    }
  }

  /** Generate an AI summary from the formatted transcript. */
  async generateCallSummary(transcript: string, callId?: string): Promise<string | null> {
    const result = await executeStreamingLlmRequest({
      userPrompt: transcript,
      systemPrompt: CALL_SUMMARY_SYSTEM_PROMPT,
      operation: 'call_summary',
      callId,
    });

    if (!result.ok) {
      return null;
    }

    return result.content;
  }

  /**
   * Generate a short AI title from transcript.
   * @param transcript - The formatted transcript text
   * @returns AI-generated title (max 100 chars) or null if generation fails
   */
  async generateCallTitle(transcript: string, callId?: string): Promise<string | null> {
    const result = await executeStreamingLlmRequest({
      userPrompt: transcript,
      systemPrompt: CALL_TITLE_SYSTEM_PROMPT,
      operation: 'call_title',
      callId,
    });

    if (!result.ok) {
      return null;
    }

    return result.content.substring(0, 100);
  }

  /**
   * Generate a title for a call based on conversation messages
   */
  async generateCallTitleFromConversation(conversationId: string, callId?: string): Promise<string | null> {
    const formatted = await this.formatConversationMessagesForTitle(conversationId);
    return formatted ? await this.generateCallTitle(formatted, callId) : null;
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
   * Generate ticket suggestions from call transcript and summary
   * @param transcript - The formatted transcript text
   * @returns Array of ticket suggestions or empty array if generation fails
   */
  async generateTicketSuggestions(transcript: string, callId?: string): Promise<TicketSuggestion[]> {
    const logCallId = callId || 'unknown';
    const agent = await this.createAgent(logCallId);
    if (!agent) {
      logger.error('ticket_suggestions_generation_failed', {
        callId: logCallId,
        reason: 'agent_creation_failed',
      });
      return [];
    }

    const prompt = TICKET_SUGGESTIONS_PROMPT.replace('{transcript}', transcript).replace(
      '{summary}',
      'Summary not available (analyze transcript directly)'
    );

    try {
      const startedAt = Date.now();
      logger.info(`ticket_suggestions_started`, {
        callId: logCallId,
        input_length: prompt.length,
        has_system_prompt: true,
      });

      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      const extracted = extractAgentContent(result);
      if (!extracted.ok) {
        logger.error('ticket_suggestions_generation_failed', {
          callId: logCallId,
          reason: extracted.reason,
          status: extracted.status ?? result.status,
        });
        return [];
      }

      logger.info(`ticket_suggestions_success`, {
        callId: logCallId,
        duration_ms: Date.now() - startedAt,
      });

      let jsonContent = extracted.content;

      // Strip markdown code fences if present (```json...``` or ```...```)
      const codeBlockMatch = jsonContent.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        jsonContent = codeBlockMatch[1].trim();
      }

      // Parse JSON response
      const parsed = JSON.parse(jsonContent);

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        logger.error('ticket_suggestions_generation_failed', {
          callId: logCallId,
          reason: 'invalid_format',
          parsed,
        });
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

      logger.info('ticket_suggestions_generated', {
        callId: logCallId,
        suggestions_count: suggestions.length,
      });
      return suggestions;
    } catch (error) {
      logger.error('ticket_suggestions_generation_failed', {
        callId: logCallId,
        error: error instanceof Error ? error.message : String(error),
      });
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
    transcript: string,
    callId?: string,
  ): Promise<Array<{ merchantName: string; actionItems: PulseActionItem[] }>> {
    if (config.pulse.enabledChannels.length === 0) return [];
    const logCallId = callId || 'unknown';

    const agent = await this.createAgent(logCallId);
    if (!agent) {
      logger.error('pulse_data_generation_failed', {
        callId: logCallId,
        reason: 'agent_creation_failed',
      });
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
      const startedAt = Date.now();
      logger.info(`pulse_data_started`, {
        callId: logCallId,
        input_length: prompt.length,
        has_system_prompt: true,
      });

      const result = await agent.execute({ messages: [createUserMessage(prompt)] });

      const extracted = extractAgentContent(result);
      if (!extracted.ok) {
        logger.error('pulse_data_generation_failed', {
          callId: logCallId,
          reason: extracted.reason,
          status: extracted.status ?? result.status,
        });
        return [];
      }

      logger.info(`pulse_data_success`, {
        callId: logCallId,
        duration_ms: Date.now() - startedAt,
      });

      let jsonContent = extracted.content;
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

      logger.info('pulse_data_generated', {
        callId: logCallId,
        merchants_count: groups.length,
      });
      return groups;
    } catch (error) {
      logger.error('pulse_data_generation_failed', {
        callId: logCallId,
        error: error instanceof Error ? error.message : String(error),
      });
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
    logger.info('post_summary_reply_started', {
      callId,
      conversation_id: conversationId,
    });

    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const channel = await db.channel.findUnique({
      where: { id: conversation.channelId },
      select: { workspaceId: true }
    });
    if (!channel?.workspaceId) {
      throw new Error('Channel workspace not found');
    }

    let xyneAutomaticBot;
    try {
      xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
    } catch (error) {
      logger.error('xyne_automatic_bot_retrieval_failed', { callId, error: JSON.stringify(error) });
      throw new Error(`Failed to retrieve bot user: ${JSON.stringify(error)}`);
    }

    if (!xyneAutomaticBot) {
      logger.error('xyne_automatic_bot_not_found', { callId });
      throw new Error('Xyne Automatic bot not found');
    }

    logger.info('post_summary_reply_bot_found', {
      callId,
      bot_id: xyneAutomaticBot.id,
      bot_email: xyneAutomaticBot.email,
    });

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
      logger.info('summary_message_updated', {
        callId,
        message_id: existingSummary.messageId,
        version: currentVersion + 1,
      });
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
      logger.info('summary_message_created', {
        callId,
        message_id: summaryMessage.messageId,
        conversation_id: conversationId,
      });
    }

    // ── 3. Post ticket suggestions as batched separate messages ──────────────
    // Update existing ticket messages in place (preserves chat position).
    // Delete extras if batch count shrinks. Create new ones if it grows.
    getCallTicketSuggestionsTotal().add(ticketSuggestions?.length ?? 0, { workspaceId: channel.workspaceId });
    if (ticketSuggestions && ticketSuggestions.length > 0) {
      const BATCH_SIZE = 10;

      const batches: TicketSuggestion[][] = [];
      for (let i = 0; i < ticketSuggestions.length; i += BATCH_SIZE) {
        batches.push(ticketSuggestions.slice(i, i + BATCH_SIZE));
      }

      logger.info('suggested_ticket_batches_posting_started', {
        callId,
        tickets_count: ticketSuggestions.length,
        batches_count: batches.length,
        batch_size: BATCH_SIZE,
      });

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
          logger.info('suggested_ticket_batch_message_updated', {
            callId,
            message_id: existing.messageId,
            batch: `${batchIndex + 1}/${batches.length}`,
          });
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
          logger.info('suggested_ticket_batch_message_created', {
            callId,
            message_id: batchMessage.messageId,
            batch: `${batchIndex + 1}/${batches.length}`,
          });
        }
      }

      // Fewer batches than before — delete the now-unused extra messages
      if (existingTicketMessages.length > batches.length) {
        const extras = existingTicketMessages.slice(batches.length);
        for (const extra of extras) {
          await repositories.messages.delete(extra.messageId);
          logger.info('suggested_ticket_batch_message_deleted', {
            callId,
            message_id: extra.messageId,
          });
        }
      }
    }

    logger.info('post_summary_reply_completed', { callId });
  }

  private async postNotesCanvasReplyIfPresent(conversationId: string, callId: string): Promise<void> {
    try {
      const call = await repositories.calls.findByExternalId(callId);
      const notesCanvasId = (call?.metadata as Record<string, unknown> | null)
        ?.notesCanvasId;

      if (typeof notesCanvasId !== 'string' || !notesCanvasId) {
        return;
      }

      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      const channel = await db.channel.findUnique({
        where: { id: conversation.channelId },
        select: { workspaceId: true },
      });
      if (!channel?.workspaceId) {
        throw new Error('Channel workspace not found');
      }

      await callDocumentService.postNotesCanvasToConversation(
        conversationId,
        callId,
        getCanvasUrl(notesCanvasId),
        channel.workspaceId,
      );
    } catch (notesError) {
      logger.warn('notes_canvas_post_failed', {
        callId,
        error: notesError instanceof Error ? notesError.message : String(notesError),
      });
    }
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
  /**
   * Fallback transcript processing, triggered from the LiveKit `room_finished` webhook
   * after a short grace. It exists for the case where the agent's `transcript-ready`
   * webhook never arrives — e.g. the transcription agent was OOM/SIGKILLed mid-call —
   * so whatever it had already streamed to GCS still gets turned into the call summary.
   *
   * Deduped against the webhook via the transcript attachment's `entryCount`: we only
   * (re)process when GCS holds MORE transcript lines than we last persisted. That skips
   * the costly LLM work (summary/title/tickets) when the webhook already processed the
   * same-or-newer content, while still guaranteeing no trailing events are dropped — a
   * later webhook carrying a larger transcript will re-process and supersede a partial
   * reconciliation (the webhook path is intentionally left unguarded for that reason).
   */
  async reconcileTranscriptFromGcs(callId: string): Promise<void> {
    try {
      // Locate the call system message (same lookup the transcript-ready webhook uses).
      const callMessage = await repositories.messages.findHeadMessageByCallId(callId);
      if (!callMessage) {
        logger.info('transcript_reconcile_skipped', { callId, reason: 'no_call_message' });
        return;
      }

      // What GCS currently holds (whatever the agent streamed before it stopped).
      // Treat a missing/failed fetch as "nothing to reconcile" rather than an error.
      let content: string | null = null;
      try {
        content = await this.retrieveTranscript(callId);
      } catch (retrieveError) {
        // A GCS fetch failure is not the same as "the agent never wrote a transcript":
        // log it so a transient storage error is distinguishable from an empty transcript.
        logger.error('transcript_reconcile_retrieve_failed', {
          callId,
          error: retrieveError,
          stack: retrieveError instanceof Error ? retrieveError.stack : undefined,
        });
        content = null;
      }
      if (!content) {
        logger.info('transcript_reconcile_skipped', { callId, reason: 'no_gcs_transcript' });
        return;
      }
      const currentCount = this.parseTranscriptEntries(content).length;

      // What we last processed, read from the existing attachment's entryCount metadata.
      const existing = await repositories.messageAttachments.findTranscriptByCallId(callId);
      const storedCount =
        (existing?.metadata as TranscriptAttachmentMetadata | null)?.entryCount ?? -1;

      if (currentCount <= storedCount) {
        logger.info('transcript_reconcile_skipped', {
          callId,
          reason: 'already_processed',
          gcs_entry_count: currentCount,
          stored_entry_count: storedCount,
        });
        return;
      }

      logger.info('transcript_reconcile_processing', {
        callId,
        gcs_entry_count: currentCount,
        stored_entry_count: storedCount,
        message_id: callMessage.messageId,
      });
      await this.processCallWithSummary(callId, callMessage.messageId, true);
    } catch (error) {
      logger.error('transcript_reconcile_failed', {
        callId,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  async processCallWithSummary(
    callId: string,
    messageId: string,
    hasTranscript: boolean = true
  ): Promise<void> {
    // Serialize processing per call. The room_finished reconcile (deferred ~30s) can still
    // race the agent's transcript-ready webhook — itself fired twice (initial + post-STT-drain)
    // — so up to three runs can hit the same callId at once. The summary/attachment/ticket writes
    // are check-then-create; run concurrently they each see "nothing exists" and duplicate
    // rows. Serialized sequential re-runs are idempotent (upsert-with-version-bump), so we
    // WAIT for the lock rather than skip — a later, larger transcript still reprocesses in
    // order without dropping content.
    const lockHandle = await acquireLock(`lock:transcript-processing:${callId}`, {
      ttlSeconds: 180,
      waitTimeoutMs: 30_000,
      retryDelayMs: 300,
    });
    if (!lockHandle) {
      logger.warn('process_call_with_summary_lock_timeout', {
        callId,
        message_id: messageId,
        reason: 'another worker held the processing lock beyond the wait window',
      });
      return;
    }

    try {
      // Get call details for summary generation and notes posting.
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error('call_not_found', { callId, context: 'summary_generation' });
        return;
      }

      // Get the call message to retrieve conversationId for the reply
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.error('message_not_found', { callId, message_id: messageId, context: 'summary_generation' });
        return;
      }

      await this.postNotesCanvasReplyIfPresent(callMessage.conversationId, callId);

      if (!hasTranscript) {
        logger.warn('transcript_processing_skipped', { callId, reason: 'agent_reported_no_transcript' });
        return;
      }

      // First, process the transcript (existing functionality)
      // Wrap individually so a GCS/DB failure here produces a stage-labelled log rather
      // than the generic process_call_with_summary_failed from the outer catch.
      try {
        await this.postCallTranscript(callId, messageId);
      } catch (transcriptError) {
        logger.error('post_transcript_failed', { callId, stage: 'post_call_transcript', error: transcriptError, stack: transcriptError instanceof Error ? transcriptError.stack : undefined });
        // Don't rethrow — retrieveTranscript below fetches raw content from GCS directly and
        // may still succeed even if the DB-side attachment step inside postCallTranscript failed.
      }

      // Retrieve and format transcript for AI.
      // For HEADLESS recordings, prefer the identified transcript (real speaker names)
      // so that summaries, titles, and ticket suggestions reflect who said what.
      // Fall back to plain transcript if identified is not yet available.
      const speakerIdentificationEnabled = await this.isSpeakerIdentificationEnabled();
      const isHeadless = call.callType === CallType.HEADLESS;
      let transcriptContent: string | null = null;
      if (speakerIdentificationEnabled && isHeadless) {
        transcriptContent = await this.getIdentifiedTranscriptContent(callId);
        if (transcriptContent) {
          logger.info('using_identified_transcript_for_summary', { callId, reason: 'headless_call' });
        } else {
          logger.warn('identified_transcript_unavailable', { callId, action: 'fallback_to_plain' });
        }
      }
      if (!transcriptContent) {
        transcriptContent = await this.retrieveTranscript(callId);
      }
      if (!transcriptContent) {
        logger.warn('ai_summary_skipped', { callId, reason: 'no_transcript_content' });
        return;
      }

      // getIdentifiedTranscriptContent returns already-formatted text; retrieveTranscript
      // returns raw JSONL that still needs parsing and formatting.
      let formattedTranscript: string;
      if (speakerIdentificationEnabled && isHeadless && transcriptContent.startsWith('[')) {
        // Already formatted ("[MM:SS] Speaker: text" lines) — use directly
        formattedTranscript = transcriptContent;
      } else {
        const entries = this.parseTranscriptEntries(transcriptContent, callId);
        if (entries.length === 0) {
          logger.warn('ai_summary_skipped', { callId, reason: 'no_transcript_entries' });
          return;
        }
        formattedTranscript = this.formatTranscript(entries, callId);
      }

      // For CONVERSATION origin calls, combine conversation messages with transcript for title
      let titleInput = formattedTranscript;
      if (call.callOrigin === CallOrigin.CONVERSATION && callMessage.conversationId) {
        const conversationMessages = await this.formatConversationMessagesForTitle(callMessage.conversationId).catch(() => null);
        if (conversationMessages) {
          titleInput = `CONVERSATION CONTEXT:\n${conversationMessages}\n\nCALL TRANSCRIPT:\n${formattedTranscript}`;
        }
      }

      const startTime = Date.now();

      // Skip title generation for HEADLESS recordings - users set title manually via recordings UI
      const skipTitleGeneration = call.callType === CallType.HEADLESS;
      if (skipTitleGeneration) {
        logger.info('title_generation_skipped', { callId, reason: 'headless_recording' });
      }
      const [summary, title, ticketSuggestions] = await Promise.all([
        this.generateCallSummary(formattedTranscript, callId).catch((err) => {
          logger.error('generate_summary_threw', { callId, error: err, stack: err instanceof Error ? err.stack : undefined });
          return null;
        }),
        skipTitleGeneration ? Promise.resolve(null) : this.generateCallTitle(titleInput, callId).catch((err) => {
          logger.error('generate_title_threw', { callId, error: err, stack: err instanceof Error ? err.stack : undefined });
          return null;
        }),
        this.generateTicketSuggestions(formattedTranscript, callId).catch((err) => {
          logger.error('generate_ticket_suggestions_threw', { callId, error: err, stack: err instanceof Error ? err.stack : undefined });
          return [];
        }),
      ]);

      const duration = Date.now() - startTime;
      logger.info('ai_generation_completed', {
        callId,
        duration_ms: duration,
        summary: !!summary,
        title: !!title,
        tickets_count: ticketSuggestions.length,
      });

      // If ALL three AI calls failed, escalate from per-call warns to a single error so
      // an LLM outage affecting every call is immediately visible rather than buried in warns.
      const aiFullyFailed = !summary && !title && ticketSuggestions.length === 0;
      if (aiFullyFailed) {
        logger.error('ai_generation_all_failed', { callId, summary: false, title: false, tickets: 0 });
      }

      if (summary) {
        // Save summary and title to call record.
        // Skip title update for HEADLESS recordings to preserve user-provided title.
        // Only set title from AI if the call doesn't already have one (scheduled calls have a pre-set title).
        const effectiveTitle = (title && !call.title) ? title : (call.title ?? null);
        // Wrap individually so a DB failure here is distinguishable from a transcript
        // post failure or a summary-post failure in the outer catch.
        try {
          await repositories.calls.update(call.id, {
            aiSummary: summary,
            ...(title && !call.title ? { title } : {}),
          });
          logger.info('call_record_updated', { callId, fields_updated: 'aiSummary' });
        } catch (updateError) {
          // P2025: call was deleted while summary was being generated — ignore gracefully
          if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === 'P2025') {
            logger.warn('call_deleted_before_summary_save', { callId, action: 'skip_update' });
            return;
          }
          logger.error('call_record_update_failed', { callId, stage: 'call_record_update', error: updateError, stack: updateError instanceof Error ? updateError.stack : undefined });
        }

        // Update recording attachment filename to use call title
        if (effectiveTitle) {
          void callRecordingService.updateRecordingFilename(callId, effectiveTitle);
        }

        // Update the call system message with the title (if generated)
        if (title && !skipTitleGeneration) {
          try {
            // Use Prisma transaction for atomic message update
            await db.$transaction(async (tx) => {
              // Fetch the message within the transaction
              const message = await tx.message.findUnique({
                where: { messageId },
              });

              if (message) {
                // Swap storage: message.content = AI description, metadata.callEndedText = original call text
                await tx.message.update({
                  where: { messageId },
                  data: {
                    content: title,
                    metadata: {
                      ...(message.metadata as any),
                      callTitle: title,
                      callEndedText: message.content,
                    },
                  },
                });

                logger.info('call_message_title_updated', { callId, message_id: messageId });
              } else {
                logger.warn('call_message_not_found_for_title_update', { callId, message_id: messageId });
              }
            });
          } catch (error) {
            logger.error('call_message_title_update_failed', {
              callId,
              message_id: messageId,
              error: error instanceof Error ? error.message : String(error),
            });
            // Don't fail the whole process if message update fails
          }
        }

        // Wrap individually — a bot-user-not-found or DB error here produces
        // post_summary_reply_failed rather than the generic process_call_with_summary_failed.
        try {
          await this.postSummaryAsReply(
            callMessage.conversationId,
            callId,
            summary,
            call.createdByUserId,
            ticketSuggestions
          );
        } catch (replyError) {
          logger.error('post_summary_reply_failed', { callId, stage: 'post_summary_reply', error: replyError, stack: replyError instanceof Error ? replyError.stack : undefined });
        }

        // Pulse block — completely separate from Xyne tickets.
        // Only activates when the call's channel is in PULSE_ENABLED_CHANNELS.
        if (config.pulse.enabledChannels.length > 0) {
          try {
            // Check if this call's channel is in the Pulse allowlist (by channel ID)
            const isPulseChannel = config.pulse.enabledChannels.includes(call.channelId ?? '');

            if (isPulseChannel) {
              logger.info('pulse_generation_started', { callId, channel_id: call.channelId });
              const pulseGroups = await this.generatePulseData(formattedTranscript, callId);
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
                    logger.warn('pulse_merchant_not_found', { callId, merchant_name: group.merchantName });
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
                logger.info('pulse_no_valid_merchant_actionables', { callId });
              }
            } else {
              logger.info('pulse_skipped_channel_not_allowlisted', { callId, channel_id: call.channelId });
            }
          } catch (err) {
            logger.error('pulse_tickets_post_failed', {
              callId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        try {
          await callDocumentService.generateAndPostDetailedSummary(
            callId,
            formattedTranscript,
            callMessage.conversationId
          );
          logger.info('detailed_summary_generated', { callId });
        } catch (error) {
          // Include stage label so LLM vs DB vs bot-message failures are distinguishable.
          logger.error('detailed_summary_failed', { callId, stage: 'detailed_summary_generation', error: error, stack: error instanceof Error ? error.stack : undefined });
        }
      } else {
        // Use error (not warn) so LLM-down conditions generate alertable signal.
        logger.error('ai_summary_skipped', { callId, reason: 'generation_failed' });
      }
    // Queue Vespa indexing for the transcript (using call.id as the identifier)
      try {
        const callChannel = call.channelId
          ? await db.channel.findUnique({ where: { id: call.channelId }, select: { workspaceId: true } })
          : null;
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: call.id,
          jobType: 'feed',
          userId: call.createdByUserId,
          app: SubApp.TRANSCRIPT,
          ...(callChannel?.workspaceId ? { workspaceId: callChannel.workspaceId } : {}),
        });
        logger.info('transcript_vespa_indexing_queued', { callId, call_db_id: call.id });
      } catch (vespaError) {
        logger.error('transcript_vespa_indexing_queue_failed', {
          callId,
          call_db_id: call.id,
          error: vespaError instanceof Error ? vespaError.message : String(vespaError),
        });
      }

    } catch (error) {
      logger.error('process_call_with_summary_failed', { callId, error: error, stack: error instanceof Error ? error.stack : undefined });
      // Don't re-throw - the transcript was already processed successfully
    } finally {
      await releaseLock(lockHandle);
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
    // Get conversation to retrieve workspaceId
    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      logger.error('pulse_conversation_not_found', { callId, conversation_id: conversationId });
      return;
    }

    // Get channel to retrieve workspaceId
    const channel = await db.channel.findUnique({
      where: { id: conversation.channelId },
      select: { workspaceId: true }
    });
    if (!channel?.workspaceId) {
      logger.error('pulse_channel_workspace_not_found', { callId, channel_id: conversation.channelId });
      return;
    }

    const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
    if (!xyneAutomaticBot) {
      logger.error('pulse_xyne_automatic_bot_not_found', { callId, workspace_id: channel.workspaceId });
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
    logger.info('pulse_actionables_message_posted', {
      callId,
      merchants_count: merchants.length,
      pulse_items_count: pulseItems.length,
    });
  }
}

export const transcriptService = new TranscriptService();
