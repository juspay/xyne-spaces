/**
 * Email Classification Service
 * Runs AI classification on incoming emails and resolves user group assignments.
 */

import { randomUUID } from 'crypto';
import { config as envConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { DatabaseClient } from '../database/client.js';
import { LLMClient, createUserMessage } from 'agentic-framework';
import { AgentsConfig } from '../agents/config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agents/agentLogger.js';
import type {
  ClassificationRawOutput,
  ClassificationResult,
  TicketClassificationData,
} from '../types/classification.js';

const AGENT_NAME = 'EmailClassification';

export class EmailClassificationService {
  private repo = new EmailClassificationRepository();

  // ─── Classification ────────────────────────────────────────────────────

  /**
   * Run classification on an email using the channel's configured prompt.
   * Returns category, subCategory, rawOutput, and the config for downstream use.
   */
  async classify(
    channelId: string,
    emailSubject: string,
    emailBody: string,
    { ignoreEnabled = false, agentsConfig }: { ignoreEnabled?: boolean; agentsConfig?: AgentsConfig } = {}
  ): Promise<{ result: ClassificationResult; config: any } | null> {
    const config = await this.repo.findConfigByChannelId(channelId);
    if (!config || (!config.enabled && !ignoreEnabled)) {
      return null;
    }

    const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
    const modelName = cacConfig.classificationModelName;
    const userMessage = `Subject: ${emailSubject}\n\n${emailBody}`;

    try {
      const rawOutput = await this.runClassificationAgent(
        config.classificationPrompt,
        userMessage,
        modelName
      );

      const category = this.extractField(rawOutput, config.categoryField) ?? 'Other';
      const subCategory = config.subCategoryField
        ? (this.extractField(rawOutput, config.subCategoryField) ?? null)
        : null;

      return { result: { category, subCategory, rawOutput }, config };
    } catch (error) {
      logger.error('[Classification] AI classification failed', {
        channelId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
      return null;
    }
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
   */
  async storeOnTicket(
    ticketId: string,
    result: ClassificationResult,
    resolvedGroupId: string | null
  ): Promise<void> {
    const ticket = await this.repo.findTicketById(ticketId);
    if (!ticket) return;

    const existing = ticket.classificationData as TicketClassificationData | null;
    const isManualOverride = existing?.isManualOverride ?? false;

    const classificationData: TicketClassificationData = {
      category: result.category,
      subCategory: result.subCategory,
      resolvedGroupId: isManualOverride ? (existing?.resolvedGroupId ?? resolvedGroupId) : resolvedGroupId,
      isManualOverride,
      classifiedAt: new Date().toISOString(),
      rawOutput: result.rawOutput,
    };

    await this.repo.updateTicketClassificationData(ticketId, classificationData);

    // Populate Additional Form Fields generically from raw AI output
    await this.populateFormFields(ticketId, result.rawOutput).catch((err) => {
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
  async populateFormFields(ticketId: string, rawOutput: ClassificationRawOutput): Promise<void> {
    if (!rawOutput || Object.keys(rawOutput).length === 0) return;

    const db = DatabaseClient.getInstance();

    // Get ticket's boardId
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { boardId: true },
    });
    if (!ticket?.boardId) return;

    // Find the form mapped to this board for TICKET entity
    const formMapping = await db.formContextMapping.findFirst({
      where: {
        contextId: ticket.boardId,
        contextType: 'BOARD',
        entityType: 'TICKET',
      },
    });
    if (!formMapping) return;

    // Get all fields for this form
    const formFields = await db.formFields.findMany({
      where: { formId: formMapping.formId },
    });
    if (formFields.length === 0) return;

    const now = new Date();
    const existingFieldNames = new Set(formFields.map(f => f.fieldName));

    // Dynamically create form fields for AI output keys that don't exist yet
    const skippedKeys = new Set(['summary', 'parse_reason']);
    const unmatchedKeys = Object.keys(rawOutput).filter(
      k => !skippedKeys.has(k) && !existingFieldNames.has(k)
    );

    for (const key of unmatchedKeys) {
      const aiValue = rawOutput[key];
      if (aiValue === undefined || aiValue === null || aiValue === 'null' || aiValue === '') continue;
      try {
        const newField = await db.formFields.upsert({
          where: { formId_fieldName: { formId: formMapping.formId, fieldName: key } },
          create: {
            id: randomUUID(),
            formId: formMapping.formId,
            fieldName: key,
            fieldType: 'STRING',
            isOptional: true,
            createdAt: now,
            updatedAt: now,
          },
          update: {},
        });
        formFields.push(newField);
      } catch (err) {
        logger.warn('[Classification] Failed to create dynamic form field', {
          ticketId,
          fieldName: key,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    for (const field of formFields) {
      const aiValue = rawOutput[field.fieldName];
      if (aiValue === undefined || aiValue === null || aiValue === 'null' || aiValue === '') continue;

      const valueStr = String(aiValue).trim();
      if (!valueStr) continue;

      // actualFieldValue: arrays for MULTI_SELECT/USER, scalar otherwise
      const isMulti = field.fieldType === 'MULTI_SELECT' || field.fieldType === 'USER';
      const actualFieldValue = isMulti ? [valueStr] : valueStr;

      try {
        await db.formEntityValues.upsert({
          where: {
            entityId_entityType_fieldId_contextId: {
              entityId: ticketId,
              entityType: 'TICKET',
              fieldId: field.id,
              contextId: ticket.boardId,
            },
          },
          create: {
            id: randomUUID(),
            formId: formMapping.formId,
            entityId: ticketId,
            entityType: 'TICKET',
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
      } catch (err) {
        logger.warn('[Classification] Failed to upsert form field value', {
          ticketId,
          fieldName: field.fieldName,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    logger.info('[Classification] Populated form fields from AI output', {
      ticketId,
      boardId: ticket.boardId,
      formId: formMapping.formId,
      fieldsMatched: formFields.filter(f => rawOutput[f.fieldName] != null).length,
      dynamicFieldsCreated: unmatchedKeys.length,
      totalFields: formFields.length,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async runClassificationAgent(
    systemPrompt: string,
    userMessage: string,
    modelName: string
  ): Promise<ClassificationRawOutput> {
    // Create fresh LLM client (following codebase pattern - no caching)
    const llmClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: envConfig.litellm.apiKey,
          baseUrl: envConfig.litellm.baseUrl,
          timeout: 120000,
          retries: 1,
        },
      },
      defaultModel: modelName,
      temperature: 0.1,
    });

    logLLMCallStart(AGENT_NAME, modelName, 'LITELLM_API_KEY');
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
}
