import { createHash } from 'crypto';
import { logger } from '@/utils/logger';
import { ActivityType, MAX_DUPLICATE_LOOKBACK_DAYS, MAX_DUPLICATE_SCOPE_FIELDS, TicketReferenceRelation } from '@xyne/shared';
import {
  resolveBoardTicketFormId,
  resolveFormFieldDefinitionsForForm,
} from '@/utils/fieldDefinition';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { TicketsACL } from '@/database/acl/tables/tickets-acl';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { transformVespaResults } from '@/services/vespaSearch/resultTransform';
import { redisService } from '@/services/redisService';
import { vespaService } from '@/services/vespaSearch';
import { RankProfile } from '@/vespa/src/types';
import { z } from 'zod';
import type { EmailChannelPreference, Prisma } from '@prisma/client';
import { buildFormFields } from '@/zero/vespa-injection/core/form-fields';
import type {
  TicketDuplicateCandidate,
  TicketDuplicateCheckAnalysis,
} from '@/types/ticket';
import {
  analyzeTicketDuplicates,
  isJevScoringEnabled,
  type TicketDuplicateCandidateInput,
  type TicketDuplicateContext,
} from '@/agents/ticket-duplicate';

const prisma = DatabaseClient.getInstance();
const emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();
const DUPLICATE_REFERENCE_LIMIT = 10;
// Cap on extra Vespa hits fetched to make up for excluded tickets, so a ticket with
// many links can't blow up the search size.
const MAX_EXCLUDED_OVERFETCH = 20;
const ACCESS_OVERFETCH = 10;

const DUPLICATE_RELATIONS = [
  TicketReferenceRelation.DUPLICATE_POSSIBLE,
  TicketReferenceRelation.DUPLICATE_CONFIRMED,
];

// Set on the analysis when Vespa could not be searched, so an on-demand check can tell
// "nothing similar" apart from "couldn't look".
const SEARCH_UNAVAILABLE_ERROR = 'SEARCH_UNAVAILABLE';

// Why a desk-channel check did not run. A skip is NOT an error and NOT "no duplicates":
// the analysis carries no error marker so callers don't retry or surface a failure.
const SKIP_REASON_NOT_CONFIGURED =
  'Duplicate detection is off for this desk — no scope fields configured in desk settings.';
const SKIP_REASON_MISSING_SCOPE_VALUES =
  'Duplicate detection skipped — this ticket has no value for a configured scope field.';

const skippedAnalysis = (reason: string): TicketDuplicateCheckAnalysis => ({
  isDuplicate: false,
  duplicateTicketId: null,
  confidence: 0,
  reason,
});

const DAY_MS = 24 * 60 * 60 * 1000;

// The recheck-on-open result is cached per ticket against a fingerprint of everything the
// run depends on. Candidates are only tickets created before the ticket, so an unchanged
// ticket and desk config give the same search; reopening it reuses the last outcome
// instead of paying for another search and Jev/LLM call. The TTL bounds how long a
// candidate indexed late can go unseen.
const recheckCacheKey = (ticketId: string): string => `ticket:duplicate-recheck-result:${ticketId}`;
const RECHECK_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Earliest createdAt a duplicate candidate may have: the desk's
 * duplicateScopeConfig.lookbackDays counted back from `asOf` (the ticket's
 * creation). Undefined/null/0 means no time bound: non-desk tickets pass
 * undefined (project-wide detection is never time-bounded), and a desk value
 * of 0/null = all time.
 */
const lookbackCutoff = (
  lookbackDays: number | null | undefined,
  asOf: number,
): number | undefined => {
  return lookbackDays && lookbackDays > 0 ? asOf - lookbackDays * DAY_MS : undefined;
};

/** What one detection run found, and the ticket it linked as a possible duplicate. */
export type DuplicateDetectionOutcome = {
  analysis: TicketDuplicateCheckAnalysis;
  candidateCount: number;
  linkedTicketId: string | null;
};

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
  lookbackDays: z.number().int().min(0).max(MAX_DUPLICATE_LOOKBACK_DAYS).nullable().optional(),
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
    // wrongly-built filter — every configured field then reads missing and the
    // caller skips detection.
    logger.warn('[TicketDuplicateService] Failed to build scope field values, skipping duplicate detection', {
      boardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

const QUERY_DESCRIPTION_MAX_LENGTH = 1500;

// Desk tickets carry raw HTML email bodies, so strip markup before it reaches the
// lexical term and the embedding.
const buildDuplicateSearchQuery = (title: string, description: string): string => {
  const plainTitle = extractPlainTextFromHtml(title).trim() || title.trim();
  const plainDescription = extractPlainTextFromHtml(description).trim();
  return `${plainTitle}\n\n${plainDescription.slice(0, QUERY_DESCRIPTION_MAX_LENGTH)}`.trim();
};

const DISMISSED_DUPLICATE_RELATIONS = new Set<string>(DUPLICATE_RELATIONS);

const counterpartOf = (ticketId: string, activityTicketId: string, value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const target = (value as { targetTicketId?: unknown }).targetTicketId;
  if (typeof target !== 'string') return null;
  return activityTicketId === ticketId ? target : activityTicketId;
};

const isDismissal = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const { action, relationType, oldRelationType } = value as Record<string, unknown>;
  if (action === 'removed') return DISMISSED_DUPLICATE_RELATIONS.has(String(relationType));
  return (
    action === 'updated' &&
    DISMISSED_DUPLICATE_RELATIONS.has(String(oldRelationType)) &&
    !DISMISSED_DUPLICATE_RELATIONS.has(String(relationType))
  );
};

class TicketDuplicateService {
  /**
   * The desk's preference row, or null. For a channel ticket a missing/failed read now
   * means duplicate detection is skipped entirely — never silently project-wide.
   */
  private async findChannelPreference(channelId: string | undefined): Promise<EmailChannelPreference | null> {
    if (!channelId) {
      return null;
    }
    try {
      return await emailChannelPreferenceRepo.findByChannelId(channelId);
    } catch (error) {
      logger.warn('[TicketDuplicateService] Failed to load channel preference, skipping duplicate detection', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The desk's enabled scope config, or null when detection must NOT run for its tickets:
   * no preference, no/malformed config, disabled, no fields selected, or no board. Desk
   * duplicate detection is opt-in — null means skip, not project-wide.
   */
  private resolveDuplicateScopeConfig(
    channelId: string | undefined,
    preference: EmailChannelPreference | null,
  ): { config: DuplicateScopeConfig; boardId: string } | null {
    if (!channelId || !preference?.duplicateScopeConfig) {
      return null;
    }

    try {
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
      logger.warn('[TicketDuplicateService] Failed to read duplicateScopeConfig, skipping duplicate detection', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Turn the resolved channel scope config + the caller-supplied raw scope values into
   * Vespa `fieldId::value` tokens, one per configured global field. YqlBuilder's
   * dynamicFieldValues ANDs across distinct fieldIds, which is exactly the
   * "candidate must match every scope field" semantic this feature wants.
   *
   * Returns:
   *  - null      → the ticket lacks a value for a configured scope field (or the board
   *                form could not be read). The caller SKIPS detection on null — a
   *                missing value now drops the check rather than widening it to
   *                project-wide.
   *  - string[]  → tokens to pass as ticket.dynamicFieldValues
   */
  private async buildScopeDynamicFieldValues(input: {
    scope: { config: DuplicateScopeConfig; boardId: string };
    channelId?: string;
    projectId: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
    excludeTicketId?: string;
  }): Promise<string[] | null> {
    const { scope, channelId, projectId, scopeFieldValues, excludeTicketId } = input;
    const { config: scopeConfig, boardId } = scope;

    // providedScopeFieldIds separates "the ticket carried no value for this key" from
    // "this key is not on the board's form at all" — same log line, different fixes.
    const logDetectionSkipped = (missingScopeFieldIds: string[]): void => {
      logger.info(
        '[TicketDuplicateService] Channel scope fields missing on new ticket, skipping duplicate detection',
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
      logDetectionSkipped(scopeConfig.scopeFieldGlobalIds);
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
      logDetectionSkipped(missing);
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
   * means no custom-field values exist yet, so on a scoped channel the creation-time run
   * is SKIPPED (a missing scope value never widens to project-wide). Classification is
   * the only path where a machine writes to the ticket afterwards, so if it fills a
   * configured scope key, the run below is the first one able to find anything.
   *
   * APPEND-ONLY: the creation-time result stands. A pre-insert existence check (either
   * direction, any duplicate relation type) plus the unique (source, target,
   * relationType) constraint means re-running can add a row but never duplicates one,
   * and it never removes a link a human may have acted on.
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
      const ticket = await this.findTicketForDetection(ticketId);
      if (!ticket) return;

      const preference = await this.findChannelPreference(ticket.channelId);
      const scope = this.resolveDuplicateScopeConfig(ticket.channelId, preference);
      if (!scope) return;
      const scopeConfig = scope.config;

      // updatedFieldIds come from resolveFormFieldDefinitionsForForm, which returns
      // `globalFieldId ?? id` — so for global-backed fields they compare directly
      // against the configured scope ids.
      const movedScopeFields = updatedFieldIds.filter(id =>
        scopeConfig.scopeFieldGlobalIds.includes(id),
      );
      if (movedScopeFields.length === 0) return;

      logger.info('[TicketDuplicateService] Re-running duplicate detection after classification filled a scope field', {
        ticketId, channelId: ticket.channelId, movedScopeFields,
      });

      await this.detectForSavedTicket(ticket);
    } catch (error) {
      logger.error('[TicketDuplicateService] Duplicate detection re-run failed', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Re-run duplicate detection for a saved ticket — the desk runs this whenever a ticket
   * is opened. Same append-only semantics as the creation-time run: it can link a new
   * possible duplicate but never removes one. Skipped, returning the last outcome, when
   * nothing it depends on changed since the last run. Null when the ticket is gone or
   * the run failed.
   */
  async recheckDuplicatesForTicket(ticketId: string): Promise<DuplicateDetectionOutcome | null> {
    const ticket = await this.findTicketForDetection(ticketId);
    if (!ticket) return null;
    return this.detectForSavedTicket(ticket, undefined, { reuseUnchanged: true });
  }

  private findTicketForDetection(ticketId: string) {
    return prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, title: true, description: true,
        projectId: true, channelId: true, createdBy: true, createdAt: true,
      },
    });
  }

  /**
   * Detection for a ticket that already exists, scoped by its saved form values.
   *
   * Searches as the ticket's creator and as of its creation, like the creation-time
   * run, so the result doesn't depend on who opened it or when: only tickets created
 * before it, within the desk's window counted back from its creation. Excludes the
 * ticket's parents (a sub-ticket is not a duplicate of the ticket it came from)
 * and dismissed candidates.
   */
  private async detectForSavedTicket(
    ticket: NonNullable<Awaited<ReturnType<TicketDuplicateService['findTicketForDetection']>>>,
    loadedPreference?: EmailChannelPreference | null,
    { reuseUnchanged = false }: { reuseUnchanged?: boolean } = {},
  ): Promise<DuplicateDetectionOutcome | null> {
    const preference = loadedPreference !== undefined
      ? loadedPreference
      : await this.findChannelPreference(ticket.channelId);

    // Unconfigured desk: skip the whole check — no form-value/exclusion reads, no
    // Vespa search, no LLM call. Non-desk tickets (no channel) fall through to the
    // legacy project-wide run below.
    const scope = ticket.channelId
      ? this.resolveDuplicateScopeConfig(ticket.channelId, preference)
      : null;
    if (ticket.channelId && !scope) {
      return {
        analysis: skippedAnalysis(SKIP_REASON_NOT_CONFIGURED),
        candidateCount: 0,
        linkedTicketId: null,
      };
    }

    const [savedValues, parentMappings, referenceActivities] = await Promise.all([
      prisma.formEntityValues.findMany({
        where: { entityId: ticket.id, entityType: 'TICKET' },
        orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        distinct: ['fieldId'],
        select: { fieldId: true, actualFieldValue: true },
      }),
      prisma.ticketSubTicketMapping.findMany({
        where: { subTicket: { mappedTicketId: ticket.id } },
        select: { ticketId: true },
      }),
      prisma.ticketActivity.findMany({
        where: { ticketId: ticket.id, activityType: ActivityType.REFERENCE_TICKET },
        orderBy: { timestamp: 'asc' },
        select: { ticketId: true, value: true },
      }),
    ]);

    const latestByCounterpart = new Map<string, unknown>();
    for (const activity of referenceActivities) {
      const counterpart = counterpartOf(ticket.id, activity.ticketId, activity.value);
      if (counterpart) latestByCounterpart.set(counterpart, activity.value);
    }
    const dismissedTicketIds = [...latestByCounterpart]
      .filter(([, value]) => isDismissal(value))
      .map(([counterpart]) => counterpart);

    const parentTicketIds = parentMappings.map(mapping => mapping.ticketId);
    // Search excludes parents and dismissed candidates only.
    const excludeTicketIds = [...parentTicketIds, ...dismissedTicketIds];
    const scopeFieldValues = savedValues.map(v => ({ fieldId: v.fieldId, value: v.actualFieldValue }));

    // Linked duplicates are deliberately OUT of the fingerprint: a new link must not
    // invalidate the cache, or every open would re-run and keep linking the next
    // candidate — a silently growing chain plus an LLM call per open. Parents and
    // dismissals stay in: a dismissal means "look again". lookbackDays is already
    // covered by the scopeConfig string.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({
        title: ticket.title,
        description: ticket.description,
        projectId: ticket.projectId,
        channelId: ticket.channelId,
        scopeConfig: preference?.duplicateScopeConfig ?? null,
        scopeFieldValues: [...scopeFieldValues].sort((a, b) => a.fieldId.localeCompare(b.fieldId)),
        excludeTicketIds: [...parentTicketIds, ...dismissedTicketIds].sort(),
      }))
      .digest('hex');

    if (reuseUnchanged) {
      const cached = await this.readRecheckCache(ticket.id);
      if (cached?.fingerprint === fingerprint) return cached.outcome;
    }

    const outcome = await this.persistDuplicateReferences({
      ticketId: ticket.id,
      ticketCreatedBy: ticket.createdBy,
      title: ticket.title,
      description: ticket.description,
      projectId: ticket.projectId,
      userId: ticket.createdBy,
      channelId: ticket.channelId,
      scopeFieldValues,
      excludeTicketIds,
      preference,
      asOfTimestamp: ticket.createdAt.getTime(),
    });

    // Only a completed run is reused; a failed search or analysis is retried next open.
    if (outcome && !outcome.analysis.error) {
      await this.writeRecheckCache(ticket.id, { fingerprint, outcome });
    }
    return outcome;
  }

  private async readRecheckCache(
    ticketId: string,
  ): Promise<{ fingerprint: string; outcome: DuplicateDetectionOutcome } | null> {
    try {
      const raw = await redisService.get(recheckCacheKey(ticketId));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      logger.warn('[TicketDuplicateService] Recheck cache unavailable, running the check', {
        ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async writeRecheckCache(
    ticketId: string,
    entry: { fingerprint: string; outcome: DuplicateDetectionOutcome },
  ): Promise<void> {
    try {
      await redisService.set(recheckCacheKey(ticketId), JSON.stringify(entry), RECHECK_CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn('[TicketDuplicateService] Failed to cache recheck result', {
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
    excludeTicketIds?: string[];
    channelId?: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
    jevOnly?: boolean;
    preference?: EmailChannelPreference | null;
    // Detect as of this epoch-ms instant (a saved ticket's creation): only tickets created
    // before it, within the desk's window ending at it. Omitted means now.
    asOfTimestamp?: number;
  }): Promise<{ candidates: TicketDuplicateCandidate[]; analysis: TicketDuplicateCheckAnalysis }> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId, excludeTicketIds, channelId, scopeFieldValues, jevOnly, asOfTimestamp } = params;

    if (jevOnly && !(await isJevScoringEnabled())) {
      return {
        candidates: [],
        analysis: {
          isDuplicate: false,
          duplicateTicketId: null,
          confidence: 0,
          reason: 'Duplicate scoring is not available.',
          matches: [],
        },
      };
    }

    const preference = params.preference !== undefined
      ? params.preference
      : await this.findChannelPreference(channelId);

    // Desk duplicate detection is opt-in: a channel ticket is checked only when the desk
    // enabled scope fields AND the ticket carries a value for each of them. Anything
    // short of that SKIPS the check — the old project-wide fallback is gone. A ticket
    // with no channel at all (non-desk) keeps the legacy project-wide check.
    let scopeDynamicFieldValues: string[] | undefined;
    let deskLookbackDays: number | null | undefined;
    if (channelId) {
      const scope = this.resolveDuplicateScopeConfig(channelId, preference);
      if (!scope) {
        return { candidates: [], analysis: skippedAnalysis(SKIP_REASON_NOT_CONFIGURED) };
      }
      deskLookbackDays = scope.config.lookbackDays ?? undefined;
      const scopeTokens = await this.buildScopeDynamicFieldValues({
        scope,
        channelId,
        projectId,
        scopeFieldValues,
        excludeTicketId,
      });
      if (!scopeTokens) {
        return { candidates: [], analysis: skippedAnalysis(SKIP_REASON_MISSING_SCOPE_VALUES) };
      }
      scopeDynamicFieldValues = scopeTokens;
    }

    const { candidates, searchFailed } = await this.getDuplicateCandidates({
      title,
      description,
      projectId,
      userId,
      limit,
      excludeTicketId,
      parentTicketId,
      excludeTicketIds,
      dynamicFieldValues: scopeDynamicFieldValues,
      createdAfterTimestamp: lookbackCutoff(deskLookbackDays, asOfTimestamp ?? Date.now()),
      createdBeforeTimestamp: asOfTimestamp,
    });

    if (searchFailed) {
      return {
        candidates,
        analysis: {
          isDuplicate: false,
          duplicateTicketId: null,
          confidence: 0,
          reason: 'Duplicate search unavailable. Please try again.',
          error: SEARCH_UNAVAILABLE_ERROR,
        },
      };
    }

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
      { userId, projectId, ...(excludeTicketId ? { ticketId: excludeTicketId } : {}) },
      { jevOnly: jevOnly === true },
    );

    const reorderedCandidates = this.reorderCandidatesByMatches(candidates, analysis);

    return { candidates: reorderedCandidates, analysis };
  }

  private reorderCandidatesByMatches(
    candidates: TicketDuplicateCandidate[],
    analysis: TicketDuplicateCheckAnalysis,
  ): TicketDuplicateCandidate[] {
    const order = [
      ...(analysis.duplicateTicketId ? [analysis.duplicateTicketId] : []),
      ...(analysis.matches ?? []).map(match => match.id),
    ];
    const rank = new Map<string, number>();
    order.forEach(id => {
      if (!rank.has(id)) rank.set(id, rank.size);
    });
    return [...candidates].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private async visibleTicketIds(userId: string, ticketIds: string[]): Promise<Set<string>> {
    if (ticketIds.length === 0) return new Set();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true, role: true },
    });
    if (!user?.workspaceId) return new Set();
    const accessible = await new TicketsACL(
      { userId, workspaceId: user.workspaceId, ...(user.role ? { role: user.role } : {}) },
      prisma,
    ).getWhereClause();
    const rows = await prisma.ticket.findMany({
      where: { AND: [accessible, { id: { in: ticketIds } }, { isArchived: false }] },
      select: { id: true },
    });
    return new Set(rows.map(row => row.id));
  }

  async analyzeDuplicate(
    ticket: { title: string; description: string },
    candidates: TicketDuplicateCandidate[],
    context: TicketDuplicateContext,
    options: { jevOnly?: boolean } = {},
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
        undefined,
        undefined,
        options,
      );

      const candidateIds = new Set(candidates.map(candidate => candidate.id));
      const safeDuplicateTicketId =
        result.duplicateTicketId && candidateIds.has(result.duplicateTicketId)
          ? result.duplicateTicketId
          : null;

      return {
        isDuplicate: result.isDuplicate && safeDuplicateTicketId !== null,
        duplicateTicketId: safeDuplicateTicketId,
        confidence: result.confidence,
        reason: result.reason,
        matches: (result.matches ?? []).filter(match => candidateIds.has(match.id)),
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
    excludeTicketIds?: string[];
    dynamicFieldValues?: string[];
    createdAfterTimestamp?: number;
    createdBeforeTimestamp?: number;
  }): Promise<{ candidates: TicketDuplicateCandidate[]; searchFailed: boolean }> {
    const { title, description, projectId, userId, limit, excludeTicketId, parentTicketId, excludeTicketIds, dynamicFieldValues, createdAfterTimestamp, createdBeforeTimestamp } = params;
    const query = buildDuplicateSearchQuery(title, description);

    if (!query) {
      return { candidates: [], searchFailed: false };
    }

    if (config.isTestEnv) {
      logger.debug('[TicketDuplicateService] Skipping Vespa in test environment');
      return { candidates: [], searchFailed: false };
    }

    // Build set of IDs to exclude (self, parent, already-linked)
    const excludeIds = new Set<string>(excludeTicketIds);
    if (excludeTicketId) {
      excludeIds.add(excludeTicketId);
    }
    if (parentTicketId) {
      excludeIds.add(parentTicketId);
    }

    let vespaResults;
    try {
      vespaResults = await vespaService.searchService.searchVespa(
        query,
        userId,
        ['ticket'],
        {
          offset: 0,
          // Over-fetch by what gets filtered out below, so exclusions don't shrink the
          // candidate list the model sees.
          limit: limit + Math.min(excludeIds.size, MAX_EXCLUDED_OVERFETCH) + ACCESS_OVERFETCH,
          rankProfile: RankProfile.duplicateDetection,
          privateQuery: true,
          literalQuery: true,
          ticket: {
            projectId: [projectId],
            ...(dynamicFieldValues && dynamicFieldValues.length > 0
              ? { dynamicFieldValues }
              : {}),
            ...(createdAfterTimestamp !== undefined ? { createdAfterTimestamp } : {}),
            ...(createdBeforeTimestamp !== undefined ? { createdBeforeTimestamp } : {}),
          },
        },
      );
    } catch (error) {
      logger.warn(
        '[TicketDuplicateService] Vespa search unavailable, skipping duplicate check',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return { candidates: [], searchFailed: true };
    }

    const hits = vespaResults.root.children || [];
    const transformedResults = await transformVespaResults(hits, prisma);

    const candidates = transformedResults
      .filter(result => result.type === 'ticket' && !excludeIds.has(result.id))
      .map(result => ({
        id: result.id,
        ...(result.searchContext?.xyneId ? { xyneId: result.searchContext.xyneId.replace(/<\/?hi>/gi, '') } : {}),
        title: result.title,
        description: result.context || '',
        boardId: result.searchContext?.boardId,
        status: result.searchContext?.ticketStatus || result.metadata.status,
        stage: result.subtitle,
        relevanceScore: result.relevanceScore,
        channelId: result.searchContext?.channelId,
        createdAt: result.metadata.timestamp,
      }));

    const visible = await this.visibleTicketIds(userId, candidates.map(candidate => candidate.id));

    return {
      candidates: candidates.filter(candidate => visible.has(candidate.id)).slice(0, limit),
      searchFailed: false,
    };
  }

  async persistDuplicateReferences(params: {
    ticketId: string;
    ticketCreatedBy: string;
    title: string;
    description: string;
    projectId: string;
    userId: string;
    parentTicketId?: string;
    excludeTicketIds?: string[];
    channelId?: string;
    scopeFieldValues?: DuplicateScopeFieldValue[];
    preference?: EmailChannelPreference | null;
    asOfTimestamp?: number;
  }): Promise<DuplicateDetectionOutcome | null> {
    try {
      const { ticketId, ticketCreatedBy, title, description, projectId, userId, parentTicketId, excludeTicketIds, channelId, scopeFieldValues, preference, asOfTimestamp } = params;
      const { candidates, analysis } = await this.checkDuplicates({
        title,
        description,
        projectId,
        userId,
        limit: DUPLICATE_REFERENCE_LIMIT,
        excludeTicketId: ticketId,
        parentTicketId,
        excludeTicketIds,
        channelId,
        scopeFieldValues,
        preference,
        asOfTimestamp,
      });

      const noLink: DuplicateDetectionOutcome = {
        analysis,
        candidateCount: candidates.length,
        linkedTicketId: null,
      };

      if (candidates.length === 0) {
        return noLink;
      }

      if (!analysis.isDuplicate || !analysis.duplicateTicketId) {
        return noLink;
      }

      const duplicateCandidate = candidates.find(
        candidate => candidate.id === analysis.duplicateTicketId,
      );

      if (!duplicateCandidate) {
        return noLink;
      }

      // An existing duplicate link to this counterpart — either direction, possible or
      // confirmed — is the same duplicate. The unique key includes relationType, so
      // relying on skipDuplicates alone would stack a POSSIBLE row next to a CONFIRMED
      // one; check before inserting instead.
      const existingDuplicateLink = await prisma.ticketReferenceMapping.findFirst({
        where: {
          relationType: { in: DUPLICATE_RELATIONS },
          OR: [
            { sourceTicketId: ticketId, targetTicketId: duplicateCandidate.id },
            { sourceTicketId: duplicateCandidate.id, targetTicketId: ticketId },
          ],
        },
        select: { id: true },
      });

      let createdNow = false;
      if (!existingDuplicateLink) {
        const workspaceId = await resolveWorkspaceIdFromModel(prisma, 'project', { id: projectId });

        const { count } = await prisma.ticketReferenceMapping.createMany({
          data: [
            {
              sourceTicketId: ticketId,
              targetTicketId: duplicateCandidate.id,
              workspaceId,
              relationType: TicketReferenceRelation.DUPLICATE_POSSIBLE,
              createdBy: ticketCreatedBy,
            },
          ],
          skipDuplicates: true,
        });
        createdNow = count > 0;
      }

      logger.info('[TicketDuplicateService] Linked possible duplicate', {
        ticketId,
        targetTicketId: duplicateCandidate.id,
        confidence: analysis.confidence,
        created: createdNow,
      });

      // A re-finding of an existing link still means the ticket IS a duplicate of
      // this candidate — report it regardless of whether the row was created now.
      return { ...noLink, linkedTicketId: duplicateCandidate.id };
    } catch (error) {
      logger.error('Failed to persist duplicate ticket references', error);
      return null;
    }
  }
}

export const ticketDuplicateService = new TicketDuplicateService();
