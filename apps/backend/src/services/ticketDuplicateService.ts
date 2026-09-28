import { logger } from '@/utils/logger';
import { MAX_DUPLICATE_SCOPE_FIELDS, TicketReferenceRelation } from '@xyne/shared';
import {
  resolveBoardTicketFormId,
  resolveFormFieldDefinitionsForForm,
} from '@/utils/fieldDefinition';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { vespaService } from '@/services/vespaSearch';
import { RankProfile } from '@/vespa/src/types';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { buildFormFields } from '@/zero/vespa-injection/core/form-fields';
import type {
  TicketDuplicateCandidate,
  TicketDuplicateCheckAnalysis,
} from '@/types/ticket';
import {
  analyzeTicketDuplicates,
  type TicketDuplicateCandidateInput,
  type TicketDuplicateContext,
} from '@/agents/ticket-duplicate';

const prisma = DatabaseClient.getInstance();
const emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();
const DUPLICATE_REFERENCE_LIMIT = 10;

/**
 * One raw scope-field value carried by the NEW ticket, handed to the service as a
 * 1:1 map of the caller's precomputed custom-field write payload entries (fieldId +
 * raw actualFieldValue — never re-read from the DB here: desk flows sync form values
 * only AFTER ticket creation, so reading would race). In-service normalization
 * (via buildFormFields) and project/type resolution both happen lazily inside
 * buildScopeDynamicFieldValues.
 */
export type DuplicateScopeFieldValue = {
  fieldId: string;
  value: unknown;
};

/**
 * A configured scope field resolved against the channel's board form, ready to
 * become one `fieldId::value` token.
 */
type ResolvedDuplicateScopeField = {
  fieldId: string;
  values: string[];
};

// EmailChannelPreference.duplicateScopeConfig (nullable Json). Anything malformed
// falls back to "disabled" — a bad config must never crash duplicate detection.
const duplicateScopeConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  scopeFieldGlobalIds: z.array(z.string()).max(MAX_DUPLICATE_SCOPE_FIELDS).optional().default([]),
});
type DuplicateScopeConfig = z.infer<typeof duplicateScopeConfigSchema>;

/**
 * Map raw custom-field values onto scope fields for duplicate detection.
 *
 * Token values come from buildFormFields — the very function the Vespa mapper uses
 * to write `formFields` — fed the same raw value and the field's real type. Every
 * field type is therefore supported, and the token can never drift from the indexed
 * representation: date normalization, per-element rows for multi-select/user, and
 * scalar normalization all come from one implementation rather than a copy.
 */
export const buildDuplicateScopeFieldValues = async (params: {
  boardId: string;
  fieldValues: ReadonlyArray<DuplicateScopeFieldValue>;
}): Promise<ResolvedDuplicateScopeField[]> => {
  const { boardId, fieldValues } = params;
  if (!boardId || fieldValues.length === 0) {
    return [];
  }

  const rawValueByFieldId = new Map<string, unknown>();
  for (const { fieldId, value } of fieldValues) {
    if (!fieldId || value === null || value === undefined || rawValueByFieldId.has(fieldId)) continue;
    rawValueByFieldId.set(fieldId, value);
  }
  if (rawValueByFieldId.size === 0) {
    return [];
  }

  try {
    const formId = await resolveBoardTicketFormId(prisma, boardId);
    if (!formId) {
      return [];
    }

    const boardFields = await resolveFormFieldDefinitionsForForm(prisma, formId);
    const scopableFields = boardFields.filter(field => rawValueByFieldId.has(field.id));
    if (scopableFields.length === 0) {
      return [];
    }
    const fieldTypeByFieldId = new Map(
      scopableFields.map(field => [field.id, field.fieldType] as const),
    );

    // Same inputs the indexer gets, so the rows come out identical.
    const indexedRows = buildFormFields(
      scopableFields.map(({ id }) => ({
        fieldId: id,
        actualFieldValue: rawValueByFieldId.get(id) as Prisma.JsonValue,
      })),
      fieldTypeByFieldId,
    );

    const valuesByFieldId = new Map<string, string[]>();
    for (const row of indexedRows) {
      const value = row.fieldValue?.trim();
      if (!value) continue;
      const values = valuesByFieldId.get(row.fieldId);
      if (values) {
        if (!values.includes(value)) values.push(value);
      } else {
        valuesByFieldId.set(row.fieldId, [value]);
      }
    }

    return [...valuesByFieldId].map(([fieldId, values]) => ({ fieldId, values }));
  } catch (error) {
    // Scope expansion is best-effort: pass nothing scoped rather than risk a
    // wrongly-built filter — detection falls back to project-wide behavior.
    logger.warn('[TicketDuplicateService] Failed to build scope field values, falling back to project-wide detection', {
      boardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

// Cap on the text handed to Vespa, mirroring the agent's MAX_DESCRIPTION_LENGTH.
const VESPA_QUERY_MAX_LENGTH = 4000;

// Desk tickets carry raw HTML email bodies, so strip markup before it reaches the
// lexical term and the embedding. Mirrors normalizePromptText in agents/ticket-duplicate.
const buildDuplicateSearchQuery = (title: string, description: string): string => {
  const plainTitle = extractPlainTextFromHtml(title).trim() || title.trim();
  const plainDescription = extractPlainTextFromHtml(description).trim();
  return `${plainTitle}\n\n${plainDescription}`.trim().slice(0, VESPA_QUERY_MAX_LENGTH);
};

class TicketDuplicateService {
  private async resolveDuplicateScopeConfig(
    channelId: string | undefined,
  ): Promise<{ config: DuplicateScopeConfig; boardId: string } | null> {
    if (!channelId) {
      return null;
    }

    try {
      const preference = await emailChannelPreferenceRepo.findByChannelId(channelId);
      if (!preference?.duplicateScopeConfig) {
        return null;
      }

      let rawConfig: unknown = preference.duplicateScopeConfig;
      if (typeof rawConfig === 'string') {
        try {
          rawConfig = JSON.parse(rawConfig);
        } catch {
          logger.warn('[TicketDuplicateService] Unparsable duplicateScopeConfig string on channel, treating as disabled', {
            channelId,
          });
          return null;
        }
      }

      const parsed = duplicateScopeConfigSchema.safeParse(rawConfig);
      if (!parsed.success) {
        logger.warn('[TicketDuplicateService] Malformed duplicateScopeConfig on channel, treating as disabled', {
          channelId,
          error: parsed.error.message,
        });
        return null;
      }
      if (!parsed.data.enabled || parsed.data.scopeFieldGlobalIds.length === 0) {
        return null;
      }
      if (!preference.boardId) {
        logger.info('[TicketDuplicateService] Scoped channel has no board, treating as disabled', {
          channelId,
        });
        return null;
      }
      return { config: parsed.data, boardId: preference.boardId };
    } catch (error) {
      logger.warn('[TicketDuplicateService] Failed to load duplicateScopeConfig, falling back to project-wide detection', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Turn the channel config + the caller-supplied raw scope values into Vespa
   * `fieldId::value` tokens, one per configured global field. YqlBuilder's
   * dynamicFieldValues ANDs across distinct fieldIds, which is exactly the
   * "candidate must match every scope field" semantic this feature wants.
   *
   * Returns:
   *  - null      → no scoping applies (project-wide candidates). This is also the
   *                FALLBACK when the config is enabled but the new ticket lacks a
   *                configured value — a missing value must never silently drop
   *                detection.
   *  - string[]  → tokens to pass as ticket.dynamicFieldValues
   */
  private async buildScopeDynamicFieldValues(input: {
    channelId?: string;
    projectId: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
    excludeTicketId?: string;
  }): Promise<string[] | null> {
    const { channelId, projectId, scopeFieldValues, excludeTicketId } = input;
    const scope = await this.resolveDuplicateScopeConfig(channelId);
    if (!scope) {
      return null;
    }
    const { config: scopeConfig, boardId } = scope;

    // providedScopeFieldIds separates "the ticket carried no value for this key" from
    // "this key is not on the board's form at all" — same log line, different fixes.
    const logProjectWideFallback = (missingScopeFieldIds: string[]): void => {
      logger.info(
        '[TicketDuplicateService] Channel scope fields missing on new ticket, using project-wide duplicate search',
        {
          ticketId: excludeTicketId,
          channelId,
          projectId,
          boardId,
          missingScopeFieldIds,
          providedScopeFieldIds: (scopeFieldValues ?? []).map(entry => entry.fieldId),
        },
      );
    };

    if (!scopeFieldValues || scopeFieldValues.length === 0) {
      logProjectWideFallback(scopeConfig.scopeFieldGlobalIds);
      return null;
    }

    // Lazy resolution: the board-form query runs only here — config enabled +
    // fields configured (checked above) + raw values present.
    const resolvedFields = await buildDuplicateScopeFieldValues({
      boardId,
      fieldValues: scopeFieldValues,
    });
    const valuesByFieldId = new Map(
      resolvedFields.map(entry => [entry.fieldId, entry.values] as const),
    );

    const missing = scopeConfig.scopeFieldGlobalIds.filter(id => !valuesByFieldId.has(id));
    if (missing.length > 0) {
      logProjectWideFallback(missing);
      return null;
    }

    // One token per indexed value. YqlBuilder buckets by fieldId, so tokens sharing
    // a fieldId OR together while distinct fields AND — "matches every scope field,
    // on at least one of its values".
    return scopeConfig.scopeFieldGlobalIds.flatMap(fieldId =>
      valuesByFieldId.get(fieldId)!.map(value => `${fieldId}::${value}`),
    );
  }

  /**
   * Re-run duplicate detection after AI classification has written form fields.
   *
   * Detection normally runs once, at ticket creation. For an email-created ticket that
   * means no custom-field values exist yet, so a scoped channel falls back to a
   * project-wide search. Classification is the only path where a machine writes to the
   * ticket afterwards, so if it fills a configured scope key, a scoped pass can now find
   * what the creation-time run could not.
   *
   * APPEND-ONLY: the creation-time result stands. createMany(skipDuplicates) plus the
   * unique (source, target, relationType) constraint means re-running can add rows but
   * never duplicates one, and it never removes a link a human may have acted on.
   *
   * No-ops unless the channel is scoped AND one of the fields classification just wrote
   * is a configured scope key — otherwise the search would be identical to the one that
   * already ran, and the LLM call would be spent for nothing.
   */
  async rerunDuplicateDetectionForTicket(params: {
    ticketId: string;
    updatedFieldIds: string[];
  }): Promise<void> {
    const { ticketId, updatedFieldIds } = params;
    if (updatedFieldIds.length === 0) return;

    try {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: {
          id: true, title: true, description: true,
          projectId: true, channelId: true, createdBy: true,
        },
      });
      if (!ticket) return;

      const scope = await this.resolveDuplicateScopeConfig(ticket.channelId);
      if (!scope) return;
      const scopeConfig = scope.config;

      // updatedFieldIds come from resolveFormFieldDefinitionsForForm, which returns
      // `globalFieldId ?? id` — so for global-backed fields they compare directly
      // against the configured scope ids.
      const movedScopeFields = updatedFieldIds.filter(id =>
        scopeConfig.scopeFieldGlobalIds.includes(id),
      );
      if (movedScopeFields.length === 0) return;

      const savedValues = await prisma.formEntityValues.findMany({
        where: { entityId: ticketId, entityType: 'TICKET' },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        distinct: ['fieldId'],
        select: { fieldId: true, actualFieldValue: true },
      });

      logger.info('[TicketDuplicateService] Re-running duplicate detection after classification filled a scope field', {
        ticketId, channelId: ticket.channelId, movedScopeFields,
      });

      await this.persistDuplicateReferences({
        ticketId: ticket.id,
        ticketCreatedBy: ticket.createdBy,
        title: ticket.title,
        description: ticket.description,
        projectId: ticket.projectId,
        userId: ticket.createdBy,
        channelId: ticket.channelId,
        scopeFieldValues: savedValues.map(v => ({ fieldId: v.fieldId, value: v.actualFieldValue })),
      });
    } catch (error) {
      logger.error('[TicketDuplicateService] Duplicate detection re-run failed', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async checkDuplicates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
    parentTicketId?: string;
    channelId?: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
  }): Promise<{ candidates: TicketDuplicateCandidate[]; analysis: TicketDuplicateCheckAnalysis }> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId, channelId, scopeFieldValues } = params;

    const scopeDynamicFieldValues = await this.buildScopeDynamicFieldValues({
      channelId,
      projectId,
      scopeFieldValues,
      excludeTicketId,
    });

    const candidates = await this.getDuplicateCandidates({
      title,
      description,
      projectId,
      userId,
      limit,
      excludeTicketId,
      parentTicketId,
      dynamicFieldValues: scopeDynamicFieldValues ?? undefined,
    });

    if (candidates.length === 0) {
      return {
        candidates,
        analysis: {
          isDuplicate: false,
          duplicateTicketId: null,
          confidence: 0,
          reason: 'No similar tickets found.',
        },
      };
    }

    const analysis = await this.analyzeDuplicate(
      { title, description },
      candidates,
      { userId, projectId },
    );


    const reorderedCandidates = this.reorderCandidatesWithDuplicateFirst(
      candidates,
      analysis.duplicateTicketId,
    );

    return { candidates: reorderedCandidates, analysis };
  }

  private reorderCandidatesWithDuplicateFirst(
    candidates: TicketDuplicateCandidate[],
    duplicateTicketId: string | null | undefined,
  ): TicketDuplicateCandidate[] {
    // If no duplicate identified, return original order
    if (!duplicateTicketId) {
      return candidates;
    }

    const duplicateIndex = candidates.findIndex(c => c.id === duplicateTicketId);

    // If duplicate not found or already at index 0, return original order
    if (duplicateIndex <= 0) {
      return candidates;
    }

    // Move the duplicate to index 0, keep rest in original order
    const duplicate = candidates[duplicateIndex];
    const reordered = [
      duplicate,
      ...candidates.slice(0, duplicateIndex),
      ...candidates.slice(duplicateIndex + 1),
    ];

    return reordered;
  }

  async analyzeDuplicate(
    ticket: { title: string; description: string },
    candidates: TicketDuplicateCandidate[],
    context: TicketDuplicateContext,
  ): Promise<TicketDuplicateCheckAnalysis> {
    if (candidates.length === 0) {
      return {
        isDuplicate: false,
        confidence: 0,
        reason: 'No similar tickets found in this project.',
      };
    }

    try {
      const agentCandidates: TicketDuplicateCandidateInput[] = candidates.map(candidate => ({
        id: candidate.id,
        title: candidate.title,
        description: candidate.description || '',
        status: candidate.status,
      }));

      const result = await analyzeTicketDuplicates(
        {
          title: ticket.title,
          description: ticket.description,
          candidates: agentCandidates,
        },
        context,
      );

      const candidateIds = new Set(candidates.map(candidate => candidate.id));
      const safeDuplicateTicketId =
        result.duplicateTicketId && candidateIds.has(result.duplicateTicketId)
          ? result.duplicateTicketId
          : null;

      return {
        isDuplicate: result.isDuplicate,
        duplicateTicketId: safeDuplicateTicketId,
        confidence: result.confidence,
        reason: result.reason,
      };
    } catch (error) {
      logger.error('Duplicate ticket analysis failed', error);
      return {
        isDuplicate: false,
        confidence: 0,
        reason: 'Duplicate analysis unavailable. Please review the similar tickets manually.',
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  }

  private async getDuplicateCandidates(params: {
    title: string;
    description: string;
    projectId: string;
    userId: string;
    limit: number;
    excludeTicketId?: string;
    parentTicketId?: string;
    dynamicFieldValues?: string[];
  }): Promise<TicketDuplicateCandidate[]> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId, dynamicFieldValues } = params;
    const query = buildDuplicateSearchQuery(title, description);

    if (!query) {
      return [];
    }

    if (config.isTestEnv) {
      logger.debug('[TicketDuplicateService] Skipping Vespa in test environment');
      return [];
    }

    let vespaResults;
    try {
      vespaResults = await vespaService.searchService.searchVespa(
        query,
        userId,
        ['ticket'],
        {
          offset: 0,
          limit,
          rankProfile: RankProfile.duplicateDetection,
          ticket: {
            projectId: [projectId],
            ...(dynamicFieldValues && dynamicFieldValues.length > 0
              ? { dynamicFieldValues }
              : {}),
          },
        },
      );
    } catch (error) {
      logger.warn(
        '[TicketDuplicateService] Vespa search unavailable, skipping duplicate check',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return [];
    }

    const hits = vespaResults.root.children || [];
    const transformedResults = await transformVespaResults(hits, prisma);

    const candidates = transformedResults
      .filter(result => result.type === 'ticket')
      .map(result => ({
        id: result.id,
        title: result.title,
        description: result.context || '',
        boardId: result.searchContext?.boardId,
        status: result.searchContext?.ticketStatus || result.metadata.status,
        stage: result.subtitle,
        relevanceScore: result.relevanceScore,
        channelId: result.searchContext?.channelId,
        createdAt: result.metadata.timestamp,
      }));

    // Build set of IDs to exclude (self, parent)
    const excludeIds = new Set<string>();
    if (excludeTicketId) {
      excludeIds.add(excludeTicketId);
    }
    if (parentTicketId) {
      excludeIds.add(parentTicketId);
    }

    if (excludeIds.size === 0) {
      return candidates;
    }

    return candidates.filter(candidate => !excludeIds.has(candidate.id));
  }

  async persistDuplicateReferences(params: {
    ticketId: string;
    ticketCreatedBy: string;
    title: string;
    description: string;
    projectId: string;
    userId: string;
    parentTicketId?: string;
    channelId?: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
  }): Promise<void> {
    try {
      const { ticketId, ticketCreatedBy, title, description, projectId, userId, parentTicketId, channelId, scopeFieldValues } = params;
      const { candidates, analysis } = await this.checkDuplicates({
        title,
        description,
        projectId,
        userId,
        limit: DUPLICATE_REFERENCE_LIMIT,
        excludeTicketId: ticketId,
        parentTicketId,
        channelId,
        scopeFieldValues,
      });

      if (candidates.length === 0) {
        return;
      }

      if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
        return;
      }

      const duplicateCandidate = candidates.find(
        candidate => candidate.id === analysis.duplicateTicketId,
      );

      if (!duplicateCandidate) {
        return;
      }

      const workspaceId = await resolveWorkspaceIdFromModel(prisma, 'project', { id: projectId });

      const referenceRows = [
        {
          sourceTicketId: ticketId,
          targetTicketId: duplicateCandidate.id,
          workspaceId,
          relationType: TicketReferenceRelation.DUPLICATE_POSSIBLE,
          createdBy: ticketCreatedBy,
        },
      ];

      await prisma.ticketReferenceMapping.createMany({
        data: referenceRows,
        skipDuplicates: true,
      });
    } catch (error) {
      logger.error('Failed to persist duplicate ticket references', error);
    }
  }
}

export const ticketDuplicateService = new TicketDuplicateService();
