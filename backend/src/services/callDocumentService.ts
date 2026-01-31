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

// BlockNote block types
interface BlockNoteTextBlock {
  id: string;
  type: 'paragraph' | 'heading';
  props?: {
    level?: 1 | 2 | 3;
    textColor?: string;
    backgroundColor?: string;
  };
  content: Array<{
    type: 'text';
    text: string;
    styles?: {
      bold?: boolean;
      italic?: boolean;
      code?: boolean;
    };
  }>;
  children?: BlockNoteBlock[];
}

interface BlockNoteBulletListBlock {
  id: string;
  type: 'bulletListItem' | 'numberedListItem';
  content: Array<{
    type: 'text';
    text: string;
    styles?: {
      bold?: boolean;
      italic?: boolean;
      code?: boolean;
    };
  }>;
  children?: BlockNoteBlock[];
}

type BlockNoteBlock = BlockNoteTextBlock | BlockNoteBulletListBlock;

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

**INSTRUCTIONS:**
- Determine call length from transcript and use appropriate number of phases (1-7)
- Short/quick calls should have FEWER phases - don't force many phases on a brief discussion
- Each phase should represent a natural shift in topic or conversation flow
- Capture ACTUAL content from the transcript - no generic placeholders
- Include specific names, numbers, dates mentioned
- Preserve chronological order of discussion
- Skip sections that have no relevant content
- For very short calls, the "Consolidated Outcomes" section may be the most valuable part

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
 * Convert markdown to BlockNote JSON format
 */
function convertMarkdownToBlockNote(markdown: string): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines at the beginning
    if (!line.trim() && blocks.length === 0) continue;

    // Heading (## or ### or ####)
    if (line.startsWith('####')) {
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: line.replace(/^####\s*/, ''), styles: {} }],
        children: [],
      });
    } else if (line.startsWith('###')) {
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: line.replace(/^###\s*/, ''), styles: {} }],
        children: [],
      });
    } else if (line.startsWith('##')) {
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: line.replace(/^##\s*/, ''), styles: {} }],
        children: [],
      });
    }
    // Bullet list item
    else if (line.match(/^[-*]\s/)) {
      blocks.push({
        id: uuidv4(),
        type: 'bulletListItem',
        content: [{ type: 'text', text: line.replace(/^[-*]\s*/, ''), styles: {} }],
        children: [],
      });
    }
    // Numbered list item
    else if (line.match(/^\d+\.\s/)) {
      blocks.push({
        id: uuidv4(),
        type: 'numberedListItem',
        content: [{ type: 'text', text: line.replace(/^\d+\.\s*/, ''), styles: {} }],
        children: [],
      });
    }
    // Regular paragraph
    else if (line.trim()) {
      // Handle bold text **text**
      const parts = line.split(/\*\*(.*?)\*\*/);
      const content: any[] = [];
      
      parts.forEach((part, idx) => {
        if (part) {
          if (idx % 2 === 1) {
            // Odd indices are bold text
            content.push({ type: 'text', text: part, styles: { bold: true } });
          } else {
            content.push({ type: 'text', text: part, styles: {} });
          }
        }
      });

      blocks.push({
        id: uuidv4(),
        type: 'paragraph',
        content: content.length > 0 ? content : [],
        children: [],
      });
    }
    // Empty line
    else {
      blocks.push({
        id: uuidv4(),
        type: 'paragraph',
        content: [],
        children: [],
      });
    }
  }

  return blocks;
}

/**
 * Get shareable canvas URL from viewAccessId
 */
function getCanvasUrl(viewAccessId: string): string {
  const frontendUrl = 'https://spaces.xyne.juspay.net';
  return `${frontendUrl}/chat/canvas/${viewAccessId}`;
}

export class CallDocumentService {
  /**
   * Create a fresh Agent instance for each request
   * This prevents state pollution between concurrent requests
   */
  private createAgent(): Agent | null {
    try {
      const apiKey = config.llm.litellmApiKey;
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
          defaultModel: config.llm.litellmModel || 'glm-latest',
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
          errorHandling: {},
        },
        events: {
          logging: LogLevel.ERROR,
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
   * Generate PRD from transcript and summary
   */
  async generatePRDFromTranscript(
    transcript: string,
    summary: string | null
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
      
      const prompt = PRD_GENERATION_PROMPT
        .replace('{transcript}', sanitizedTranscript)
        .replace('{summary}', sanitizedSummary || 'No summary available');

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
  async generateDetailedSummary(transcript: string): Promise<string | null> {
    const agent = this.createAgent();
    if (!agent) {
      logger.warn('[CallDocumentService] Failed to create agent for detailed summary');
      return null;
    }

    try {
      // Sanitize input to prevent injection attacks
      const sanitizedTranscript = sanitizeInput(transcript);
      
      const prompt = DETAILED_SUMMARY_PROMPT.replace('{transcript}', sanitizedTranscript);

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
    callStartedAt: Date
  ): Promise<string | null> {
    try {
      const prisma = DatabaseClient.getInstance();
      const now = new Date();

      const canvasId = uuidv4();
      const viewAccessId = uuidv4();
      const editAccessId = uuidv4();
      const participantId = uuidv4();

      // Extract title from markdown - use first heading or primary focus
      let title = `Detailed Summary - Call ${callStartedAt.toLocaleString()}`;
      const firstHeadingMatch = markdownSummary.match(/^#\s+(.+)$/m);
      if (firstHeadingMatch) {
        title = firstHeadingMatch[1].trim();
      } else {
        // Try to extract Primary Focus as fallback
        const primaryFocusMatch = markdownSummary.match(/\*\*Primary Focus:\*\*\s*(.+?)(?:\n|$)/i);
        if (primaryFocusMatch) {
          title = `Call Summary: ${primaryFocusMatch[1].trim()}`;
        }
      }
      const content = convertMarkdownToBlockNote(markdownSummary);

      // Create canvas
      await prisma.canvas.create({
        data: {
          id: canvasId,
          title,
          content: content as any,
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

      logger.info(`[CallDocumentService] Created detailed summary canvas ${canvasId} for call ${callId}`);
      return viewAccessId;
    } catch (error) {
      logger.error('[CallDocumentService] Failed to create detailed summary canvas:', error);
      return null;
    }
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
   * Post detailed summary canvas link to conversation
   */
  async postDetailedSummaryToConversation(
    conversationId: string,
    callId: string,
    canvasUrl: string,
    summaryTitle: string
  ): Promise<void> {
    try {
      const xyneAutomaticBot = await unifiedBotUserService.getBotByBotId('xyne-automatic');
      if (!xyneAutomaticBot) {
        throw new Error('Xyne Automatic bot not found');
      }

      const messageContent = `## 📊 ${summaryTitle}

A comprehensive detailed summary has been generated from this call.

[📄 View Detailed Summary](${canvasUrl})`;

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
        },
      });

      await repositories.conversations.incrementReplyCount(conversationId);
      
      // Update call message with canvas URL
      await this.updateCallMessageMetadata(conversationId, callId, 'detailedSummaryCanvasUrl', canvasUrl);
      
      logger.info(`[CallDocumentService] Posted detailed summary link to conversation ${conversationId}`);
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
    conversationId: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      // 1. Generate PRD from transcript
      const prd = await this.generatePRDFromTranscript(transcript, summary);
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
    conversationId: string
  ): Promise<{ success: boolean; canvasUrl?: string; error?: string }> {
    try {
      // 1. Generate detailed summary markdown
      const detailedSummaryMarkdown = await this.generateDetailedSummary(transcript);
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

      // 2. Create Canvas
      const viewAccessId = await this.createDetailedSummaryCanvas(
        callId,
        detailedSummaryMarkdown,
        xyneAutomaticBot.id,
        conversationId,
        conversation.channelId,
        call.startedAt
      );
      if (!viewAccessId) {
        return { success: false, error: 'Failed to create detailed summary canvas' };
      }

      const canvasUrl = getCanvasUrl(viewAccessId);
      const canvasTitle = `Detailed Summary - Call ${new Date(call.startedAt).toLocaleString()}`;

      // 3. Post to conversation
      await this.postDetailedSummaryToConversation(
        conversationId,
        callId,
        canvasUrl,
        canvasTitle
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
