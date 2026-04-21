/**
 * Call Document Service - Generates documents from call transcripts
 * Handles both PRD (Product Requirements Documents) and Detailed Summaries
 * Creates Canvas documents and posts them to conversations via Xyne Automatic bot
 */

import { v4 as uuidv4 } from 'uuid';
import { Agent, type AgentConfig, createUserMessage, type Message } from '@framework';
import { LogLevel } from '@framework';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { formatToISTLocaleString } from '@/utils/dateUtils';
import { CanvasRole } from '@prisma/client';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import { getCanvasUrl, findExistingDetailedSummaryCanvas } from '@/services/canvasService';
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { db } from '@/database/client';
import type {
  BlockNoteBlock,
  BlockNoteTableBlock,
  BlockNoteInlineContent,
} from '@/types/blockNoteTypes';

// PRD Document structure
interface PRDDocument {
  title: string;
  problemStatement: string;
  userStories: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  openQuestions: string[];
  participants: string[];
}

// Participant information for mentions
interface ParticipantInfo {
  userId: string;
  username: string;
  userEmail: string;
  userPicture?: string;
}

/**
 * Sanitize input strings to prevent injection attacks
 * Removes control characters and limits length
 */
function sanitizeInput(input: string | null): string {
  if (!input) return '';

  // Remove null bytes and other control characters except newlines and tabs
  const sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length to prevent excessive token usage (adjust as needed)
  const maxLength = 100000; // ~100K chars
  return sanitized.length > maxLength ? sanitized.substring(0, maxLength) : sanitized;
}

/**
 * Parse text content to extract @mentions and convert to BlockNote inline content.
 * Example: "Task for @Mayank Bansal" -> [text, mention, text]
 *
 * Builds a dynamic regex from participant names so the entire text is tokenised
 * in a single `split` pass — no manual index arithmetic needed.
 * Matched user IDs are collected into `mentionedIds` for the caller.
 */
function parseTextWithMentions(
  text: string,
  participantMap: Map<string, ParticipantInfo>,
  applyBold = false,
  mentionedIds?: Set<string>,
): BlockNoteInlineContent[] {
  if (!text) return [];

  const textStyles = applyBold ? { bold: true } : {};

  // Fast path: no participants to match against
  if (participantMap.size === 0) {
    return [{ type: 'text', text, styles: textStyles }];
  }

  // Escape special regex chars in each name; sort longest-first for greedy match
  const regexReadyNames = Array.from(participantMap.keys())
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // Capturing group keeps the matched delimiter in the split result array
  const mentionPattern = new RegExp(`(@(?:${regexReadyNames.join('|')}))`, 'i');

  const result: BlockNoteInlineContent[] = [];

  for (const segment of text.split(mentionPattern)) {
    if (!segment) continue;

    if (segment.startsWith('@')) {
      const key = segment.slice(1).toLowerCase();
      const info = participantMap.get(key);

      if (info) {
        logger.info(`[CallDocumentService] ✅ Matched ${segment} to ${info.username}`);
        mentionedIds?.add(info.userId);
        result.push({
          type: 'mention',
          props: {
            userId: info.userId,
            username: info.username,
            userEmail: info.userEmail,
            userPicture: info.userPicture ?? '',
          },
        });
        continue;
      }
    }

    // Plain text segment (or unmatched @ — keep as-is)
    result.push({ type: 'text', text: segment, styles: textStyles });
  }

  return result;
}


/**
 * Build participant map from the channel that owns the call.
 * Maps lowercase participant name -> participant info.
 * Using channel participants (not just call attendees) ensures the AI prompt
 * and @mention resolution covers everyone who could be referenced.
 */
async function buildParticipantMap(channelId: string): Promise<Map<string, ParticipantInfo>> {
  const participantMap = new Map<string, ParticipantInfo>();

  try {
    const participants = await repositories.channelParticipants.getChannelParticipantsWithUserDetails(channelId);

    if (participants.length === 0) {
      logger.warn(`[CallDocumentService] No channel participants found for channelId=${channelId}`);
      return participantMap;
    }

    for (const participant of participants) {
      const lowerName = participant.userName.toLowerCase();
      participantMap.set(lowerName, {
        userId: participant.userId,
        username: participant.userName,
        userEmail: participant.userEmail,
        userPicture: participant.userPicture || undefined,
      });
      logger.info(`[CallDocumentService] Added channel participant to map: "${participant.userName}" (lowercase: "${lowerName}") -> ${participant.userId}`);
    }

    logger.info(`[CallDocumentService] Built participant map with ${participantMap.size} channel participants for channelId=${channelId}`);
    logger.info(`[CallDocumentService] Participant names in map: ${Array.from(participantMap.keys()).join(', ')}`);
  } catch (error) {
    logger.error('[CallDocumentService] Error building participant map:', error);
  }

  return participantMap;
}

// PRD Generation prompt
const PRD_GENERATION_PROMPT = `You are a senior product manager creating a Product Requirements Document (PRD) from a call transcript.

Analyze the conversation and extract product requirements discussed during the call.

Return ONLY a valid JSON object with this exact structure:
\`\`\`json
{
  "title": "Brief PRD title based on main topic discussed",
  "problemStatement": "Clear description of the problem being solved",
  "userStories": ["As a [user], I want [functionality] so that [benefit]", ...],
  "functionalRequirements": ["Specific functional requirement 1", ...],
  "nonFunctionalRequirements": ["Performance, security, etc. requirements", ...],
  "acceptanceCriteria": ["Testable acceptance criteria", ...],
  "outOfScope": ["Things explicitly not included", ...],
  "openQuestions": ["Unresolved questions from discussion", ...],
  "participants": ["List of participants from transcript"]
}
\`\`\`

IMPORTANT:
- Extract real requirements from the discussion, not generic placeholders
- If a section has no relevant content, use an empty array []
- Keep each item concise but specific
- Return ONLY the JSON, no additional commentary

CALL TRANSCRIPT:
{transcript}

CALL SUMMARY:
{summary}
`;

// Detailed AI Summary prompt - phase-based comprehensive analysis
const DETAILED_SUMMARY_PROMPT = `You are creating a comprehensive, phase-based meeting summary that captures the natural flow of conversation.
**LANGUAGE: Generate this entire summary in English, regardless of the transcript language.**

Analyze the transcript and divide it into distinct phases/segments based on topic shifts or conversation flow.

**PHASE GUIDELINES (based on call length):**
- Very short calls (< 5 min): 1-2 phases
- Short calls (5-15 min): 2-3 phases
- Medium calls (15-30 min): 3-5 phases
- Long calls (30+ min): 5-7 phases

MARKDOWN TEMPLATE:

## 📊 Detailed Call Summary

### Call Overview
**Estimated Duration**: [Short/Medium/Long based on transcript length]
**Participants**: [List all participants mentioned]
**Primary Focus**: [1-2 sentence summary of main purpose]

---

### 📍 Call Phases

#### Phase 1: [Phase Title - e.g., "Opening & Context Setting"]
**Summary**: [2-3 sentence summary of this phase]

**Key Points**:
- [Point 1]
- [Point 2]

**Notable Mentions**:
- [Specific names, numbers, dates, or quotes mentioned]

---

#### Phase 2: [Phase Title - e.g., "Main Discussion"]
**Summary**: [2-3 sentence summary]

**Key Points**:
- [Point 1]
- [Point 2]

**Decisions/Outcomes** (if any):
- [Decision made in this phase]

---

#### Phase 3: [Phase Title - e.g., "Wrap-up & Next Steps"]
**Summary**: [2-3 sentence summary]

**Commitments**:
- [Who agreed to do what]

---

### 📋 Consolidated Outcomes

#### Decisions Made
| # | Decision | Owner | Context |
|---|----------|-------|---------|
| 1 | [Decision] | [Person] | [Why/Context] |

#### Action Items
| # | Task | Assignee | Due | Priority |
|---|------|----------|-----|----------|
| 1 | [Task] | [Person] | [Date] | [H/M/L] |

#### Open Items
- [ ] [Unresolved question or parked topic]

---

### 🔗 Follow-up
- **Next Meeting**: [If mentioned]
- **Blockers**: [Any blockers identified]

---

### 💡 Key Takeaways
1. [Most important outcome]
2. [Second most important]
3. [Third if applicable]

**CALL PARTICIPANTS (Correct Names):**
{participants}

**IMPORTANT - NAME ACCURACY:**
- The transcript may contain misspelled or incorrectly transcribed participant names
- If a name in the transcript seems close to a participant name, use the correct version from the list
- For @mentions in Action Items, use the full correct name (e.g., @Mayank Bansal)

**INSTRUCTIONS:**
- Determine call length from transcript and use appropriate number of phases (1-7)
- Short/quick calls should have FEWER phases - don't force many phases on a brief discussion
- Each phase should represent a natural shift in topic or conversation flow
- Capture ACTUAL content from the transcript - no generic placeholders
- Include specific names, numbers, dates mentioned
- Preserve chronological order of discussion
- Skip sections that have no relevant content
- For very short calls, the "Consolidated Outcomes" section may be the most valuable part
- In Action Items: Use @ before FULL NAMES for participants in the call (e.g., @Mayank Bansal)
- In Action Items: For people NOT in the participant list, write their name plainly with "(not in channel)" notation

Only output valid Markdown.
No extra text.

TRANSCRIPT:
{transcript}
`;

/**
 * Format PRD document to BlockNote content
 */
function formatPRDToBlockNote(prd: PRDDocument, callId: string): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];

  // Title
  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: `📋 PRD: ${prd.title}`, styles: { bold: true } }],
    children: [],
  });

  // Metadata line
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      { type: 'text', text: `Generated from call `, styles: {} },
      { type: 'text', text: callId, styles: { code: true } },
      { type: 'text', text: ` on ${new Date().toLocaleDateString()}`, styles: {} },
    ],
    children: [],
  });

  // Empty line
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [],
    children: [],
  });

  // Helper to add section
  const addSection = (title: string, items: string[], emoji: string) => {
    if (items.length === 0) return;

    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: `${emoji} ${title}`, styles: { bold: true } }],
      children: [],
    });

    items.forEach((item) => {
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [{ type: 'text', text: item, styles: {} }],
        children: [],
      });
    });

    // Empty line after section
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [],
      children: [],
    });
  };

  // Problem Statement (as paragraph)
  if (prd.problemStatement) {
    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: '🎯 Problem Statement', styles: { bold: true } }],
      children: [],
    });
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [{ type: 'text', text: prd.problemStatement, styles: {} }],
      children: [],
    });
    blocks.push({
      id: uuidv4(),
      type: 'paragraph',
      content: [],
      children: [],
    });
  }

  // Sections
  addSection('User Stories', prd.userStories, '👤');
  addSection('Functional Requirements', prd.functionalRequirements, '⚙️');
  addSection('Non-Functional Requirements', prd.nonFunctionalRequirements, '🔒');
  addSection('Acceptance Criteria', prd.acceptanceCriteria, '✅');
  addSection('Out of Scope', prd.outOfScope, '🚫');
  addSection('Open Questions', prd.openQuestions, '❓');
  addSection('Participants', prd.participants, '👥');

  return blocks;
}

/**
 * Convert markdown to BlockNote JSON format with mention support.
 * Returns both the blocks and the set of user IDs that were actually mentioned,
 * collected in a single pass — no second scan needed.
 */
async function convertMarkdownToBlockNote(
  markdown: string,
  participantMap: Map<string, ParticipantInfo> = new Map()
): Promise<{ blocks: BlockNoteBlock[]; mentionedUserIds: string[] }> {
  try {
    const editor = ServerBlockNoteEditor.create();
    const parsed = await editor.tryParseMarkdownToBlocks(markdown);

    // Collect mentioned IDs during the mention-processing pass
    const mentionedIds = new Set<string>();
    const blocks = processBlocksForMentions(parsed as BlockNoteBlock[], participantMap, mentionedIds);

    logger.info(`[CallDocumentService] Total unique mentioned user IDs found: ${mentionedIds.size}`);
    return { blocks, mentionedUserIds: Array.from(mentionedIds) };
  } catch (error) {
    logger.error('[CallDocumentService] Error converting markdown to BlockNote:', error);
    return { blocks: [], mentionedUserIds: [] };
  }
}

/**
 * Process BlockNote blocks to convert @mentions in text content.
 * Handles tables (cells), regular inline blocks, and children — all in one place.
 */
function processBlocksForMentions(
  blocks: BlockNoteBlock[],
  participantMap: Map<string, ParticipantInfo>,
  mentionedIds: Set<string>,
): BlockNoteBlock[] {
  // Processes an array of inline items: text nodes are split on @mentions,
  // everything else (existing mentions, links, etc.) passes through untouched.
  const processInline = (content: BlockNoteInlineContent[]): BlockNoteInlineContent[] =>
    content.flatMap(item =>
      item.type === 'text' && item.text
        ? parseTextWithMentions(item.text, participantMap, item.styles?.bold ?? false, mentionedIds)
        : [item]
    );

  return blocks.map(block => {
    if (block.type === 'table') {
      const t = block as BlockNoteTableBlock;
      return {
        ...t,
        content: {
          ...t.content,
          rows: t.content.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({ ...cell, content: processInline(cell.content) })),
          })),
        },
      } as BlockNoteTableBlock;
    }

    return {
      ...block,
      ...('content' in block && Array.isArray(block.content)
        ? { content: processInline(block.content as BlockNoteInlineContent[]) }
        : {}),
      ...('children' in block && Array.isArray(block.children)
        ? { children: processBlocksForMentions(block.children, participantMap, mentionedIds) }
        : {}),
    } as BlockNoteBlock;
  });
}

/**
 * Remove undefined values from BlockNote content for Prisma JSON compatibility
 * Prisma's JSON field doesn't accept undefined values
 */
function sanitizeBlockNoteContent(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeBlockNoteContent(item)).filter(item => item !== undefined);
  }

  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeBlockNoteContent(value);
      }
    }
    return sanitized;
  }

  return obj;
}


export class CallDocumentService {
  /**
   * Prepare canvas content from markdown summary.
   * Extracts title, builds participant map, converts markdown to BlockNote, and sanitizes content.
   */
  private async prepareCanvasContent(
    markdownSummary: string,
    channelId: string,
    callStartedAt?: Date,
    callTitle?: string | null
  ): Promise<{
    title: string;
    content: any;
    mentionedUserIds: string[];
  }> {
    // Build canvas title with call title suffix, or fall back to IST timestamp
    let title: string;
    if (callStartedAt) {
      const suffix = callTitle || formatToISTLocaleString(callStartedAt);
      title = `Detailed Summary - ${suffix}`;
    } else {
      title = `Detailed Summary (Updated)`;
    }

    const firstHeadingMatch = markdownSummary.match(/^#\s+(.+)$/m);
    if (firstHeadingMatch) {
      title = firstHeadingMatch[1].trim();
    } else {
      const primaryFocusMatch = markdownSummary.match(/\*\*Primary Focus:\*\*\s*(.+?)(?:\n|$)/i);
      if (primaryFocusMatch) {
        title = `Call Summary: ${primaryFocusMatch[1].trim()}`;
      }
    }

    // Build participant map from channel members for mention resolution
    const participantMap = await buildParticipantMap(channelId);
    const logContext = callStartedAt ? '' : ' (update)';
    logger.info(`[CallDocumentService] Built channel participant map with ${participantMap.size} participants for mentions${logContext}`);

    // Convert markdown to BlockNote with mention support
    const { blocks: content, mentionedUserIds } = await convertMarkdownToBlockNote(markdownSummary, participantMap);

    // Sanitize content to remove undefined values for Prisma
    const sanitizedContent = sanitizeBlockNoteContent(content);

    return { title, content: sanitizedContent, mentionedUserIds };
  }

  /**
   * Queue Vespa indexing for a canvas.
   */
  private async queueVespaIndexing(canvasId: string, userId: string, operation: 'create' | 'update'): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId,
        app: SubApp.CANVAS,
      });
      const action = operation === 'create' ? 'indexing' : 're-indexing';
      logger.info(`[CallDocumentService] Queued Vespa ${action} for canvas ${canvasId}`);
    } catch (error) {
      logger.error(`[CallDocumentService] Failed to queue Vespa job for canvas ${canvasId}:`, error);
    }
  }

  /**
   * Create a fresh Agent instance for each request
   * This prevents state pollution between concurrent requests
   */
  private createAgent(): Agent | null {
    try {
      const apiKey = config.llm.callLitellmApiKey;
      const baseUrl = config.llm.litellmBaseUrl;

      if (!apiKey || !baseUrl) {
        logger.warn('[CallDocumentService] LiteLLM not configured. Document generation disabled.');
        return null;
      }

      const agentConfig: AgentConfig = {
        model: {
          provider: {
            type: 'litellm',
            config: {
              apiKey,
              baseUrl,
              timeout: 180000, // 3 minutes for document generation
              retries: 2,
            },
          },
          defaultModel: config.llm.callLitellmModel || 'glm-latest',
        },
        tools: {
          enabled: [],
          config: {},
          execution: { timeout: 60000 },
        },
        execution: {
          maxTurns: 1,
          mode: 'single',
          timeouts: { llm: 180000 },
          limits: {},
          errorHandling: {
            maxRetries: 5,
            retryDelay: 120000,
          },
        },
        events: {
          logging: LogLevel.WARN,
        },
      };

      const agent = Agent.create(agentConfig);
      logger.info('[CallDocumentService] Agent created for document generation');
      return agent;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create Agent:', error);
      return null;
    }
  }

  /**
   * Generate a PRD from transcript and summary
   * @param transcript - The call transcript content
   * @param summary - Optional call summary
   * @param customPrompt - Optional custom instructions to guide PRD generation (max 5000 chars)
   * @returns PRD document or null if generation fails
   */
  async generatePRDFromTranscript(
    transcript: string,
    summary: string | null,
    customPrompt?: string
  ): Promise<PRDDocument | null> {
    const agent = this.createAgent();
    if (!agent) {
      logger.error('[CallDocumentService] Failed to create agent for PRD generation');
      return null;
    }

    try {
      // Sanitize inputs to prevent injection attacks
      const sanitizedTranscript = sanitizeInput(transcript);
      const sanitizedSummary = sanitizeInput(summary);

      const sanitizedCustomPrompt = customPrompt ? sanitizeInput(customPrompt) : '';

      let prompt = PRD_GENERATION_PROMPT
        .replace('{transcript}', sanitizedTranscript)
        .replace('{summary}', sanitizedSummary || 'No summary available');

      if (sanitizedCustomPrompt) {
        prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\nThe user has provided specific instructions for this PRD. Please prioritize these instructions:\n"${sanitizedCustomPrompt}"\n`;
      }

      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      if (result.status === 'error' || !result.messages.length) {
        logger.error('[CallDocumentService] Agent execution failed for PRD');
        return null;
      }

      const assistantMessages = result.messages.filter(
        (msg: Message): msg is Extract<Message, { type: 'assistant' }> =>
          msg.type === 'assistant'
      );

      const lastMessage = assistantMessages.pop();
      if (!lastMessage?.content) {
        logger.error('[CallDocumentService] No content in PRD response');
        return null;
      }

      // Extract JSON from response
      const jsonMatch = lastMessage.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Fallback: try to find JSON if wrapped in markdown code blocks that weren't caught
        logger.error('[CallDocumentService] Could not find JSON in PRD response');
        return null;
      }

      const prd = JSON.parse(jsonMatch[0]) as PRDDocument;
      logger.info('[CallDocumentService] Successfully generated PRD');
      return prd;
    } catch (error) {
      logger.error('[CallDocumentService] Error generating PRD:', error);
      return null;
    }
  }

  /**
   * Generate detailed summary from transcript
   */
  async generateDetailedSummary(transcript: string, callId: string, customPrompt?: string): Promise<string | null> {
    const agent = this.createAgent();
    if (!agent) {
      logger.warn('[CallDocumentService] Failed to create agent for detailed summary');
      return null;
    }

    try {
      // Resolve channelId from the call so we can build the channel participant map
      const call = await repositories.calls.findByExternalId(callId);
      const channelId = call?.channelId;

      // Build participant map from channel members (covers all channel participants, not just call attendees)
      const participantMap = channelId
        ? await buildParticipantMap(channelId)
        : new Map<string, ParticipantInfo>();

      const participantList = Array.from(participantMap.values())
        .map(p => `- ${p.username}`)
        .join('\n');

      // Sanitize input to prevent injection attacks
      const sanitizedTranscript = sanitizeInput(transcript);
      const sanitizedCustomPrompt = customPrompt ? sanitizeInput(customPrompt) : '';

      let prompt = DETAILED_SUMMARY_PROMPT
        .replace('{participants}', participantList || '- No participants found')
        .replace('{transcript}', sanitizedTranscript);

      if (sanitizedCustomPrompt) {
        prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\nThe user has provided specific instructions for this summary. Please prioritize these instructions:\n"${sanitizedCustomPrompt}"\n`;
      }

      const result = await agent.execute({
        messages: [createUserMessage(prompt)],
      });

      if (result.status === 'error' || !result.messages.length) {
        logger.error('[CallDocumentService] Agent execution failed for detailed summary');
        return null;
      }

      const last = result.messages.at(-1);
      if (!last) return null;

      const markdownContent = 'content' in last ? last.content?.trim() : null;
      if (!markdownContent) return null;

      logger.info('[CallDocumentService] Successfully generated detailed summary');
      return markdownContent;
    } catch (error) {
      logger.error('[CallDocumentService] Error generating detailed summary:', error);
      return null;
    }
  }

  /**
   * Create PRD Canvas in database
   */
  async createPRDCanvas(
    callId: string,
    prd: PRDDocument,
    createdByUserId: string,
    conversationId: string,
    channelId: string
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
      const viewAccessId = uuidv4();
      const participantId = uuidv4();

      const title = `📋 PRD: ${prd.title}`;
      const content = formatPRDToBlockNote(prd, callId);

      // Create canvas
      await prisma.canvas.create({
        data: {
          id: canvasId,
          title,
          content: content as any,
          channelId,
          createdBy: createdByUserId,
          viewAccessId,
          editAccessId: null,
          visibility: 'PUBLIC',
          isTemplate: false,
          lastEditedBy: createdByUserId,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_prd',
            callId,
            conversationId,
            generatedAt: now.toISOString(),
          },
        },
      });

      // Add creator as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: participantId,
          canvasId,
          userId: createdByUserId,
          role: 'OWNER',
          joinedAt: now,
          updatedAt: now,
        },
      });

      logger.info(`[CallDocumentService] Created PRD canvas ${canvasId} for call ${callId}`);

      // Queue Vespa indexing for the canvas
      try {
        await vespaQueue.addJob({
          schema: fileSchema,
          docId: canvasId,
          jobType: 'feed',
          userId: createdByUserId,
          app: SubApp.CANVAS,
        });
        logger.info(`[CallDocumentService] Queued Vespa indexing for PRD canvas ${canvasId}`);
      } catch (vespaError) {
        logger.error(`[CallDocumentService] Failed to queue Vespa job for PRD canvas ${canvasId}:`, vespaError);
      }

      return viewAccessId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create PRD canvas:', error);
      return null;
    }
  }

  /**
   * Create detailed summary Canvas in database
   */
  async createDetailedSummaryCanvas(
    callId: string,
    markdownSummary: string,
    createdByUserId: string,
    conversationId: string,
    channelId: string,
    callStartedAt: Date,
    callCreatorUserId: string,
    callTitle?: string | null
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
      const viewAccessId = uuidv4();
      const editAccessId = uuidv4();
      const participantId = uuidv4();

      // Prepare canvas content (title, content, mentions)
      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        callStartedAt,
        callTitle
      );

      // Create canvas
      await prisma.canvas.create({
        data: {
          id: canvasId,
          title,
          content: sanitizedContent as any,
          channelId,
          createdBy: createdByUserId,
          viewAccessId,
          editAccessId,
          visibility: 'PUBLIC',
          isTemplate: false,
          lastEditedBy: createdByUserId,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_detailed_summary',
            callId,
            conversationId,
            isAiGenerated: true,
            generatedAt: now.toISOString(),
            mentionedUserIds, // Store mentioned users for side effect handler
            version: 1, // Initial version for new canvases
          },
        },
      });

      // Add Xyne Automatic bot as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: participantId,
          canvasId,
          userId: createdByUserId,
          role: CanvasRole.OWNER,
          joinedAt: now,
          updatedAt: now,
        },
      });

      // Add call creator as OWNER
      await prisma.canvasParticipant.create({
        data: {
          id: uuidv4(),
          canvasId,
          userId: callCreatorUserId,
          role: CanvasRole.OWNER,
          joinedAt: now,
          updatedAt: now,
        },
      });

      logger.info(`[CallDocumentService] Created detailed summary canvas ${canvasId} for call ${callId} with Xyne Automatic and call creator as owners`);

      // Fetch complete context for the user to pass to side-effect handler
      const user = await db.user.findUnique({
        where: { id: createdByUserId },
        select: { id: true, email: true, workspaceId: true, role: true },
      });
      if (!user || !user.workspaceId) {
        throw new Error(`User ${createdByUserId} not found or has no workspace assigned`);
      }
      // Email is globally unique in orgMember, single lookup is sufficient
      const orgMember = await db.orgMember.findUnique({
        where: { email: user.email },
      });
      if (!orgMember) {
        throw new Error(`User ${createdByUserId} is not a member of any organization`);
      }

      // Manually call canvas handler for activities and notifications
      // (Canvas is created via Prisma, not Zero mutator, so handler won't auto-trigger)
      const canvasHandler = new CanvasSideEffectHandler({
        userID: user.id,
        workspaceId: user.workspaceId,
        role: user.role,
        memberId: orgMember.memberId,
        orgRole: orgMember.role,
      });
      canvasHandler.onInsert({
        entityId: canvasId,
        entityType: 'canvases',
        operation: 'insert'
      }).catch(err => logger.error('[CallDocumentService] Canvas side-effect handler error:', err));

      // Queue Vespa indexing for the canvas
      await this.queueVespaIndexing(canvasId, createdByUserId, 'create');

      return viewAccessId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create detailed summary canvas:', error);
      return null;
    }
  }

  /**
   * Update an existing detailed summary Canvas with new content.
   * Preserves viewAccessId and editAccessId so existing links remain valid.
   */
  async updateDetailedSummaryCanvas(
    canvasId: string,
    markdownSummary: string,
    updatedByUserId: string,
    channelId: string,
    existingViewAccessId: string,
    currentVersion: number,
    callId: string,
    callTitle?: string | null
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      // Prepare canvas content (title, content, mentions)
      const { title, content: sanitizedContent, mentionedUserIds } = await this.prepareCanvasContent(
        markdownSummary,
        channelId,
        undefined,
        callTitle
      );

      const newVersion = currentVersion + 1;

      // Update existing canvas - preserve viewAccessId and editAccessId
      await prisma.canvas.update({
        where: { id: canvasId },
        data: {
          title,
          content: sanitizedContent as any,
          lastEditedBy: updatedByUserId,
          lastEditedAt: now,
          updatedAt: now,
          metadata: {
            source: 'call_detailed_summary',
            callId,
            isAiGenerated: true,
            generatedAt: now.toISOString(),
            mentionedUserIds,
            version: newVersion,
            lastUpdatedAt: now.toISOString(),
          },
        },
      });

      logger.info(`[CallDocumentService] Updated detailed summary canvas ${canvasId} for call ${callId}, version ${currentVersion} -> ${newVersion}`);

      // Queue Vespa re-indexing for the updated canvas
      await this.queueVespaIndexing(canvasId, updatedByUserId, 'update');

      return existingViewAccessId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to update detailed summary canvas:', error);
      return null;
    }
  }

  /**
   * Create or update detailed summary Canvas.
   * If an existing canvas is found for the call, updates it instead of creating a duplicate.
   */
  async createOrUpdateDetailedSummaryCanvas(
    callId: string,
    markdownSummary: string,
    createdByUserId: string,
    conversationId: string,
    channelId: string,
    callStartedAt: Date,
    callCreatorUserId: string,
    callTitle?: string | null
  ): Promise<{ viewAccessId: string | null; version: number }> {
    // Check if an existing canvas exists for this call
    const existingCanvas = await findExistingDetailedSummaryCanvas(callId);

    if (existingCanvas) {
      // Update existing canvas instead of creating a new one
      const updatedViewAccessId = await this.updateDetailedSummaryCanvas(
        existingCanvas.canvasId,
        markdownSummary,
        createdByUserId,
        channelId,
        existingCanvas.viewAccessId,
        existingCanvas.version,
        callId,
        callTitle
      );

      return {
        viewAccessId: updatedViewAccessId,
        version: existingCanvas.version + 1,
      };
    }

    // No existing canvas, create a new one
    const viewAccessId = await this.createDetailedSummaryCanvas(
      callId,
      markdownSummary,
      createdByUserId,
      conversationId,
      channelId,
      callStartedAt,
      callCreatorUserId,
      callTitle
    );

    return {
      viewAccessId,
      version: 1,
    };
  }

  /**
   * Post PRD canvas link to conversation via Xyne Automatic bot
   */
  async postPRDToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    prdTitle: string
  ): Promise<void> {
    try {
      // Get Xyne Automatic bot
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // Create Markdown message content
      const messageContent = `## 📋 ${prdTitle}

A Product Requirements Document has been generated from this call discussion.

[📄 View PRD Canvas](${canvasUrl})`;

      // Create message
      await repositories.messages.create({
        conversationId,
        senderId: xyneAutomaticBot.id,
        content: messageContent,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          messageSubtype: 'call_prd',
          callId,
          canvasUrl,
          isAiGenerated: true,
          contentFormat: 'markdown',
        },
      });

      await repositories.conversations.incrementReplyCount(conversationId);

      // Update the original call message with PRD canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'prdCanvasUrl', canvasUrl);

      logger.info(`[CallDocumentService] Posted PRD link to conversation ${conversationId}`);
    } catch (error) {
      logger.error('[CallDocumentService] Failed to post PRD to conversation:', error);
      throw error;
    }
  }

  /**
   * Post detailed summary canvas link to conversation (or update existing message)
   */
  async postDetailedSummaryToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    summaryTitle: string,
    version: number = 1
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // Build message content with version indicator if updated
      const isUpdate = version > 1;
      const versionIndicator = isUpdate ? ` (v${version})` : '';
      const updatedIndicator = isUpdate ? '\n\n_This summary has been updated with the latest call content._' : '';

      const messageContent = `## 📊 ${summaryTitle}${versionIndicator}

A comprehensive detailed summary has been generated from this call.

[📄 View Detailed Summary](${canvasUrl})${updatedIndicator}`;

      // Check if a detailed summary message already exists for this call
      const existingMessage = await repositories.messages.findExistingDetailedSummaryMessage(conversationId, callId);

      if (existingMessage) {
        // Update existing message instead of creating a new one
        await prisma.message.update({
          where: { messageId: existingMessage.messageId },
          data: {
            content: messageContent,
            metadata: {
              messageSubtype: 'call_detailed_summary',
              callId,
              canvasUrl,
              isAiGenerated: true,
              contentFormat: 'markdown',
              version: version,
              lastUpdatedAt: new Date().toISOString(),
            },
          },
        });
      } else {
        // Create new message
        await repositories.messages.create({
          conversationId,
          senderId: xyneAutomaticBot.id,
          content: messageContent,
          msgType: MessageType.BOT,
          showInChannel: false,
          metadata: {
            messageSubtype: 'call_detailed_summary',
            callId,
            canvasUrl,
            isAiGenerated: true,
            contentFormat: 'markdown',
            version: version,
            createdAt: new Date().toISOString(),
          },
        });

        await repositories.conversations.incrementReplyCount(conversationId);
        logger.info(`[CallDocumentService] Posted new detailed summary link to conversation ${conversationId}`);
      }

      // Update call message with canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'detailedSummaryCanvasUrl', canvasUrl);

      logger.info(`[CallDocumentService] Detailed summary processing completed for conversation ${conversationId}`);
    } catch (error) {
      logger.error('[CallDocumentService] Failed to post detailed summary to conversation:', error);
      throw error;
    }
  }

  /**
   * Update call message metadata with canvas URL (generic method)
   */
  private async updateCallMessageMetadata(
    conversationId: string,
    callId: string,
    metadataKey: string,
    canvasUrl: string
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();

      // Find the original call message (not bot messages that also have callId)
      const callMessage = await prisma.message.findFirst({
        where: {
          conversationId,
          AND: [
            {
              metadata: {
                path: ['isCallMessage'],
                equals: true,
              },
            },
            {
              metadata: {
                path: ['callId'],
                equals: callId,
              },
            },
          ],
        },
      });

      if (callMessage) {
        // Update metadata with canvas URL
        const currentMetadata = (callMessage.metadata as Record<string, any>) || {};
        await prisma.message.update({
          where: { messageId: callMessage.messageId },
          data: {
            metadata: {
              ...currentMetadata,
              [metadataKey]: canvasUrl,
            },
          },
        });
        logger.info(`[CallDocumentService] Updated call message ${callMessage.messageId} with ${metadataKey}`);
      } else {
        logger.warn(`[CallDocumentService] Call message not found for callId ${callId}`);
      }
    } catch (error) {
      // Don't throw - this is a non-critical update
      logger.error(`[CallDocumentService] Failed to update call message with ${metadataKey}:`, error);
    }
  }

  /**
   * Generate and post PRD to conversation
   */
  async generateAndPostPRD(
    callId: string,
    transcript: string,
    summary: string | null,
    _createdByUserId: string,
    conversationId: string,
    customPrompt?: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      // 1. Generate PRD from transcript
      const prd = await this.generatePRDFromTranscript(transcript, summary, customPrompt);
      if (!prd) {
        return { success: false, error: 'Failed to generate PRD from transcript' };
      }

      // Get Xyne Automatic bot to create canvas
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
      if (!xyneAutomaticBot) {
        return { success: false, error: 'Xyne Automatic bot not found' };
      }

      // Get conversation to retrieve channelId
      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      // 2. Create Canvas with bot as creator
      const viewAccessId = await this.createPRDCanvas(
        callId,
        prd,
        xyneAutomaticBot.id,
        conversationId,
        conversation.channelId
      );
      if (!viewAccessId) {
        return { success: false, error: 'Failed to create PRD canvas' };
      }

      const canvasUrl = getCanvasUrl(viewAccessId);

      // 3. Post to conversation
      await this.postPRDToConversation(
        conversationId,
        callId,
        canvasUrl,
        prd.title
      );

      return { success: true, canvasUrl };
    } catch (error) {
      logger.error('[CallDocumentService] Error in generateAndPostPRD:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate and post detailed summary to conversation
   */
  async generateAndPostDetailedSummary(
    callId: string,
    transcript: string,
    conversationId: string,
    customPrompt?: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      // 1. Generate detailed summary markdown
      const detailedSummaryMarkdown = await this.generateDetailedSummary(transcript, callId, customPrompt);
      if (!detailedSummaryMarkdown) {
        return { success: false, error: 'Failed to generate detailed summary' };
      }

      // Get Xyne Automatic bot
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      // Get call and conversation info
      const call = await repositories.calls.findByExternalId(callId);
      if (!call) {
        return { success: false, error: 'Call not found' };
      }

      const conversation = await repositories.conversations.findById(conversationId);
      if (!conversation) {
        return { success: false, error: 'Conversation not found' };
      }

      // 2. Create or Update Canvas (handles rejoin scenario)
      const { viewAccessId, version } = await this.createOrUpdateDetailedSummaryCanvas(
        callId,
        detailedSummaryMarkdown,
        xyneAutomaticBot.id,
        conversationId,
        conversation.channelId,
        call.startedAt,
        call.createdByUserId,
        call.title
      );
      if (!viewAccessId) {
        return { success: false, error: 'Failed to create or update detailed summary canvas' };
      }

      const canvasUrl = getCanvasUrl(viewAccessId);
      // Use call title as suffix, or fall back to IST timestamp
      const suffix = call.title || formatToISTLocaleString(new Date(call.startedAt));
      const canvasTitle = `Detailed Summary - ${suffix}`;

      // 3. Post to conversation (or update existing message)
      await this.postDetailedSummaryToConversation(
        conversationId,
        callId,
        canvasUrl,
        canvasTitle,
        version
      );

      return { success: true, canvasUrl };
    } catch (error) {
      logger.error('[CallDocumentService] Error in generateAndPostDetailedSummary:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const callDocumentService = new CallDocumentService();
