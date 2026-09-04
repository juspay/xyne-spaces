import { SDLC_AGENT_SLUG } from '@xyne/shared';
import { z } from 'zod';

const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
const commitRefSchema = z.union([gitShaSchema, z.literal('ROOT_BOOTSTRAP')]);
const historyRangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LAST_PERCENT'), percent: z.union([z.literal(20), z.literal(50)]) }),
  z.object({ kind: z.literal('FULL') }),
  z.object({ kind: z.literal('CUSTOM_SHA'), sha: gitShaSchema }),
]);
const revisionEvidenceSchema = z.object({
  action: z.enum(['created', 'updated', 'archived', 'restored', 'refined', 'moved']),
  commitSha: commitRefSchema,
  canvasId: z.string().min(1),
  canvasVersionId: z.string().min(1),
  contentHash: z.string().min(1).max(128),
  sourcePaths: z.array(z.string().min(1)),
  path: z.string().min(1).optional(),
  title: z.string().min(1).max(500).optional(),
  archived: z.boolean().optional(),
  sourceReferences: z
    .array(
      z.object({
        path: z.string().min(1),
        commitSha: commitRefSchema,
        symbol: z.string().min(1).optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      })
    )
    .optional(),
});
const pendingPageRevisionSchema = z.object({
  path: z.string().min(1),
  requestHash: z.string().min(1).max(128),
  // Identifies the agent run that produced this pending evidence. Optional for
  // executions serialized before bootstrap page writes became session-scoped.
  writerSessionId: z.string().min(1).optional(),
  revision: revisionEvidenceSchema,
});
const validatorReportSchema = z.object({
  complete: z.boolean(),
  missingTopics: z.array(z.string()),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
});
const bootstrapPlanSchema = z.object({
  repositorySummary: z.string().min(1).max(4_000),
  nextPageIndex: z.number().int().nonnegative().default(0),
  pendingEditorialPath: z.string().min(1).max(512).nullable().default(null),
  correction: z
    .object({
      path: z.string().min(1).max(512),
      report: validatorReportSchema,
    })
    .nullable()
    .default(null),
  editorialReports: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        report: validatorReportSchema,
      })
    )
    .max(100)
    .default([]),
  pages: z
    .array(
      z.object({
        path: z.string().min(1).max(512),
        purpose: z.string().min(1).max(1_000),
        concepts: z.array(z.string().min(1).max(255)).max(20),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        archetype: z.enum([
          'overview',
          'subsystem',
          'flow',
          'data-model',
          'interface',
          'operations',
          'decision',
        ]),
        sourceAreas: z.array(z.string().min(1).max(1_024)).max(20),
        relatedPages: z.array(z.string().min(1).max(512)).max(20),
        tableCandidates: z.array(z.string().min(1).max(512)).max(10),
        diagramCandidates: z.array(z.string().min(1).max(512)).max(10),
      })
    )
    .min(1)
    .max(50),
});

export const wikiExecutionContextSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    executionModel: z.literal('HISTORY_WINDOW').optional(),
    repoId: z.string().min(1),
    /**
         * The hub the run started from. Re-resolving later would pick the oldest
         * and write pages into the wrong hub. Optional only for older runs.
         */
    channelId: z.string().min(1).nullish(),
    agentSlug: z.literal(SDLC_AGENT_SLUG).nullable(),
    conversationId: z.string().nullable(),
    sessionId: z.string().nullable(),
    credentialSessionId: z.string().nullable(),
    admissionPermitId: z.string().nullable(),
    clawRunStartedAt: z.string().datetime().nullable().optional(),
    clawRunDeadlineAt: z.string().datetime().nullable().optional(),
    phase: z.enum([
      'QUEUED',
      'PREPARING',
      'BOOTSTRAPPING',
      'PROCESSING',
      'VALIDATING',
      'CORRECTING',
      'COMPLETED',
      'PARTIALLY_FAILED',
      'CANCELLED',
    ]),
    runMode: z.enum(['INITIAL', 'REFRESH']),
    historyRange: historyRangeSchema.nullable(),
    chunkSize: z.union([z.literal(1), z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
    quality: z.enum(['QUICK', 'STANDARD']),
    baseBranch: z.string().min(1),
    targetHeadSha: gitShaSchema.nullable(),
    bootstrapRef: commitRefSchema.nullable(),
    selectedStartSha: gitShaSchema.nullable(),
    selectedCommitShas: z.array(gitShaSchema),
    cursorSha: gitShaSchema.nullable(),
    assignedChunk: z
      .object({
        kind: z.enum([
          'BOOTSTRAP_SURVEY',
          'BOOTSTRAP_PAGE',
          'BOOTSTRAP_EDITOR',
          'BOOTSTRAP',
          'COMMITS',
          'VALIDATION',
          'CORRECTION',
        ]),
        conversationId: z.string().min(1),
        sessionId: z.string().min(1),
        commitShas: z.array(commitRefSchema).min(1),
        nextIndex: z.number().int().nonnegative(),
        window: z
          .object({
            beforeSha: commitRefSchema,
            afterSha: gitShaSchema,
            activeCheckpointSha: gitShaSchema.nullable(),
            completedCheckpointShas: z.array(gitShaSchema),
          })
          .optional(),
      })
      .nullable(),
    counts: z.object({
      total: z.number().int().nonnegative(),
      processed: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      noop: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      aggregated: z.number().int().nonnegative().optional(),
      windows: z
        .object({
          total: z.number().int().nonnegative(),
          completed: z.number().int().nonnegative(),
          updated: z.number().int().nonnegative(),
          noop: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          intermediate: z.number().int().nonnegative(),
        })
        .optional(),
    }),
    pendingCommit: z
      .object({
        commitSha: commitRefSchema,
        pages: z.array(pendingPageRevisionSchema),
      })
      .nullable()
      .optional(),
    validatorReports: z.array(validatorReportSchema),
    bootstrapPlan: bootstrapPlanSchema.nullable().optional(),
    bootstrapStage: z.enum(['SURVEY', 'PAGE', 'EDITOR', 'FINALIZE']).nullable().optional(),
    recovery: z
      .object({
        attempts: z.number().int().nonnegative(),
        noProgressAttempts: z.number().int().nonnegative(),
        lastCause: z.string().max(2_000),
        lastCauseAt: z.string().datetime(),
      })
      .optional(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (context.version === 2 && context.executionModel !== 'HISTORY_WINDOW') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionModel'],
        message: 'Version 2 Wiki runs require the history-window execution model',
      });
    }
    if (
      context.version === 2 &&
      context.assignedChunk?.kind === 'COMMITS' &&
      !context.assignedChunk.window
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignedChunk', 'window'],
        message: 'Version 2 commit assignments require immutable window endpoints',
      });
    }
    if (context.runMode === 'INITIAL' && !context.historyRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['historyRange'],
        message: 'Initial Wiki runs require a history range',
      });
    }
    if (
      !['QUEUED', 'PREPARING', 'PARTIALLY_FAILED', 'CANCELLED'].includes(context.phase) &&
      (!context.targetHeadSha ||
        !context.bootstrapRef ||
        !context.selectedStartSha ||
        context.selectedCommitShas.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Prepared Wiki runs require immutable Git range endpoints',
      });
    }
    if (context.counts.total !== context.selectedCommitShas.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts', 'total'],
        message: 'Total must equal the immutable selected commit count',
      });
    }
    if (
      context.counts.processed !==
      context.counts.updated + context.counts.noop + (context.counts.aggregated ?? 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts', 'processed'],
        message: 'Processed must equal updated, no-op, plus aggregated commits',
      });
    }
    if (
      context.runMode === 'INITIAL' &&
      context.cursorSha &&
      !context.selectedCommitShas.includes(context.cursorSha)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cursorSha'],
        message: 'Cursor must belong to the immutable selected range',
      });
    }
    if (
      context.assignedChunk &&
      context.assignedChunk.nextIndex >= context.assignedChunk.commitShas.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignedChunk', 'nextIndex'],
        message: 'Assigned chunk nextIndex must point to pending work',
      });
    }
    if (context.pendingCommit) {
      const paths = context.pendingCommit.pages.map((page) => page.path);
      if (new Set(paths).size !== paths.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pendingCommit', 'pages'],
          message: 'Pending Wiki page paths must be unique',
        });
      }
      const expectedCommit =
        context.version === 2 && context.assignedChunk?.kind === 'COMMITS'
          ? context.assignedChunk.window?.activeCheckpointSha
          : context.assignedChunk
            ? context.assignedChunk.commitShas[context.assignedChunk.nextIndex]
            : null;
      if (expectedCommit && context.pendingCommit.commitSha !== expectedCommit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pendingCommit', 'commitSha'],
          message: 'Pending Wiki pages must belong to the currently assigned commit',
        });
      }
    }
  });

export const wikiExecutionOutputSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    outcomes: z.array(
      z.object({
        commitSha: commitRefSchema,
        status: z.enum(['updated', 'noop']),
        revisions: z.array(revisionEvidenceSchema),
        completedAt: z.string().datetime(),
        checkpointKind: z.enum(['intermediate', 'endpoint']).optional(),
        coveredCommitShas: z.array(gitShaSchema).optional(),
        windowBeforeSha: commitRefSchema.optional(),
        windowAfterSha: gitShaSchema.optional(),
      })
    ),
  })
  .strict();

export type WikiExecutionContext = z.infer<typeof wikiExecutionContextSchema>;
export type WikiExecutionOutput = z.infer<typeof wikiExecutionOutputSchema>;
export type WikiRevisionEvidence = z.infer<typeof revisionEvidenceSchema>;
export type WikiPendingPageRevision = z.infer<typeof pendingPageRevisionSchema>;

export class WikiCheckpointError extends Error {
  constructor(
    readonly code:
      | 'RUN_CANCELLED'
      | 'COMMIT_NOT_ASSIGNED'
      | 'COMMIT_OUT_OF_ORDER'
      | 'SESSION_MISMATCH'
      | 'CHECKPOINT_NOT_BEGUN'
      | 'CHECKPOINT_IN_PROGRESS'
      | 'PARTIAL_APPLY',
    message: string
  ) {
    super(message);
    this.name = 'WikiCheckpointError';
  }
}

export function parseWikiExecutionContext(value: string): WikiExecutionContext {
  return wikiExecutionContextSchema.parse(JSON.parse(value));
}

export function parseWikiExecutionOutput(value: string | null): WikiExecutionOutput {
  if (!value) return { version: 1, outcomes: [] };
  return wikiExecutionOutputSchema.parse(JSON.parse(value));
}

export function serializeWikiRunState(value: WikiExecutionContext | WikiExecutionOutput): string {
  return JSON.stringify(value);
}

export function recoverWikiFailureContext(
  latestSerializedContext: string | null | undefined,
  dispatchedContext: WikiExecutionContext
): WikiExecutionContext {
  return latestSerializedContext
    ? parseWikiExecutionContext(latestSerializedContext)
    : dispatchedContext;
}

/** A completed commit checkpoint outranks a lost/failed transport callback. */
export function wikiAssignmentDurablyCompleted(
  dispatched: WikiExecutionContext,
  latest: WikiExecutionContext
): boolean {
  return Boolean(
    dispatched.assignedChunk &&
    latest.sessionId === dispatched.sessionId &&
    latest.phase !== 'PARTIALLY_FAILED' &&
    latest.phase !== 'CANCELLED' &&
    latest.assignedChunk === null
  );
}

export function requiresWikiBootstrap(input: {
  runMode: WikiExecutionContext['runMode'];
  bootstrapRef: WikiExecutionContext['bootstrapRef'];
  completedCommitRefs: readonly string[];
}): boolean {
  return (
    input.runMode === 'INITIAL' &&
    input.bootstrapRef !== null &&
    input.bootstrapRef !== 'ROOT_BOOTSTRAP' &&
    !input.completedCommitRefs.includes(input.bootstrapRef)
  );
}

export function beginWikiCheckpoint(input: {
  context: WikiExecutionContext;
  sessionId: string;
  commitSha: string;
}): WikiExecutionContext {
  const { context } = input;
  if (context.phase === 'CANCELLED') {
    throw new WikiCheckpointError('RUN_CANCELLED', 'Cancelled Wiki run cannot advance');
  }
  const chunk = context.assignedChunk;
  if (!chunk || context.version !== 2 || chunk.kind !== 'COMMITS' || !chunk.window) {
    throw new WikiCheckpointError('COMMIT_NOT_ASSIGNED', 'Wiki run has no assigned history window');
  }
  if (chunk.sessionId !== input.sessionId) {
    throw new WikiCheckpointError('SESSION_MISMATCH', 'Wiki session does not own this window');
  }
  if (chunk.window.activeCheckpointSha === input.commitSha) return context;
  if (chunk.window.activeCheckpointSha || context.pendingCommit) {
    throw new WikiCheckpointError(
      'CHECKPOINT_IN_PROGRESS',
      'Finalize the active Wiki checkpoint before beginning another'
    );
  }
  const checkpointIndex = chunk.commitShas.indexOf(input.commitSha);
  if (checkpointIndex === -1) {
    throw new WikiCheckpointError(
      'COMMIT_NOT_ASSIGNED',
      `Checkpoint ${input.commitSha} is outside the assigned history window`
    );
  }
  if (checkpointIndex < chunk.nextIndex) {
    throw new WikiCheckpointError(
      'COMMIT_OUT_OF_ORDER',
      `Checkpoint ${input.commitSha} is behind the durable window cursor`
    );
  }

  return wikiExecutionContextSchema.parse({
    ...context,
    assignedChunk: {
      ...chunk,
      window: { ...chunk.window, activeCheckpointSha: input.commitSha },
    },
  });
}

export function assertWikiCommitAssignment(input: {
  context: WikiExecutionContext;
  output: WikiExecutionOutput;
  sessionId: string;
  commitSha: string;
}): void {
  const { context, output } = input;
  if (context.phase === 'CANCELLED') {
    throw new WikiCheckpointError('RUN_CANCELLED', 'Cancelled Wiki run cannot advance');
  }
  const chunk = context.assignedChunk;
  if (!chunk) {
    throw new WikiCheckpointError('COMMIT_NOT_ASSIGNED', 'Wiki run has no assigned commit');
  }
  if (chunk.sessionId !== input.sessionId) {
    throw new WikiCheckpointError('SESSION_MISMATCH', 'Wiki session does not own this chunk');
  }
  if (
    context.assignedChunk?.kind !== 'CORRECTION' &&
    output.outcomes.some((outcome) => outcome.commitSha === input.commitSha)
  ) {
    throw new WikiCheckpointError('COMMIT_OUT_OF_ORDER', 'Commit already has a durable checkpoint');
  }
  const expectedCommit =
    context.version === 2 && chunk.kind === 'COMMITS'
      ? chunk.window?.activeCheckpointSha
      : chunk.commitShas[chunk.nextIndex];
  if (context.version === 2 && chunk.kind === 'COMMITS' && !expectedCommit) {
    throw new WikiCheckpointError(
      'CHECKPOINT_NOT_BEGUN',
      'Begin a server-authorized Wiki checkpoint before writing or finalizing'
    );
  }
  if (expectedCommit !== input.commitSha) {
    throw new WikiCheckpointError(
      'COMMIT_OUT_OF_ORDER',
      `Expected commit ${expectedCommit}, received ${input.commitSha}`
    );
  }
}

export function checkpointWikiCommit(input: {
  context: WikiExecutionContext;
  output: WikiExecutionOutput;
  sessionId: string;
  commitSha: string;
  status: 'updated' | 'noop';
  revisions: WikiRevisionEvidence[];
  completedAt: string;
}): { context: WikiExecutionContext; output: WikiExecutionOutput } {
  const { context, output } = input;
  assertWikiCommitAssignment(input);
  const chunk = context.assignedChunk!;
  if (
    (input.status === 'noop' && input.revisions.length !== 0) ||
    (input.status === 'updated' && input.revisions.length === 0) ||
    input.revisions.some((revision) => revision.commitSha !== input.commitSha)
  ) {
    throw new WikiCheckpointError(
      'PARTIAL_APPLY',
      'Checkpoint outcome does not match its complete revision evidence'
    );
  }

  const doesNotAdvanceCommitCursor =
    chunk.kind === 'BOOTSTRAP' ||
    chunk.kind === 'BOOTSTRAP_SURVEY' ||
    chunk.kind === 'BOOTSTRAP_PAGE' ||
    chunk.kind === 'BOOTSTRAP_EDITOR' ||
    chunk.kind === 'CORRECTION';
  const window = context.version === 2 && chunk.kind === 'COMMITS' ? chunk.window : undefined;
  const checkpointIndex = window ? chunk.commitShas.indexOf(input.commitSha) : chunk.nextIndex;
  const nextIndex = checkpointIndex + 1;
  const endpoint = window?.afterSha === input.commitSha;
  const coveredCommitShas = window
    ? chunk.commitShas.slice(chunk.nextIndex, nextIndex).filter((sha) => sha !== 'ROOT_BOOTSTRAP')
    : undefined;
  const nextAssignedChunk =
    nextIndex === chunk.commitShas.length
      ? null
      : {
          ...chunk,
          nextIndex,
          ...(window
            ? {
                window: {
                  ...window,
                  activeCheckpointSha: null,
                  completedCheckpointShas: [...window.completedCheckpointShas, input.commitSha],
                },
              }
            : {}),
        };
  const nextOutcome = {
    commitSha: input.commitSha,
    status: input.status,
    revisions: input.revisions,
    completedAt: input.completedAt,
    ...(window
      ? {
          checkpointKind: endpoint ? ('endpoint' as const) : ('intermediate' as const),
          coveredCommitShas,
          windowBeforeSha: window.beforeSha,
          windowAfterSha: window.afterSha,
        }
      : {}),
  } as const;

  const processedIncrement = window ? (coveredCommitShas?.length ?? 0) : 1;
  const checkpointIncrement = window ? 1 : processedIncrement;
  const aggregatedIncrement = window ? Math.max(0, processedIncrement - 1) : 0;
  const nextWindowCounts = context.counts.windows
    ? {
        ...context.counts.windows,
        completed: context.counts.windows.completed + (endpoint ? 1 : 0),
        updated: context.counts.windows.updated + (endpoint && input.status === 'updated' ? 1 : 0),
        noop: context.counts.windows.noop + (endpoint && input.status === 'noop' ? 1 : 0),
        intermediate: context.counts.windows.intermediate + (window && !endpoint ? 1 : 0),
      }
    : undefined;

  return {
    context: wikiExecutionContextSchema.parse({
      ...context,
      pendingCommit: null,
      cursorSha: doesNotAdvanceCommitCursor ? context.cursorSha : input.commitSha,
      assignedChunk: nextAssignedChunk,
      counts: doesNotAdvanceCommitCursor
        ? context.counts
        : {
            ...context.counts,
            processed: context.counts.processed + processedIncrement,
            updated:
              context.counts.updated + (input.status === 'updated' ? checkpointIncrement : 0),
            noop: context.counts.noop + (input.status === 'noop' ? checkpointIncrement : 0),
            ...(window
              ? { aggregated: (context.counts.aggregated ?? 0) + aggregatedIncrement }
              : {}),
            ...(nextWindowCounts ? { windows: nextWindowCounts } : {}),
          },
      error: null,
      errorCode: null,
    }),
    output: wikiExecutionOutputSchema.parse({
      ...output,
      outcomes: [...output.outcomes, nextOutcome],
    }),
  };
}
