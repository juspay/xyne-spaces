/**
 * Network Document Workflow
 * 
 * Processes network documents (VISA/MASTERCARD) from GCS
 * Flow:
 * 1. FETCH - Download PDF from GCS using gcsPath from context
 * 2. EXTRACT_PDF_CONTENT - AI agent extracts content
 * 3. SUMMARIZE_DOCUMENT - AI agent analyzes and summarizes
 * 4. CREATE_TICKET - Create ticket with findings
 * 5. AUTO_ASSIGN_TICKET - Auto-assign to team member
 */

import { WorkflowEngine, AgenticCheckpointConfig } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { NetworkDocumentContext } from '../../types/workflow-enums';
import { WorkflowType } from '../../types/workflow-enums';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { z } from 'zod';
import { GCSService } from '@/services/gcsService';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { TicketController } from '@/controllers/ticketController';
import { conversationService } from '@/services/conversationService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { PDFParse } from 'pdf-parse';

// Typed metadata for network document workflow
export interface NetworkDocumentWorkflowMetadata {
  // GCS file info
  gcsPath: string;
  gcsBucket: string;
  fileSize: number;
  
  // Configuration IDs from env lookups
  projectId: string;
  boardId: string;
  channelId: string;
  userGroupId: string;
  systemUserId: string;
}

// Step IDs for network document workflow
export enum NetworkDocumentWorkflowSteps {
  FETCH = 'fetch',
  EXTRACT_PDF_CONTENT = 'extract_pdf_content',
  SUMMARIZE_DOCUMENT = 'summarize_document',
  CREATE_TICKET = 'create_ticket',
  AUTO_ASSIGN_TICKET = 'auto_assign_ticket',
}

// PDF extraction function using pdf-parse library (in memory!)
// Only extracts text content - analysis is done by LLM summarization
async function extractPdfContent(
  _context: NetworkDocumentContext,
  pdfBuffer: Buffer
): Promise<{ extractedContent: string; pageCount: number }> {
  logger.info(`[NETWORK_DOC] Extracting PDF content from buffer (${pdfBuffer.length} bytes)`);

  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    await parser.destroy();

    const extractedContent = result.text;
    const pageCount = result.total;

    logger.info(`[NETWORK_DOC] Extracted ${extractedContent.length} characters from ${pageCount} pages`);

    return { extractedContent, pageCount };
  } catch (error) {
    logger.error(`[NETWORK_DOC] Error extracting PDF:`, error);
    throw error;
  }
}

// Configuration for document summarization AI agent
function getDocumentSummarizationAgentConfig(
  context: NetworkDocumentContext,
  extractedContent: string
): AgenticCheckpointConfig {
  return {
    conversationContext: {
      initialUserMessage: `You are a card payments specialist analyzing ${context.network} network circulars for card transactions.

Document: ${context.fileName}
Content: ${extractedContent.substring(0, 15000)}${extractedContent.length > 15000 ? '\n\n[... truncated ...]' : ''}

VERDICT LOGIC:
- If document is relevant to acquirer (affects processing, fees, rules, or technical implementation): verdict="Relevant", verdictReason="Clear explanation of why it's relevant"
- If NOT applicable to acquirer (e.g., issuer-only changes, cardholder terms, or only affects card issuers): verdict="Not Relevant", verdictReason="Clear explanation of why it's not relevant"
- If for SMS transactions/acquirers: verdict="Not Relevant", verdictReason="Applies only to SMS transactions"

Provide analysis as JSON:
{
  "summary": "2-3 sentence executive summary",
  "keyFindings": ["finding 1", "finding 2", ...],
  "actionItems": [{"action": "description", "deadline": "when", "priority": "level"}, ...],
  "riskAssessment": "risk summary",
  "tags": ["base1", "base2", "acquirer", "network", "region (e.g., asia, india, europe)", ... include relevant tags found in document],
  "priority": "LOW/MEDIUM/HIGH/CRITICAL",
  "verdict": "Relevant | Not Relevant",
  "verdictReason": "Clear explanation for the verdict",
  "applicableDate": "YYYY-MM-DD when these changes take effect",
  "recommendation": "action needed / review / informational"
}`,
    },
    repoInfo: {
      repoUrl: ''
    },
  };
}

// Helper function to parse agent response
function parseAgentResult(agentResult: any): Record<string, any> {
  try {
    const messages = agentResult?.result?.messages || [];
    const lastAssistantMsg = messages
      .filter((m: any) => m.type === 'assistant')
      .pop();
    
    if (lastAssistantMsg?.content) {
      const jsonMatch = lastAssistantMsg.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Convert actionItems objects to strings if needed
        if (Array.isArray(parsed.actionItems)) {
          parsed.actionItems = parsed.actionItems.map((item: any) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item.action) {
              return `${item.action}${item.deadline ? ` (by ${item.deadline})` : ''}${item.priority ? ` [${item.priority}]` : ''}`;
            }
            return JSON.stringify(item);
          });
        }
        
        return parsed;
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return {};
}

// Step 1: FETCH - Get file buffer from GCS (in memory!)
async function fetchFileFromGcs(
  context: NetworkDocumentContext
): Promise<{ buffer: Buffer; fileSize: number; localPath: null }> {
  const gcsPath = context.metadata?.gcsPath;
  const gcsBucket = context.metadata?.gcsBucket;

  if (!gcsPath || !gcsBucket) {
    throw new Error('Missing gcsPath or gcsBucket in context metadata');
  }

  const gcsService = new GCSService(gcsBucket);
  const buffer = await gcsService.getFileBuffer(gcsPath);

  logger.info(`[NETWORK_DOC] Fetched file from GCS: ${gcsPath} (${buffer.length} bytes, in memory)`);

  return { buffer, fileSize: buffer.length, localPath: null };
}

// Step 2: Create ticket for document
async function createTicketForDocument(
  context: NetworkDocumentContext,
  analysisResult: { 
    summary: string; 
    keyFindings: string[]; 
    actionItems: string[]; 
    tags: string[]; 
    priority: string;
    verdict?: string;
    verdictReason?: string;
    baseClassification?: string;
    applicableDate?: string;
    dueDate?: string;
  },
  pdfBuffer: Buffer
): Promise<{ ticketId: string; ticketXyneId: string }> {
  logger.info(`[NETWORK_DOC] Creating ticket for document: ${context.fileName}`);

  try {
    // Get IDs from context metadata (passed from gcsPollingService)
    const projectId = context.metadata?.projectId;
    const boardId = context.metadata?.boardId;
    const channelId = context.metadata?.channelId;
    const systemUserId = context.metadata?.systemUserId;

    if (!projectId || !boardId || !channelId || !systemUserId) {
      throw new Error('Missing required IDs in context metadata');
    }

    // Create conversation with message using ConversationService
    const messageContent = `<strong>Processed Network Document:</strong> ${context.fileName}\n\n` +
                          `<strong>Analysis summary:</strong> ${analysisResult.summary}\n\n` +
                          `<strong>Key findings:</strong> ${analysisResult.keyFindings.length}\n` +
                          `<strong>Action items:</strong> ${analysisResult.actionItems.length}`;

    const { conversation } = await conversationService.createConversationWithMessage({
      channelId,
      userId: systemUserId,
      content: messageContent,
      msgType: 'USER',
    });

    // Create ticket using TicketController
    const ticketController = new TicketController();
    const ticket = await ticketController.createTicketWithConversation({
      title: `${context.network} Document: ${context.fileName}`,
      description: `<strong>📄 Document Analysis</strong>` +
                   `<br><br>` +
                   `<strong>Summary:</strong> ${analysisResult.summary}` +
                   `<br><br>` +
                   `<strong>⚖️ Verdict:</strong> ${analysisResult.verdict || 'PENDING'}` +
                   (analysisResult.verdictReason ? ` | ${analysisResult.verdictReason}` : '') +
                   `<br><br>` +
                   `<strong>🔍 Key Findings:</strong>` +
                   `<br>${analysisResult.keyFindings.map(f => `• ${f}`).join('<br>')}` +
                   `<br><br>` +
                   `<strong>✅ Action Items:</strong>` +
                   `<br>${analysisResult.actionItems.map(a => `• ${a}`).join('<br>')}` +
                   `<br><br>` +
                   `<strong>📅 Due Date:</strong> ${analysisResult.applicableDate || 'TBD'}`,
      createdBy: systemUserId,
      updatedBy: systemUserId,
      conversationId: conversation.conversationId,
      projectId,
      boardId,
      priority: analysisResult.priority || 'MEDIUM',
      statusV2: 'TODO',
      messageContent: `Ticket has been created and assigned, kindly find the network document hereunder.`
    });

    // Create tags (max 20)
    const uniqueTags = [...new Set(analysisResult.tags)].slice(0, 20);
    for (const tag of uniqueTags) {
      await db.ticketTag.create({
        data: { name: tag, ticketId: ticket.id },
      });
    }

    logger.info(`[NETWORK_DOC] Created ticket ${ticket.xyneId} (${ticket.id})`);
    logger.info(`[NETWORK_DOC] Ticket linked to message: ${conversation.initialMessageId}`);

    // Upload PDF buffer and send as new message after ticket
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: context.fileName,
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: pdfBuffer,
      size: pdfBuffer.length,
      destination: '',
      filename: context.fileName,
      path: '',
      stream: null as any,
    };

    await conversationService.addMessageToConversation({
      conversationId: conversation.conversationId,
      userId: systemUserId,
      content: 'Attachment',
      msgType: 'USER',
      files: [mockFile]
    });

    logger.info(`[NETWORK_DOC] PDF attached to conversation: ${context.fileName}`);

    return { ticketId: ticket.id, ticketXyneId: ticket.xyneId };
  } catch (error) {
    logger.error(`[NETWORK_DOC] Error creating ticket:`, error);
    throw error;
  }
}

// Step 3: Auto-assign ticket using TicketAssignmentService
async function autoAssignTicket(
  context: NetworkDocumentContext,
  ticketResult: { ticketId: string; ticketXyneId: string }
): Promise<{ assignedUserId: string | null; assignmentReason: string }> {
  logger.info(`[NETWORK_DOC] Auto-assigning ticket: ${ticketResult.ticketXyneId}`);

  try {
    const userGroupId = context.metadata?.userGroupId || 
                       process.env.NETWORK_DOCUMENT_DEFAULT_USER_GROUP_ID;

    if (!userGroupId) {
      return { assignedUserId: null, assignmentReason: 'No userGroupId configured' };
    }

    const assignmentResult = await ticketAssignmentService.assignTicket({ userGroupId });

    if (!assignmentResult) {
      return { assignedUserId: null, assignmentReason: 'No team members found' };
    }

    const updatedTicket = await db.ticket.update({
      where: { id: ticketResult.ticketId },
      data: { 
        assignedTo: assignmentResult.assignedUserId,
        updatedBy: context.metadata?.systemUserId,
      },
    });

    await syncConversationTicketMdFromPrismaTicket(db, updatedTicket);

    return { assignedUserId: assignmentResult.assignedUserId, assignmentReason: assignmentResult.reason };
  } catch (error) {
    logger.error(`[NETWORK_DOC] Error auto-assigning:`, error);
    return { assignedUserId: null, assignmentReason: `Assignment failed: ${error}` };
  }
}

export const NetworkDocumentInputSchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  localPath: z.string(),
  network: z.string(),
  ticketId: z.string().optional(),
  metadata: z.object({
    gcsPath: z.string(),
    gcsBucket: z.string(),
    fileSize: z.number(),
    projectId: z.string(),
    boardId: z.string(),
    channelId: z.string(),
    userGroupId: z.string().optional(),
    systemUserId: z.string(),
  }).optional(),
});

export type NetworkDocumentInput = z.infer<typeof NetworkDocumentInputSchema>;

export const networkDocumentContextMapper = (payload: NetworkDocumentInput & { ticketId: string }): NetworkDocumentContext => ({
  ticketId: payload.ticketId,
  fileId: payload.fileId,
  fileName: payload.fileName,
  localPath: payload.localPath,
  network: payload.network,
  metadata: payload.metadata,
});

// Export workflow definition
export const networkDocumentWorkflow: WorkflowDefinition<
  NetworkDocumentContext,
  void,
  typeof NetworkDocumentWorkflowSteps
> = {
  type: WorkflowType.NETWORK_DOCUMENT_PROCESSING,
  name: 'Network Document Processing',
  description: 'Processes VISA/MASTERCARD network documents from GCS with AI analysis and auto-assignment',
  inputSchema: NetworkDocumentInputSchema,
  contextMapper: networkDocumentContextMapper,

  async execute(engine: WorkflowEngine<NetworkDocumentContext, typeof NetworkDocumentWorkflowSteps>) {
    const context = engine.getContext();
    logger.info(`[NETWORK_DOC] Starting workflow for ${context.fileName} (${context.network})`);

    try {
      // Step 1: FETCH - Download file from GCS
      const fetchResult = await engine.createCheckpoint(
        NetworkDocumentWorkflowSteps.FETCH,
        fetchFileFromGcs,
        context
      );
      logger.info(`[NETWORK_DOC] Fetched file from GCS: ${context.fileName} (${fetchResult.fileSize} bytes, in memory)`);

      // Step 2: Extract PDF content using pdf-parse library (in memory)
      const extractionResult = await engine.createCheckpoint(
        NetworkDocumentWorkflowSteps.EXTRACT_PDF_CONTENT,
        extractPdfContent,
        context,
        fetchResult.buffer
      );
      logger.info(`[NETWORK_DOC] Extraction complete: ${extractionResult.extractedContent.length} chars from ${extractionResult.pageCount} pages`);

      // Step 3: Summarize document using AI agent
      const summaryAgentResult = await engine.createAgenticCheckpoint(
        NetworkDocumentWorkflowSteps.SUMMARIZE_DOCUMENT,
        'document-summarization-agent',
        getDocumentSummarizationAgentConfig(context, extractionResult.extractedContent || '')
      );

      const analysisResult = parseAgentResult(summaryAgentResult);
      logger.info(`[NETWORK_DOC] Analysis complete: ${analysisResult.keyFindings?.length || 0} findings`);

      // Step 4: Create ticket (pass PDF buffer for attachment)
      const ticketResult = await engine.createCheckpoint(
        NetworkDocumentWorkflowSteps.CREATE_TICKET,
        createTicketForDocument,
        context,
        {
          summary: analysisResult.summary || `Analysis of ${context.fileName}`,
          keyFindings: analysisResult.keyFindings || [],
          actionItems: analysisResult.actionItems || [],
          tags: (analysisResult.tags || []).filter((t: unknown): t is string => typeof t === 'string').slice(0, 20),
          priority: analysisResult.priority || 'MEDIUM',
          verdict: analysisResult.verdict,
          verdictReason: analysisResult.verdictReason,
          baseClassification: analysisResult.baseClassification,
          applicableDate: analysisResult.applicableDate,
        },
        fetchResult.buffer
      );
      logger.info(`[NETWORK_DOC] Ticket created: ${ticketResult.ticketXyneId}`);

      // Step 5: Auto-assign ticket
      const assignmentResult = await engine.createCheckpoint(
        NetworkDocumentWorkflowSteps.AUTO_ASSIGN_TICKET,
        autoAssignTicket,
        context,
        ticketResult
      );
      logger.info(`[NETWORK_DOC] Auto-assignment: ${assignmentResult.assignmentReason}`);

      logger.info(`[NETWORK_DOC] Workflow completed successfully`);
    } catch (error) {
      logger.error(`[NETWORK_DOC] Workflow failed:`, error);
      throw error;
    }
  },
};
