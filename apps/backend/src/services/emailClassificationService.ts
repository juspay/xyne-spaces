/**
 * Email Classification Service
 * Runs AI classification on incoming emails and resolves user group assignments.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { resolveFormFieldDefinitionsForForm } from '../utils/fieldDefinition.js';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { DatabaseClient } from '../database/client.js';
import { LLMClient, createUserMessage } from 'agentic-framework';
import { AgentsConfig } from '../agents/config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agents/agentLogger.js';
import type {
  ClassificationRawOutput,
  ClassificationResult,
  EmailMetadata,
  TicketClassificationData,
  TicketClassificationDataWithPriority,
  PriorityClassificationResult,
} from '../types/classification.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { ActivityType, OrgLLMServiceAccountPurpose, TicketPriority, FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';

const AGENT_NAME = 'EmailClassification';
const PRIORITY_AGENT_NAME = 'EmailPriorityClassification';
const AI_FORM_FIELD_SKIP_KEYS = new Set(['summary', 'parse_reason', 'priority', 'confidence', 'reasoning']);

/** Default prompt for priority classification */
const DEFAULT_PRIORITY_PROMPT = `You are an expert support ticket prioritizer for a customer support desk.

Analyze the email and assign a priority level based on:
- Urgency indicators (outage, critical, urgent, down, broken, failure, crash, emergency)
- Business impact (revenue loss, customer blocked, production affected, payment failing)
- Time sensitivity (ASAP, immediately, deadline, expires, today, now)
- Number of affected customers (many, widespread, everyone, multiple clients)
- Security concerns (security breach, vulnerability, hack, attack)
- Severity descriptors (major issue, completely down, severe, catastrophic)
- Escalation indicators (escalate, manager, supervisor, urgent attention)

IMPORTANT: Your response must be ONLY a valid JSON object with no markdown formatting.

Email Subject: {subject}

Email Body: {body}

Respond with this exact JSON structure:
{
  "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": number between 0.0 and 1.0,
  "reasoning": "Brief explanation of why this priority was chosen"
}`;

export class EmailClassificationService {
  private repo = new EmailClassificationRepository();

  // ─── Classification ────────────────────────────────────────────────────

  /**
   * Run classification on an email using the channel's configured prompt.
   * Returns category, subCategory, rawOutput, and the config for downstream use.
   * Now also includes priority classification when enabled.
   */
  async classify(
    channelId: string,
    emailSubject: string,
    emailBody: string,
    {
      ignoreEnabled = false,
      agentsConfig,
      emailMetadata,
    }: {
      ignoreEnabled?: boolean;
      agentsConfig?: AgentsConfig;
      emailMetadata?: EmailMetadata;
    } = {}
  ): Promise<{
    result: ClassificationResult & { priority?: PriorityClassificationResult };
    config: any
  } | null> {
    const config = await this.repo.findConfigByChannelId(channelId);
    if (!config || (!config.enabled && !ignoreEnabled)) {
      return null;
    }

    const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
    const modelName = cacConfig.classificationModelName;

    const metadataLines = [
      emailMetadata?.fromEmail ? `From: ${emailMetadata.fromEmail}` : null,
      emailMetadata?.toEmails?.length ? `To: ${emailMetadata.toEmails.join(', ')}` : null,
      emailMetadata?.ccEmails?.length ? `CC: ${emailMetadata.ccEmails.join(', ')}` : null,
      emailMetadata?.bccEmails?.length ? `BCC: ${emailMetadata.bccEmails.join(', ')}` : null,
      emailMetadata?.replyTo?.length ? `Reply-To: ${emailMetadata.replyTo.join(', ')}` : null,
      emailMetadata?.receivedAt ? `Date: ${emailMetadata.receivedAt}` : null,
      `Subject: ${emailSubject}`,
    ].filter(Boolean).join('\n');

    const userMessage = `${metadataLines}\n\n${emailBody}`;

    try {
      // Run category and priority classification in PARALLEL
      const categoryPromise = this.runClassificationAgent(
        config.classificationPrompt,
        userMessage,
        modelName,
        config.ownerUserId,
      );

      const priorityPromise = config.priorityClassificationEnabled
        ? this.classifyPriority(
            channelId,
            emailSubject,
            emailBody,
            config.priorityClassificationPrompt,
            modelName,
            config.ownerUserId,
          )
        : Promise.resolve(null);

      const [rawOutput, priorityResult] = await Promise.all([
        categoryPromise,
        priorityPromise,
      ]);

      const category = this.extractField(rawOutput, config.categoryField) ?? 'Other';
      const subCategory = config.subCategoryField
        ? (this.extractField(rawOutput, config.subCategoryField) ?? null)
        : null;

      const result: ClassificationResult & { priority?: PriorityClassificationResult } = {
        category,
        subCategory,
        rawOutput,
      };

      if (priorityResult) {
        result.priority = priorityResult;
      }

      return { result, config };
    } catch (error) {
      logger.error('[Classification] AI classification failed', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Run priority classification on an email.
   * Uses the channel's custom prompt if available, otherwise uses default prompt.
   */
  async classifyPriority(
    channelId: string,
    emailSubject: string,
    emailBody: string,
    customPrompt: string | null | undefined,
    modelName: string,
    ownerUserId?: string | null,
  ): Promise<PriorityClassificationResult | null> {
    logger.info('[PriorityClassification] classifyPriority STARTED', {
      channelId,
      hasCustomPrompt: !!customPrompt,
      modelName,
    });

    const prompt = customPrompt?.trim() 
      ? this.prepareCustomPrompt(customPrompt, emailSubject, emailBody)
      : DEFAULT_PRIORITY_PROMPT
          .replace('{subject}', emailSubject)
          .replace('{body}', emailBody);

    logger.info('[PriorityClassification] Prompt prepared', {
      isCustomPrompt: !!customPrompt?.trim(),
    });

    try {
      const rawOutput = await this.runPriorityClassificationAgent(prompt, modelName, ownerUserId);
      const result = this.parsePriorityOutput(rawOutput);
      logger.info('[PriorityClassification] parsePriorityOutput completed', {
        hasResult: !!result,
        result: result ? {
          priority: result.priority,
          confidence: result.confidence,
        } : null,
      });
      
      return result;
    } catch (error) {
      logger.error('[PriorityClassification] ERROR in classifyPriority', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Prepare custom prompt by replacing placeholders.
   */
  private prepareCustomPrompt(
    customPrompt: string,
    emailSubject: string,
    emailBody: string
  ): string {
    return customPrompt
      .replace(/\{\{subject\}\}/gi, emailSubject)
      .replace(/\{\{body\}\}/gi, emailBody)
      .replace(/\{subject\}/gi, emailSubject)
      .replace(/\{body\}/gi, emailBody);
  }

  /**
   * Given classification result and config, find the best matching user group from mapping table.
   * Matches by category first, then subCategory keywords. Falls back to catch-all (null subCategory).
   */
  async resolveUserGroup(result: ClassificationResult, config: any): Promise<string | null> {
    if (!config) return null;

    const mappings = config.mappings.filter(
      (m: { category: string }) => m.category.toLowerCase() === result.category.toLowerCase()
    );

    if (mappings.length === 0) return null;

    // Try to find a subCategory match first
    if (result.subCategory) {
      const subCatLower = result.subCategory.toLowerCase();
      for (const mapping of mappings) {
        if (!mapping.subCategory) continue;
        const keywords = mapping.subCategory.split(',').map((k: string) => k.trim().toLowerCase());
        const matches = keywords.some((kw: string) => subCatLower.includes(kw) || kw.includes(subCatLower));
        if (matches) {
          return mapping.userGroupId;
        }
      }
    }

    // Fall back to catch-all row (subCategory is null)
    const catchAll = mappings.find((m: { subCategory: string | null }) => !m.subCategory);
    return catchAll?.userGroupId ?? null;
  }

  /**
   * Store classification result on the ticket.
   * Respects isManualOverride — if already manually overridden, updates rawOutput but not resolvedGroupId.
   * Also stores priority classification data if available.
   */
  async storeOnTicket(
    ticketId: string,
    result: ClassificationResult & { priority?: PriorityClassificationResult },
    resolvedGroupId: string | null,
    opts: { config?: { categoryField?: string; subCategoryField?: string | null }; actorId?: string | null } = {},
  ): Promise<void> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) return;

    const existing = ticket.classificationData as TicketClassificationData | null;
    const isManualOverride = existing?.isManualOverride ?? false;

    const classificationData: TicketClassificationDataWithPriority = {
      category: result.category,
      subCategory: result.subCategory,
      resolvedGroupId: isManualOverride ? (existing?.resolvedGroupId ?? resolvedGroupId) : resolvedGroupId,
      isManualOverride,
      classifiedAt: new Date().toISOString(),
      rawOutput: result.rawOutput,
    };

    // Include priority data if available
    if (result.priority) {
      classificationData.priority = result.priority.priority;
      classificationData.priorityConfidence = result.priority.confidence;
      classificationData.priorityReasoning = result.priority.reasoning;
    }

    await this.repo.updateTicketClassificationData(ticketId, classificationData);

    // Populate Additional Form Fields generically from raw AI output
    await this.populateFormFields(ticketId, result.rawOutput, {
      // The category/sub-category keys already have dedicated storage (ticket.aiCategory /
      // aiSubCategory) and their own UI. Writing them into a same-named form field too would
      // silently clobber whatever else owns that field (e.g. an automation).
      skipFieldNames: [opts.config?.categoryField, opts.config?.subCategoryField],
      actorId: opts.actorId ?? null,
    }).catch((err) => {
      logger.warn('[Classification] populateFormFields failed (non-fatal)', {
        ticketId,
        error: err instanceof Error ? err.message : err,
      });
    });
  }

  /**
   * Manually override AI classification values (category + subCategory).
   * Re-resolves user group from new category and updates ticket.userGroupId.
   * Returns the new resolved group ID (or null if no match).
   */
  async overrideClassificationValues(
    ticketId: string,
    channelId: string,
    category: string,
    subCategory: string | null
  ): Promise<string | null> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) return null;

    const existing = (ticket.classificationData ?? {}) as Partial<TicketClassificationData>;

    const updated: TicketClassificationData = {
      category,
      subCategory,
      resolvedGroupId: existing.resolvedGroupId ?? null,
      isManualOverride: true,
      classifiedAt: existing.classifiedAt ?? new Date().toISOString(),
      rawOutput: existing.rawOutput ?? {},
    };

    // Fetch config to re-resolve user group from the new category
    const config = await this.repo.findConfigByChannelId(channelId);
    const newResolvedGroupId = await this.resolveUserGroup({
      category,
      subCategory,
      rawOutput: existing.rawOutput ?? {},
    }, config);

    updated.resolvedGroupId = newResolvedGroupId;
    await this.repo.updateTicketClassificationData(ticketId, updated);

    // Also update ticket.userGroupId so it reflects immediately
    if (newResolvedGroupId) {
      const db = DatabaseClient.getInstance();
      await db.ticket.update({
        where: { id: ticketId },
        data: { userGroupId: newResolvedGroupId },
      });
    }

    return newResolvedGroupId;
  }

  /**
   * Populate ticket's Additional Form Fields from AI raw output.
   * Generic: looks up the form attached to the ticket's board, then matches
   * rawOutput keys against field names — no hardcoding required.
   */
  async populateFormFields(
    ticketId: string,
    rawOutput: ClassificationRawOutput,
    opts: { skipFieldNames?: (string | null | undefined)[]; actorId?: string | null } = {},
  ): Promise<void> {
    if (!rawOutput || Object.keys(rawOutput).length === 0) return;

    const db = DatabaseClient.getInstance();

    // Get ticket's boardId
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true, workspaceId: true },
    });
    if (!ticket?.boardId) return;

    // Find the form mapped to this board for TICKET entity
    const formMapping = await db.formContextMapping.findFirst({
      where: {
        contextId: ticket.boardId,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });
    if (!formMapping) return;

    // Get all fields for this form (resolved across global + legacy definitions)
    const formFields = await resolveFormFieldDefinitionsForForm(db, formMapping.formId);
    if (formFields.length === 0) return;

    const now = new Date();
    const skipKeys = new Set(AI_FORM_FIELD_SKIP_KEYS);
    for (const name of opts.skipFieldNames ?? []) {
      const trimmed = name?.trim();
      if (trimmed) skipKeys.add(trimmed);
    }
    const writableFields = formFields.filter(field => !skipKeys.has(field.fieldName));

    // Resolve current visit version so revisits don't overwrite prior-visit form values.
    // Compute the max in code (NULL = version 1): the version column is nullable with no DB
    // default, and ORDER BY version DESC would sort NULLs first in Postgres — a legacy NULL
    // row would masquerade as the latest version.
    const existingValues = await db.formEntityValues.findMany({
      where: { entityId: ticketId, entityType: 'TICKET', contextId: ticket.boardId },
      select: { version: true, fieldId: true, fieldValue: true },
    });
    const currentVersion = existingValues.reduce((max, v) => Math.max(max, v.version ?? 1), 1);

    // Prior values at the version we are about to write, so the activity log can show from → to.
    const previousValueByFieldId = new Map(
      existingValues
        .filter(v => (v.version ?? 1) === currentVersion)
        .map(v => [v.fieldId, v.fieldValue]),
    );
    const changes: { fieldName: string; oldValue: string | null; newValue: string }[] = [];

    for (const field of writableFields) {
      const aiValue = rawOutput[field.fieldName];
      if (aiValue === undefined || aiValue === null || aiValue === 'null' || aiValue === '') continue;

      const valueStr = String(aiValue).trim();
      if (!valueStr) continue;

      const previousValue = previousValueByFieldId.get(field.id) ?? null;
      if (previousValue === valueStr) continue; // no-op — don't rewrite or log

      // actualFieldValue: arrays for MULTI_SELECT/USER, scalar otherwise
      const isMulti = field.fieldType === FormFieldType.MULTI_SELECT || field.fieldType === FormFieldType.USER;
      const actualFieldValue = isMulti ? [valueStr] : valueStr;

      try {
        await db.formEntityValues.upsert({
          where: {
            entityId_entityType_fieldId_contextId_version: {
              entityId: ticketId,
              entityType: 'TICKET',
              fieldId: field.id,
              contextId: ticket.boardId,
              version: currentVersion,
            },
          },
          create: {
            id: randomUUID(),
            formId: formMapping.formId,
            workspaceId: ticket.workspaceId,
            entityId: ticketId,
            entityType: 'TICKET',
            version: currentVersion,
            fieldId: field.id,
            contextId: ticket.boardId,
            fieldValue: valueStr,
            actualFieldValue,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            fieldValue: valueStr,
            actualFieldValue,
            updatedAt: now,
          },
        });
        changes.push({ fieldName: field.fieldName, oldValue: previousValue, newValue: valueStr });
      } catch (err) {
        logger.warn('[Classification] Failed to upsert form field value', {
          ticketId,
          fieldName: field.fieldName,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    // Audit trail: without this the ticket's Activity log still credits whoever wrote the
    // value previously (e.g. "Automation set Category ..."), which is misleading once the AI
    // has overwritten it. Mirrors the shape used by the UPDATE_FORM_FIELDS automation step.
    if (changes.length > 0 && opts.actorId) {
      try {
        await db.ticketActivity.createMany({
          data: changes.map(change => ({
            ticketId,
            workspaceId: ticket.workspaceId,
            updatedBy: opts.actorId as string,
            activityType: ActivityType.METADATA,
            value: {
              field: 'customField',
              fieldName: change.fieldName,
              oldValue: change.oldValue,
              newValue: change.newValue,
              isAiClassification: true,
            },
          })),
        });
      } catch (err) {
        logger.warn('[Classification] Failed to log form field activity', {
          ticketId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    logger.info('[Classification] Populated form fields from AI output', {
      ticketId,
      boardId: ticket.boardId,
      formId: formMapping.formId,
      fieldsMatched: writableFields.filter(f => rawOutput[f.fieldName] != null).length,
      totalFields: writableFields.length,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async runClassificationAgent(
    systemPrompt: string,
    userMessage: string,
    modelName: string,
    ownerUserId?: string | null,
  ): Promise<ClassificationRawOutput> {
    const credential = await orgLLMCredentialService.getCredentialByUserId(
      ownerUserId,
      OrgLLMServiceAccountPurpose.DEFAULT,
    );
    if (!credential) {
      throw new Error('LiteLLM credentials are not configured for this organization');
    }

    // Create fresh LLM client (following codebase pattern - no caching)
    const llmClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: credential.apiKey,
          baseUrl: credential.baseUrl,
          timeout: 120000,
          retries: 1,
        },
      },
      defaultModel: modelName,
      temperature: 0.1,
      retry: { maxAttempts: 5, baseDelay: 2000, maxDelay: 16000, exponentialBackoff: true },
    });

    logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');
    try {
      const response = await llmClient.generate({
        messages: [createUserMessage(userMessage)],
        systemPrompt,
        parameters: {
          temperature: 0.1,
          maxTokens: 8192,
        },
        extraBody: {
          chat_template_kwargs: {
            enable_thinking: false,
          },
        },
      });

      logLLMSuccess(AGENT_NAME, response.content);
      return this.parseClassificationOutput(response.content);
    } catch (error) {
      logLLMError(AGENT_NAME, error);
      throw error;
    }
  }

  private parseClassificationOutput(content: string): ClassificationRawOutput {
    // Strip <think> blocks and markdown code fences if present
    const cleaned = content
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // Extract JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('[Classification] Could not find JSON in AI output', { content: cleaned.slice(0, 200) });
      return {};
    }

    try {
      return JSON.parse(jsonMatch[0]) as ClassificationRawOutput;
    } catch (e) {
      logger.warn('[Classification] Failed to parse classification JSON', { error: e });
      return {};
    }
  }

  private extractField(rawOutput: ClassificationRawOutput, fieldName: string): string | null {
    const value = rawOutput[fieldName.trim()];
    if (value === undefined || value === null || value === 'null') return null;
    return String(value).trim() || null;
  }

  // ─── Priority Classification Helpers ──────────────────────────────────────

  private async runPriorityClassificationAgent(
    systemPrompt: string,
    modelName: string,
    ownerUserId?: string | null,
  ): Promise<ClassificationRawOutput> {
    const credential = await orgLLMCredentialService.getCredentialByUserId(
      ownerUserId,
      OrgLLMServiceAccountPurpose.DEFAULT,
    );
    if (!credential) {
      logger.error('[PriorityClassification] Org LiteLLM credentials are not configured');
      throw new Error('LiteLLM credentials not configured');
    }

    logger.info('[PriorityClassification] Starting LLM call', {
      modelName,
    });

    // Create fresh LLM client (following codebase pattern - no caching)
    const llmClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: credential.apiKey,
          baseUrl: credential.baseUrl,
          timeout: 120000,
          retries: 1,
        },
      },
      defaultModel: modelName,
      temperature: 0.1,
      retry: { maxAttempts: 5, baseDelay: 2000, maxDelay: 16000, exponentialBackoff: true },
    });

    logLLMCallStart(PRIORITY_AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');
    try {
      const response = await llmClient.generate({
        messages: [createUserMessage('Analyze email and determine priority.')],
        systemPrompt,
        parameters: {
          temperature: 0.1,
          maxTokens: 4096,
        },
        extraBody: {
          chat_template_kwargs: {
            enable_thinking: false,
          },
        },
      });

      logger.info('[PriorityClassification] LLM call successful', {
        hasContent: !!response.content,
      });
      return this.parseClassificationOutput(response.content);
    } catch (error) {
      logLLMError(PRIORITY_AGENT_NAME, error);
      logger.error('[PriorityClassification] LLM call failed', {
        error: error instanceof Error ? error.message : error,
        modelName,
      });
      throw error;
    }
  }

  private parsePriorityOutput(rawOutput: ClassificationRawOutput): PriorityClassificationResult | null {
    logger.info('[PriorityClassification] parsePriorityOutput STARTED', {
      rawOutputKeys: Object.keys(rawOutput),
    });

    const priorityRaw = rawOutput['priority'];
    const confidenceRaw = rawOutput['confidence'];
    const reasoningRaw = rawOutput['reasoning'];

    logger.info('[PriorityClassification] Extracted fields', {
      hasPriority: priorityRaw !== undefined && priorityRaw !== null,
      hasConfidence: confidenceRaw !== undefined && confidenceRaw !== null,
      hasReasoning: reasoningRaw !== undefined && reasoningRaw !== null,
    });

    if (!priorityRaw) {
      logger.error('[PriorityClassification] ERROR: priority field is missing or null');
      return null;
    }

    // Parse and validate priority
    const priorityStr = String(priorityRaw).trim().toUpperCase();
    logger.info('[PriorityClassification] Parsed priority string', {
      original: priorityRaw,
      parsed: priorityStr,
    });

    const validPriorities: TicketPriority[] = [
      TicketPriority.LOW,
      TicketPriority.MEDIUM,
      TicketPriority.HIGH,
      TicketPriority.CRITICAL,
    ];

    const priority = validPriorities.find(p => p === priorityStr);
    if (!priority) {
      logger.error('[PriorityClassification] ERROR: Invalid priority value', { 
        priorityStr,
      });
      return null;
    }

    // Parse confidence (default to 0.5 if invalid)
    let confidence = 0.5;
    if (confidenceRaw !== undefined && confidenceRaw !== null) {
      const confidenceNum = Number(confidenceRaw);
      if (!isNaN(confidenceNum)) {
        confidence = Math.max(0, Math.min(1, confidenceNum));
        logger.info('[PriorityClassification] Parsed confidence', { parsed: confidence });
      } else {
        logger.warn('[PriorityClassification] Confidence is not a valid number, using default');
      }
    } else {
      logger.info('[PriorityClassification] Confidence not provided, using default 0.5');
    }

    // Parse reasoning (default to empty string)
    const reasoning = reasoningRaw ? String(reasoningRaw).trim() : '';
    logger.info('[PriorityClassification] Parsed reasoning', { hasReasoning: reasoning.length > 0 });

    logger.info('[PriorityClassification] parsePriorityOutput SUCCESS', {
      priority,
      confidence,
      reasoningLength: reasoning.length,
    });

    return { priority, confidence, reasoning };
  }
}
