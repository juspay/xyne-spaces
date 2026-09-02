import { repositories } from '@/database/repositories';
import { getCanvasUrl } from '@/services/canvasService';
import { logger } from '@/utils/logger';
import { Prisma } from '@prisma/client';
import { config } from '@/config/env';
import { Agent, createUserMessage } from '@framework';
import { extractAgentContent } from '@/utils/agentUtils';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType, OrgLLMServiceAccountPurpose, AttachmentEntityType, CallOrigin, CallType, TicketPriority } from '@xyne/shared';
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
import { executeCallLlmWithRetry, executeStreamingLlmRequest, type SummaryModelType } from './callLlmRetry';
import { callRecordingService } from '@/services/callRecordingService';
import { callDocumentService } from '@/services/callDocumentService';
import { logDetailedSummaryFailed } from '@/services/detailedSummaryFailureLog';
import { RECORDING_TITLE_PROMPT } from '@/services/recordingSummaryTemplates';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';

const SPEAKER_IDENTIFICATION_CAC_KEY = 'speaker_identification_config';

export interface TranscriptEntry {
  user: string;
  text: string;
  timestamp: number;
  participant_identity: string;
}

// Shape of the metadata stored on a transcript message attachment. Written in
// postCallTranscript/processCallWithSummary and read back by the reconcile dedup guard.
export interface TranscriptAttachmentMetadata {
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
const CALL_SUMMARY_PROMPT = `
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

CITATION RULES:
- The transcript is numbered: each line starts with [N] (e.g. "[1] [03:24] Alice: ...")
- After any claim, fact, or outcome derived from the transcript, append a citation token [clf-N]
  where N is the segment number from the transcript line that supports the claim
- Place the token AFTER the word and BEFORE any trailing punctuation: "Revenue grew 12%[clf-3]."
- Multiple consecutive tokens are allowed for multi-segment support: "discussed the roadmap[clf-5][clf-8]"
- Cite at least one segment per key outcome and per action item when possible
- Do NOT cite the Summary overview section — it is too high-level for precise citations
- Do NOT invent segment numbers — only use numbers that appear in the transcript

CALL PARTICIPANTS:
- The call creator is: {callCreator}
- In the Participants section, append "{HOST}" immediately after that person's name if they are listed.
- Do not add the call creator to the Participants section if they are not otherwise a participant.

MARKDOWN TEMPLATE (FOLLOW EXACTLY):

## Summary:
[2-3 sentence overview of the call]

## Key outcomes:
1. [First key outcome or decision][clf-N]
2. [Second key outcome or decision][clf-N]
3. [Third key outcome or decision if applicable][clf-N]

## Action Items:
- [Action item 1][clf-N] or "None"
- [Action item 2 if applicable][clf-N]

## Participants:
- [Participant 1 name]
- [Participant 2 name]

Only output the Markdown above.
No extra text.

TRANSCRIPT:
{transcript}
`;

// AI Title prompt for call transcripts - Two lines, descriptive
const CALL_TITLE_PROMPT = `
You are summarizing the topic of a call in exactly 1 line.

CRITICAL RULES:
- Output EXACTLY 1 line
- One sentence summarizing the main topic (max 50 characters)
- No quotes, no labels, no bullet points, no explanations
- Write in plain, natural language

INSUFFICIENT TRANSCRIPT:
- Be VERY lenient here — only treat the transcript as insufficient if it is essentially empty: fewer than roughly 100 characters total, or just noise/silence/a single stray word with no real content.
- If the TRANSCRIPT has more than that — even a short exchange — treat it as enough to identify a topic and generate a real title as normal. Do not bail out just because a call was short.
- Only when the transcript is truly that tiny, output EXACTLY this and nothing else: Not enough content

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"
- Only apply this correction when the word is clearly a reference to the brand (e.g. "Xyne Spaces", "Xyne Calls")

Generate a 1-line description for this call:
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

// Short topical labels for browsing/search. Kept intentionally simple (no
// categories/config) — persisted as generic Tag rows by noteTakerTranscriptService.
// Each label is a single word; multi-word labels would be slugified into
// hyphenated tags downstream.
const MAX_CALL_LABELS = 3;

const CALL_LABELS_PROMPT = `
You are analyzing a call transcript to generate a small set of short topical labels/tags for browsing and search.

CRITICAL RULES:
- Output ONLY valid JSON
- Generate 1-3 short labels that best describe the topics/themes discussed
- Each label must be EXACTLY ONE word, lowercase (e.g. "pricing", "onboarding", "billing", "latency")
- NEVER use multi-word labels, spaces, hyphens or underscores (write "pricing", not "pricing-discussion" or "bug report")
- Do NOT include people's names, company names, or dates as labels
- Do NOT duplicate labels

BRAND NAME CORRECTION:
- The word "Xyne" (product name, pronounced "zine") is often misspelled by speech-to-text as "Zain", "Zine", "Xine", "Zyane", or "Zyne"
- When any word that phonetically sounds like "Xyne" appears, replace it with "Xyne"

JSON STRUCTURE (FOLLOW EXACTLY):
{
  "labels": ["[one-word topic label]", "[one-word topic label]"]
}

Only output valid JSON.
No explanations.

TRANSCRIPT:
{transcript}
`;

export interface TicketSuggestion {
  id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  suggestedAssignee: string;
  status: 'pending' | 'created' | 'dismissed';
  createdTicketId?: string;
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
  private async createAgent(callId?: string, modelType?: SummaryModelType): Promise<Agent | null> {
    try {
      const userId = await this.getCreatedByUserIdForCall(callId);
      const credential = await orgLLMCredentialService.getCredentialByUserId(
        userId,
        OrgLLMServiceAccountPurpose.CALL_TRANSCRIPT,
      );

      // Prefer the org-provisioned credential; fall back to the env-configured
      // CALL_LITELLM_API_KEY/LITELLM_BASE_URL (config.llm) when no org credential
      // exists yet (e.g. local/dev where AI provisioning never ran).
      const apiKey = credential?.apiKey || config.llm.callLitellmApiKey;
      const baseUrl = credential?.baseUrl || config.llm.litellmBaseUrl;
      // Model tier selection: when the fast/thinking env models are configured
      // they drive which model runs (that's the whole point of the per-user
      // preference); otherwise fall back to the org credential's model, then the
      // generic call model. `callRecordingFastLitellmModel`/`callRecordingThinkingLitellmModel`
      // themselves fall back to CALL_LITELLM_MODEL (see config/env.ts).
      const tierModel =
        modelType === 'thinking'
          ? config.llm.callRecordingThinkingLitellmModel
          : config.llm.callRecordingFastLitellmModel;
      const defaultModel =
        tierModel || credential?.defaultModel || config.llm.callLitellmModel || 'glm-private';

      if (!apiKey || !baseUrl) {
        logger.warn('Org LiteLLM credentials not configured and no CALL_LITELLM_API_KEY/LITELLM_BASE_URL env fallback set. AI features will be disabled.', {
          userId,
        });
        return null;
      }

      if (!credential) {
        logger.info('Using env-configured LiteLLM credentials (CALL_LITELLM_API_KEY/LITELLM_BASE_URL) — no org-provisioned credential found.', {
          userId,
        });
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
          defaultModel,
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
      };

      return Agent.create(agentConfig);
    } catch (error) {
      logger.error('Failed to create AI agent:', error);
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
      logger.info(`[${callId}] transcript_processing_started`, { message_id: messageId });

      // 0. Check if transcript attachment already exists for this CALL (not just this message)
      // This handles cases where multiple messages might be created for the same call
      const existingTranscriptAttachment =
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
      logger.info(`[${callId}] call_found`, { call_status: call.status, created_by: call.createdByUserId });

      // Get channel for workspaceId
      if (!call.channelId) {
        logger.error(`[${callId}] channel_id_missing`);
        return;
      }
      const channel = await repositories.channels.findById(call.channelId);
      if (!channel) {
        logger.error(`[${callId}] channel_not_found`, { channel_id: call.channelId });
        return;
      }

      // Note: Status check removed - webhook only fires when room disconnects,
      // which means all users have left (agent is always the last to leave)

      // 2. Get the call message to retrieve conversationId
      logger.info(`[${callId}] message_lookup_started`, { message_id: messageId });
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.warn(`[${callId}] message_not_found`, { message_id: messageId });
        return;
      }
      logger.info(`[${callId}] message_found`, { message_id: messageId, conversation_id: callMessage.conversationId });

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
        logger.error(`[${callId}] transcript_parsing_failed`, { entries_count: 0 });
        throw new Error(`No valid transcript entries found for call: ${callId}`);
      }
      const uniqueSpeakers = new Set(entries.map((e) => e.user)).size;
      logger.info(`[${callId}] transcript_parsed`, { entries_count: entries.length, speakers_count: uniqueSpeakers });

      // 5. Format as plain text (usernames are already included in transcript entries)
      logger.info(`[${callId}] transcript_formatting_started`, { format: 'plain_text' });
      const formattedTranscript = this.formatTranscript(entries, callId);
      logger.info(`[${callId}] transcript_formatted`, { format: 'plain_text', characters_count: formattedTranscript.length });

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
        logger.info(`Updated transcript attachment ${existingTranscriptAttachment.id} to version ${currentVersion + 1}, linked to message ${messageId}`);
      } else {
        logger.info(`[${callId}] attachment_creation_started`, { message_id: messageId, attachment_type: 'transcript' });
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
        logger.info(`[${callId}] attachment_created`, { attachment_id: attachment.id, path: storagePath });
      }

      // 11. Save transcript URL to Call record for easier access (used by recordings feature)
      await repositories.calls.update(call.id, {
        transcript: storagePath,
      });
      logger.info(`[${callId}] call_record_updated`, { fields_updated: 'transcript' });

      // 12. Update the call message to indicate it has an attachment
      await repositories.messages.update(messageId, {
        hasAttachment: true,
      });

      logger.info(`[${callId}] transcript_processing_completed`, { message_id: messageId });

      // 13. Fire-and-forget: Translate transcript asynchronously in background
      // This updates the same GCS file without blocking the response
      this.translateTranscriptAsync(callId, txtStoragePath).catch((err) => {
        logger.error(`[${callId}] background_translation_failed`, { error: err });
      });

      // 14. Attach identified transcript (real-name labelled) as a second attachment when available.
      // Written by the Python agent's RealtimeIdentifier during the call into
      // transcriptions/{callId}_identified.jsonl — may not exist if no voiceprints were enrolled.
      void this.attachIdentifiedTranscriptIfExists(callId, messageId, call.createdByUserId, callMessage.conversationId, channel.workspaceId);
    } catch (error) {
      logger.error(`[${callId}] transcript_processing_failed`, { message_id: messageId, error: error, stack: error instanceof Error ? error.stack : undefined });
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
  async retrieveTranscript(callId: string): Promise<string | null> {
    const storagePath = `transcriptions/${callId}.jsonl`;
    try {
      logger.info(`[${callId}] transcript_fetch_started`, { path: storagePath });

      const exists = await this.transcriptStorage.fileExists(storagePath);

      if (!exists) {
        logger.error(`[${callId}] transcript_download_failed`, { error: 'file_not_found', path: storagePath });
        throw new Error(`Transcript file not found: ${storagePath}`);
      }

      logger.info(`[${callId}] transcript_download_started`);
      const downloadStart = Date.now();
      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);
      logger.info(`[${callId}] transcript_download_completed`, { bytes_downloaded: buffer.length, duration_ms: Date.now() - downloadStart });
      return buffer.toString('utf-8');
    } catch (error) {
      logger.error(`[${callId}] transcript_download_failed`, { error: error, path: storagePath, stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }

  /**
   * Parse JSONL content into transcript entries
   */
  parseTranscriptEntries(jsonlContent: string): TranscriptEntry[] {
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

    logger.info(`[${callId}] transcript_consolidated`, { original_entries: entries.length, consolidated_entries: consolidated.length });
    return consolidated;
  }

  /**
   * Format transcript entries into plain text
   */
  formatTranscript(entries: TranscriptEntry[], callId?: string): string {
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
  async uploadFormattedTranscript(callId: string, content: string): Promise<string> {
    const filepath = `attachments/${callId}_formatted.txt`;
    const buffer = Buffer.from(content, 'utf-8');

    logger.info(`[${callId}] transcript_upload_started`, { type: 'formatted_transcript', path: filepath });

    await this.transcriptStorage.uploadFileV2(buffer, {
      path: filepath,
      contentType: 'text/plain',
      metadata: { callId, type: 'transcript' },
    });

    logger.info(`[${callId}] transcript_upload_completed`, { type: 'formatted_transcript', path: filepath });
    return filepath;
  }

  async isSpeakerIdentificationEnabled(): Promise<boolean> {
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
        logger.info(`[${callId}] identified_transcript_skipped`, { reason: 'speaker_identification_disabled' });
        return;
      }

      const identifiedGcsPath = `transcriptions/${callId}_identified.jsonl`;
      const exists = await this.transcriptStorage.fileExists(identifiedGcsPath);
      if (!exists) {
        logger.info(`[${callId}] identified_transcript_not_found`, { action: 'skip_attachment' });
        return;
      }

      const buffer = await this.transcriptStorage.getFileBuffer(identifiedGcsPath);
      const entries = this.parseTranscriptEntries(buffer.toString('utf-8'));
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
        logger.info(`[${callId}] identified_transcript_attachment_updated`, { attachment_id: existing.id });
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
        logger.info(`[${callId}] identified_transcript_attachment_created`, { attachment_id: attachment.id });
      }

      // Apply the same background translation as the plain transcript
      this.translateIdentifiedTranscriptAsync(callId, formattedPath).catch((err) => {
        logger.error(`[${callId}] identified_background_translation_failed`, { error: err });
      });
    } catch (err) {
      logger.error(`[${callId}] identified_transcript_attach_failed`, { error: err });
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
      const entries = this.parseTranscriptEntries(buffer.toString('utf-8'));
      if (entries.length === 0) return null;
      return this.formatTranscript(entries, callId);
    } catch (error) {
      logger.error(`Failed to get identified transcript content for ${callId}:`, error);
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
      logger.info(
        `[${callId}] formatted_transcript_download_started | path=${storagePath}, bucket=${config.gcs.transcriptionBucketName}`
      );

      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);

      return buffer;
    } catch (error) {
      logger.error(
        `[${callId}] formatted_transcript_download_failed | path=${storagePath}, error=${error}`
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
  async translateTranscriptAsync(callId: string, storagePath: string): Promise<void> {
    try {
      logger.info(`Starting background translation for call: ${callId}`);

      // 1. Download raw transcript
      const buffer = await this.transcriptStorage.getFileBuffer(storagePath);
      const rawTranscript = buffer.toString('utf-8');

      // 2. Translate the transcript
      const translatedTranscript = await this.postProcessTranscript(rawTranscript, callId);

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
   * Same as translateTranscriptAsync but for the identified transcript GCS file.
   * Overwrites the identified formatted .txt with the translated version.
   */
  private async translateIdentifiedTranscriptAsync(callId: string, gcsPath: string): Promise<void> {
    try {
      logger.info(`[${callId}] identified_translation_started`);

      const buffer = await this.transcriptStorage.getFileBuffer(gcsPath);
      const rawTranscript = buffer.toString('utf-8');

      const translatedTranscript = await this.postProcessTranscript(rawTranscript, callId);

      await this.transcriptStorage.uploadFileV2(Buffer.from(translatedTranscript, 'utf-8'), {
        path: gcsPath,
        contentType: 'text/plain',
        metadata: { callId, type: 'identified_transcript', translated: 'true' },
      });

      logger.info(`[${callId}] identified_translation_completed`);
    } catch (error) {
      logger.error(`[${callId}] identified_translation_failed`, { error: error });
    }
  }

  /**
   * Post-process transcript: translate to English
   * Handles long transcripts by chunking them into smaller pieces
   * @param transcript - The formatted transcript text
   * @returns Post-processed transcript or original if processing fails
   */
  async postProcessTranscript(transcript: string, callId?: string): Promise<string> {
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
          callId,
        });

        if (!translated.ok) {
          logger.warn(`post_process_transcript_failed | reason=${translated.reason} | using_original=true`);
          return transcript;
        }

        logger.info('Successfully post-processed transcript (streaming translation)');
        return translated.content;
      }

      // For long transcripts, process in chunks with LIMITED CONCURRENCY.
      // Each chunk is a separate streaming request; a bounded worker pool keeps
      // the number of concurrent streams in check (the previous unbounded
      // Promise.all overwhelmed the LiteLLM deployment).
      const CHUNK_CONCURRENCY = 3;
      const totalChunks = Math.ceil(lines.length / MAX_LINES_PER_CHUNK);

      logger.info(
        `Transcript has ${lines.length} lines, processing in ${totalChunks} chunks of ${MAX_LINES_PER_CHUNK} (concurrency ${CHUNK_CONCURRENCY})`
      );

      // Build chunk metadata up front so results can be reassembled in order.
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

      const results: string[] = new Array(chunks.length);
      let nextIndex = 0;

      const processChunk = async (chunk: typeof chunks[0], index: number): Promise<void> => {
        logger.info(
          `Processing chunk ${chunk.chunkIndex}/${totalChunks} (lines ${chunk.startLine}-${chunk.endLine})`
        );

        try {
          const translated = await executeStreamingLlmRequest({
            userPrompt: chunk.chunkText,
            systemPrompt: systemInstructions,
            operation: 'transcript_translation',
            callId,
          });

          if (!translated.ok) {
            logger.warn(`post_process_chunk_failed | chunk=${chunk.chunkIndex}/${totalChunks} | reason=${translated.reason} | using_original=true`);
            results[index] = chunk.chunkText;
            return;
          }

          logger.info(`Chunk ${chunk.chunkIndex}/${totalChunks} completed`);
          results[index] = translated.content;
        } catch (error) {
          logger.error(`Error processing chunk ${chunk.chunkIndex}:`, error);
          results[index] = chunk.chunkText;
        }
      };

      // Worker-pool: run up to CHUNK_CONCURRENCY chunks at a time.
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

      const processedTranscript = results.join('\n');
      logger.info(
        `Successfully post-processed transcript in ${results.length} chunks (streaming translation)`
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
  /**
   * Generate AI summary from the formatted transcript with explicit retry loop.
   * Framework retries are disabled (maxRetries: 0) so we control retry count,
   * backoff, and logging with the full callId context.
   */
  /**
   * Generate AI summary from the formatted transcript with explicit retry loop.
   */
  async generateCallSummary(transcript: string, callId?: string, modelType?: SummaryModelType): Promise<string | null> {
    const callCreator = await this.getCallCreatorName(callId);
    const prompt = CALL_SUMMARY_PROMPT
      .replace('{callCreator}', callCreator || 'Unknown')
      .replace('{transcript}', transcript);

    const extracted = await executeCallLlmWithRetry(
      () => this.createAgent(callId, modelType),
      () => prompt,
      'call_summary',
      callId || 'unknown',
    );

    if (!extracted.ok) {
      return null;
    }

    return extracted.content;
  }

  /** Resolve the creator's display name for the short-summary prompt. */
  private async getCallCreatorName(callId?: string): Promise<string | null> {
    if (!callId) return null;
    const call = await repositories.calls.findByExternalId(callId);
    const callCreator = call ? await repositories.users.findById(call.createdByUserId) : null;
    return callCreator?.displayName || callCreator?.name || null;
  }

  /**
   * Generate a short AI title from transcript
   * @param transcript - The formatted transcript text
   * @returns AI-generated title (length is governed by the prompt) or null if generation fails
   */
  /**
   * Generate a short AI title from transcript with explicit retry loop.
   */
  async generateCallTitle(
    transcript: string,
    callId?: string,
    promptTemplate = CALL_TITLE_PROMPT,
    modelType?: SummaryModelType,
  ): Promise<string | null> {
    const prompt = promptTemplate.replace('{transcript}', transcript);

    const extracted = await executeCallLlmWithRetry(
      () => this.createAgent(callId, modelType),
      () => prompt,
      'call_title',
      callId || 'unknown',
    );

    if (!extracted.ok) {
      return null;
    }

    return extracted.content;
  }

  /**
   * Generate a short AI title for a headless recording (Xyne Scribe) — same
   * retry/extraction path as `generateCallTitle`, but using the recording-
   * specific prompt so recording and regular-call title wording can diverge.
   */
  async generateRecordingTitle(transcript: string, callId?: string, modelType?: SummaryModelType): Promise<string | null> {
    return this.generateCallTitle(transcript, callId, RECORDING_TITLE_PROMPT, modelType);
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
        (msg) => msg.msgType !== MessageType.SYSTEM && msg.senderId && msg.content?.trim()
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
   * @param summary - The AI-generated call summary
   * @returns Array of ticket suggestions or empty array if generation fails
   */
  async generateTicketSuggestions(transcript: string, callId?: string): Promise<TicketSuggestion[]> {
    const logCallId = callId || 'unknown';
    const agent = await this.createAgent(logCallId);
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

      const extracted = extractAgentContent(result);
      if (!extracted.ok) {
        logger.error(`ticket_suggestions_generation_failed | reason=${extracted.reason} | status=${extracted.status ?? result.status}`);
        return [];
      }

      let jsonContent = extracted.content;

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
   * Generate a small set of short topical labels from the transcript (for
   * browsing/search). Returns [] on any failure or when nothing qualifies —
   * callers should treat an empty array as "nothing to add", not an error.
   */
  async generateCallLabels(transcript: string, callId?: string): Promise<string[]> {
    const logCallId = callId || 'unknown';
    const agent = await this.createAgent(logCallId);
    if (!agent) {
      logger.warn('Agent creation failed. Skipping call labels generation.');
      return [];
    }

    const prompt = CALL_LABELS_PROMPT.replace('{transcript}', transcript);

    try {
      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      const extracted = extractAgentContent(result);
      if (!extracted.ok) {
        logger.error(`call_labels_generation_failed | reason=${extracted.reason} | status=${extracted.status ?? result.status}`);
        return [];
      }

      let jsonContent = extracted.content;
      const codeBlockMatch = jsonContent.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        jsonContent = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonContent);
      if (!Array.isArray(parsed.labels)) {
        logger.error(`call_labels_generation_failed | error=invalid_format, parsed=${JSON.stringify(parsed)}`);
        return [];
      }

      const labels = parsed.labels
        .filter((l: unknown): l is string => typeof l === 'string' && l.trim().length > 0)
        .slice(0, MAX_CALL_LABELS);

      logger.info(`Generated ${labels.length} call labels`);
      return labels;
    } catch (error) {
      logger.error(`call_labels_generation_failed | error=${error instanceof Error ? error.message : JSON.stringify(error)}`, error);
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

      const extracted = extractAgentContent(result);
      if (!extracted.ok) {
        logger.error(`[Pulse] generatePulseData_failed`, { reason: extracted.reason, status: extracted.status ?? result.status });
        return [];
      }

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
   * @param ticketSuggestions - Optional array of ticket suggestions to append as markdown
   */
  async postSummaryAsReply(
    conversationId: string,
    callId: string,
    markdownSummary: string | null,
    ticketSuggestions?: TicketSuggestion[],
  ) {
    logger.info(
      `[postSummaryAsReply] Starting for callId: ${callId}, conversationId: ${conversationId}`
    );

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
    if (markdownSummary) {
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
      logger.warn(`[postNotesCanvasReplyIfPresent] Failed to post notes canvas for callId: ${callId}`, notesError);
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
        logger.info(`[${callId}] transcript_reconcile_skipped`, { reason: 'no_call_message' });
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
        logger.error(`[${callId}] transcript_reconcile_retrieve_failed`, {
          error: retrieveError,
          stack: retrieveError instanceof Error ? retrieveError.stack : undefined,
        });
        content = null;
      }
      if (!content) {
        logger.info(`[${callId}] transcript_reconcile_skipped`, { reason: 'no_gcs_transcript' });
        return;
      }
      const currentCount = this.parseTranscriptEntries(content).length;

      // What we last processed, read from the existing attachment's entryCount metadata.
      const existing = await repositories.messageAttachments.findTranscriptByCallId(callId);
      const storedCount =
        (existing?.metadata as TranscriptAttachmentMetadata | null)?.entryCount ?? -1;

      if (currentCount <= storedCount) {
        logger.info(`[${callId}] transcript_reconcile_skipped`, {
          reason: 'already_processed',
          gcs_entry_count: currentCount,
          stored_entry_count: storedCount,
        });
        return;
      }

      logger.info(`[${callId}] transcript_reconcile_processing`, {
        gcs_entry_count: currentCount,
        stored_entry_count: storedCount,
        message_id: callMessage.messageId,
      });
      await this.processCallWithSummary(callId, callMessage.messageId, true);
    } catch (error) {
      logger.error(`[${callId}] transcript_reconcile_failed`, {
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete every GCS object that holds this call's transcript. Used when the host
   * chooses to discard the transcript at end-of-call (fully private / incognito).
   * Best-effort and idempotent — a missing file is treated as already-deleted.
   */
  async deleteTranscriptArtifacts(callId: string): Promise<void> {
    const paths = [
      `transcriptions/${callId}.jsonl`,
      `transcriptions/${callId}_identified.jsonl`,
      `attachments/${callId}_formatted.txt`,
      `attachments/${callId}_identified_formatted.txt`,
    ];
    for (const path of paths) {
      try {
        const exists = await this.transcriptStorage.fileExists(path);
        if (exists) {
          await this.transcriptStorage.deleteFile(path);
          logger.info(`[${callId}] transcript_artifact_deleted`, { path });
        }
      } catch (error) {
        logger.warn(`[${callId}] transcript_artifact_delete_failed`, { path, error });
      }
    }
  }

  /**
   * NOTE_TAKER (HEADLESS / "Xyne Oats") calls never reach this method — their
   * entire pipeline (transcriptReady webhook, reconcile) is routed straight to
   * noteTakerTranscriptService, which never creates or posts a message. This
   * method is for the channel/conversation-based flow only.
   */

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
      logger.warn(`[${callId}] process_call_with_summary_lock_timeout`, {
        message_id: messageId,
        reason: 'another worker held the processing lock beyond the wait window',
      });
      return;
    }

    let pendingDetailedSummary:
      | ReturnType<typeof callDocumentService.generateAndPostDetailedSummary>
      | null = null;

    try {
      // Get call details for summary generation and notes posting.
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        logger.error(`[${callId}] call_not_found`, { context: 'summary_generation' });
        return;
      }

      // Host kill-switch: if the host chose to discard at end-of-call (transcription was
      // off), delete whatever was captured and skip all artifacts/indexing. This gate sits
      // in the single processing chokepoint, so it covers the agent webhook, the legacy
      // webhook, and the +30s room_finished reconcile alike.
      const dispositionMeta =
        call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
          ? (call.metadata as Record<string, unknown>).transcriptDisposition
          : undefined;
      if (dispositionMeta === 'discard') {
        logger.info(`[${callId}] transcript_discarded_by_host`, { message_id: messageId });
        await this.deleteTranscriptArtifacts(callId);
        return;
      }

      // Get the call message to retrieve conversationId for the reply
      const callMessage = await repositories.messages.findById(messageId);
      if (!callMessage) {
        logger.error(`[${callId}] message_not_found`, { message_id: messageId, context: 'summary_generation' });
        return;
      }

      await this.postNotesCanvasReplyIfPresent(callMessage.conversationId, callId);

      if (!hasTranscript) {
        logger.warn('transcript_processing_skipped', { call_id: callId, reason: 'agent_reported_no_transcript' });
        return;
      }

      // First, process the transcript (existing functionality)
      // Wrap individually so a GCS/DB failure here produces a stage-labelled log rather
      // than the generic process_call_with_summary_failed from the outer catch.
      try {
        await this.postCallTranscript(callId, messageId);
      } catch (transcriptError) {
        logger.error(`[${callId}] post_transcript_failed`, { stage: 'post_call_transcript', error: transcriptError, stack: transcriptError instanceof Error ? transcriptError.stack : undefined });
        // Don't rethrow — retrieveTranscript below fetches raw content from GCS directly and
        // may still succeed even if the DB-side attachment step inside postCallTranscript failed.
      }

      // Retrieve and format transcript for AI.
      const transcriptContent = await this.retrieveTranscript(callId);
      if (!transcriptContent) {
        logger.warn(`[${callId}] ai_summary_skipped`, { reason: 'no_transcript_content' });
        return;
      }

      const entries = this.parseTranscriptEntries(transcriptContent);
      if (entries.length === 0) {
        logger.warn(`[${callId}] ai_summary_skipped`, { reason: 'no_transcript_entries' });
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

      // Skip title generation for HEADLESS recordings - users set title manually via recordings UI
      const skipTitleGeneration = call.callType === CallType.HEADLESS;
      if (skipTitleGeneration) {
        logger.info(`[${callId}] title_generation_skipped`, { reason: 'headless_recording' });
      }
      const summaryPromise = this.generateCallSummary(formattedTranscript, callId).catch((err) => {
        logger.error(`[${callId}] generate_summary_threw`, { error: err, stack: err instanceof Error ? err.stack : undefined });
        return null;
      });
      const callTitlePromise = skipTitleGeneration
        ? Promise.resolve(null)
        : this.generateCallTitle(titleInput, callId).catch((err) => {
          logger.error(`[${callId}] generate_title_threw`, { error: err, stack: err instanceof Error ? err.stack : undefined });
          return null;
        });
      const ticketSuggestionsPromise = this.generateTicketSuggestions(formattedTranscript).catch((err) => {
        logger.error(`[${callId}] generate_ticket_suggestions_threw`, { error: err, stack: err instanceof Error ? err.stack : undefined });
        return [];
      });

      // Start all four post-call LLM operations immediately. Detailed-summary
      // streaming remains unchanged; title, summary, and tickets persist their
      // own result as soon as it is ready rather than waiting on one another.
      pendingDetailedSummary = callDocumentService.generateAndPostDetailedSummary(
        callId,
        formattedTranscript,
        callMessage.conversationId,
        undefined,
        { callTitlePromise },
      ).catch((error) => {
        // generateAndPostDetailedSummary logs its own failure exits; reaching
        // here means it threw outside them, so this is the only record.
        logDetailedSummaryFailed(callId, 'unexpected_error', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      });

      const summaryUiPromise = summaryPromise.then(async (summary) => {
        if (!summary) return null;
        try {
          await repositories.calls.update(call.id, { aiSummary: summary });
          logger.info(`[${callId}] call_record_updated`, { fields_updated: 'aiSummary' });
        } catch (updateError) {
          if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === 'P2025') {
            logger.warn(`[${callId}] call_deleted_before_summary_save | skipping update`);
            return null;
          }
          logger.error(`[${callId}] call_record_update_failed`, {
            stage: 'call_record_update', error: updateError,
            stack: updateError instanceof Error ? updateError.stack : undefined,
          });
        }

        try {
          await this.postSummaryAsReply(callMessage.conversationId, callId, summary);
        } catch (replyError) {
          logger.error(`[${callId}] post_summary_reply_failed`, {
            stage: 'post_summary_reply', error: replyError,
            stack: replyError instanceof Error ? replyError.stack : undefined,
          });
        }
        return summary;
      });

      const titleUiPromise = callTitlePromise.then(async (title) => {
        if (!title) return null;
        try {
          if (!call.title) {
            await repositories.calls.update(call.id, { title });
            void callRecordingService.updateRecordingFilename(callId, title);
          }

          // Serialize with first-chunk Canvas URL attachment: both merge the
          // call-message metadata, so neither can discard the other's fields.
          await db.$transaction(async (tx) => {
            const [message] = await tx.$queryRaw<Array<{ content: string; metadata: unknown }>>`
              SELECT "content", "metadata" FROM "messages" WHERE "messageId" = ${messageId} FOR UPDATE
            `;
            if (!message) {
              logger.warn(`Call message ${messageId} not found for title update`);
              return;
            }
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
          });
          logger.info(`[${callId}] call_title_updated`);
        } catch (error) {
          logger.error(`[${callId}] call_title_update_failed`, { error });
        }
        return title;
      });

      const ticketsUiPromise = ticketSuggestionsPromise.then(async (ticketSuggestions) => {
        if (ticketSuggestions.length === 0) return ticketSuggestions;
        try {
          await this.postSummaryAsReply(
            callMessage.conversationId, callId, null, ticketSuggestions,
          );
        } catch (ticketError) {
          logger.error(`[${callId}] post_ticket_suggestions_failed`, {
            error: ticketError,
            stack: ticketError instanceof Error ? ticketError.stack : undefined,
          });
        }
        return ticketSuggestions;
      });

      const [summary, title, ticketSuggestions] = await Promise.all([
        summaryUiPromise,
        titleUiPromise,
        ticketsUiPromise,
      ]);

      const duration = Date.now() - startTime;
      logger.info(
        `AI generation completed in ${duration}ms. Summary: ${!!summary}, Title: ${!!title}, Tickets: ${ticketSuggestions.length}`
      );

      // If ALL three AI calls failed, escalate from per-call warns to a single error so
      // an LLM outage affecting every call is immediately visible rather than buried in warns.
      const aiFullyFailed = !summary && !title && ticketSuggestions.length === 0;
      if (aiFullyFailed) {
        logger.error(`[${callId}] ai_generation_all_failed`, { summary: false, title: false, tickets: 0 });
      }

      if (summary) {
        // Pulse block — completely separate from Xyne tickets.
        // Only activates when the call's channel is in PULSE_ENABLED_CHANNELS.
        if (config.pulse.enabledChannels.length > 0) {
          try {
            // Check if this call's channel is in the Pulse allowlist (by channel ID)
            const isPulseChannel = config.pulse.enabledChannels.includes(call.channelId ?? '');

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

        if (pendingDetailedSummary) {
          // Clear the fallback reference before awaiting normally. The finally
          // block only drains a task when an earlier return/error bypasses here.
          const detailedSummaryPromise = pendingDetailedSummary;
          pendingDetailedSummary = null;
          try {
            const detailedSummaryResult = await detailedSummaryPromise;
            if (detailedSummaryResult.success) {
              logger.info(`Auto-generated detailed summary for call: ${callId}`);
            }
            // A failure here was already logged by whichever exit gave up, so
            // there is no second line and the alert counts one per recording.
          } catch (error) {
            logDetailedSummaryFailed(callId, 'unexpected_error', error);
          }
        }
      } else {
        // Use error (not warn) so LLM-down conditions generate alertable signal.
        logger.error(`[${callId}] ai_summary_skipped`, { reason: 'generation_failed' });
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
        logger.info(`[TranscriptService] Queued Vespa indexing for transcript ${call.id}`);
      } catch (vespaError) {
        logger.error(`[TranscriptService] Failed to queue Vespa job for transcript ${call.id}:`, vespaError);
      }

    } catch (error) {
      logger.error(`[${callId}] process_call_with_summary_failed`, { error: error, stack: error instanceof Error ? error.stack : undefined });
      // Don't re-throw - the transcript was already processed successfully
    } finally {
      // Once started, keep the per-call lock until detailed generation settles.
      // This covers early returns (for example, a concurrently deleted call)
      // without leaving an unobserved stream racing the next reconciliation.
      if (pendingDetailedSummary) {
        try {
          await pendingDetailedSummary;
        } catch (error) {
          logger.error(`[${callId}] detailed_summary_background_drain_failed`, {
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
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
      logger.error('[Pulse] Conversation not found — cannot post Pulse tickets message');
      return;
    }

    // Get channel to retrieve workspaceId
    const channel = await db.channel.findUnique({
      where: { id: conversation.channelId },
      select: { workspaceId: true }
    });
    if (!channel?.workspaceId) {
      logger.error('[Pulse] Channel workspace not found — cannot post Pulse tickets message');
      return;
    }

    const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic', channel.workspaceId);
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
