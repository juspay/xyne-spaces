import {
  beginWikiCheckpoint,
  checkpointWikiCommit,
  parseWikiExecutionContext,
  parseWikiExecutionOutput,
  recoverWikiFailureContext,
  requiresWikiBootstrap,
  serializeWikiRunState,
  wikiAssignmentDurablyCompleted,
  type WikiExecutionContext,
  WikiCheckpointError,
} from '../../../src/sdlc/wiki/wikiRunState';

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);
const SHA_3 = '3'.repeat(40);

function context(overrides: Partial<WikiExecutionContext> = {}): WikiExecutionContext {
  return {
    version: 1,
    repoId: 'repo-1',
    agentSlug: 'sdlc-agent',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    credentialSessionId: 'session-1',
    admissionPermitId: 'permit-1',
    phase: 'PROCESSING',
    runMode: 'INITIAL',
    historyRange: { kind: 'FULL' },
    chunkSize: 10,
    quality: 'STANDARD',
    baseBranch: 'main',
    targetHeadSha: SHA_2,
    bootstrapRef: 'ROOT_BOOTSTRAP',
    selectedStartSha: SHA_1,
    selectedCommitShas: [SHA_1, SHA_2],
    cursorSha: null,
    assignedChunk: {
      kind: 'COMMITS',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      commitShas: [SHA_1, SHA_2],
      nextIndex: 0,
    },
    counts: { total: 2, processed: 0, updated: 0, noop: 0, failed: 0 },
    validatorReports: [],
    error: null,
    errorCode: null,
    ...overrides,
  };
}

function windowContext(overrides: Partial<WikiExecutionContext> = {}): WikiExecutionContext {
  return context({
    version: 2,
    executionModel: 'HISTORY_WINDOW',
    targetHeadSha: SHA_3,
    selectedCommitShas: [SHA_1, SHA_2, SHA_3],
    assignedChunk: {
      kind: 'COMMITS',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      commitShas: [SHA_1, SHA_2, SHA_3],
      nextIndex: 0,
      window: {
        beforeSha: 'ROOT_BOOTSTRAP',
        afterSha: SHA_3,
        activeCheckpointSha: null,
        completedCheckpointShas: [],
      },
    },
    counts: {
      total: 3,
      processed: 0,
      updated: 0,
      noop: 0,
      failed: 0,
      windows: { total: 1, completed: 0, updated: 0, noop: 0, failed: 0, intermediate: 0 },
    },
    ...overrides,
  });
}

describe('Wiki durable run state', () => {
  it('parses versioned context and defaults an empty output', () => {
    expect(parseWikiExecutionContext(JSON.stringify(context())).version).toBe(1);
    expect(parseWikiExecutionOutput(null)).toEqual({ version: 1, outcomes: [] });
  });

  it('advances only the expected assigned commit and records evidence', () => {
    const first = checkpointWikiCommit({
      context: context(),
      output: { version: 1, outcomes: [] },
      sessionId: 'session-1',
      commitSha: SHA_1,
      status: 'updated',
      revisions: [
        {
          action: 'created',
          commitSha: SHA_1,
          canvasId: 'canvas-1',
          canvasVersionId: 'version-1',
          contentHash: 'hash-1',
          sourcePaths: ['src/main.ts'],
        },
      ],
      completedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(first.context.cursorSha).toBe(SHA_1);
    expect(first.context.counts).toMatchObject({ processed: 1, updated: 1, noop: 0 });
    expect(first.context.assignedChunk?.nextIndex).toBe(1);
    expect(first.output.outcomes).toHaveLength(1);
  });

  it('advances a history window through an optional intermediate checkpoint and mandatory endpoint', () => {
    expect(() =>
      checkpointWikiCommit({
        context: windowContext(),
        output: { version: 2, outcomes: [] },
        sessionId: 'session-1',
        commitSha: SHA_2,
        status: 'noop',
        revisions: [],
        completedAt: '2026-08-11T00:00:00.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'CHECKPOINT_NOT_BEGUN' }));

    const begunIntermediate = beginWikiCheckpoint({
      context: windowContext(),
      sessionId: 'session-1',
      commitSha: SHA_2,
    });
    const intermediate = checkpointWikiCommit({
      context: begunIntermediate,
      output: { version: 2, outcomes: [] },
      sessionId: 'session-1',
      commitSha: SHA_2,
      status: 'noop',
      revisions: [],
      completedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(intermediate.context.cursorSha).toBe(SHA_2);
    expect(intermediate.context.counts.processed).toBe(2);
    expect(intermediate.context.counts.windows).toMatchObject({
      completed: 0,
      intermediate: 1,
    });
    expect(intermediate.context.assignedChunk).toMatchObject({
      nextIndex: 2,
      window: { activeCheckpointSha: null, completedCheckpointShas: [SHA_2] },
    });
    expect(intermediate.output.outcomes[0]).toMatchObject({
      commitSha: SHA_2,
      checkpointKind: 'intermediate',
      coveredCommitShas: [SHA_1, SHA_2],
      windowBeforeSha: 'ROOT_BOOTSTRAP',
      windowAfterSha: SHA_3,
    });

    const begunEndpoint = beginWikiCheckpoint({
      context: intermediate.context,
      sessionId: 'session-1',
      commitSha: SHA_3,
    });
    const endpoint = checkpointWikiCommit({
      context: begunEndpoint,
      output: intermediate.output,
      sessionId: 'session-1',
      commitSha: SHA_3,
      status: 'updated',
      revisions: [
        {
          action: 'updated',
          commitSha: SHA_3,
          canvasId: 'canvas-1',
          canvasVersionId: 'version-2',
          contentHash: 'hash-2',
          sourcePaths: ['src/main.ts'],
        },
      ],
      completedAt: '2026-08-11T01:00:00.000Z',
    });

    expect(endpoint.context.cursorSha).toBe(SHA_3);
    expect(endpoint.context.assignedChunk).toBeNull();
    expect(endpoint.context.counts).toMatchObject({
      processed: 3,
      updated: 1,
      noop: 1,
      aggregated: 1,
    });
    expect(endpoint.context.counts.windows).toEqual({
      total: 1,
      completed: 1,
      updated: 1,
      noop: 0,
      failed: 0,
      intermediate: 1,
    });
    expect(endpoint.output.outcomes.at(-1)).toMatchObject({
      commitSha: SHA_3,
      checkpointKind: 'endpoint',
      coveredCommitShas: [SHA_3],
    });
  });

  it('rejects backward, foreign, and parallel history-window checkpoint starts', () => {
    expect(() =>
      beginWikiCheckpoint({
        context: windowContext(),
        sessionId: 'foreign',
        commitSha: SHA_2,
      })
    ).toThrow(expect.objectContaining({ code: 'SESSION_MISMATCH' }));

    const begun = beginWikiCheckpoint({
      context: windowContext(),
      sessionId: 'session-1',
      commitSha: SHA_2,
    });
    expect(() =>
      beginWikiCheckpoint({ context: begun, sessionId: 'session-1', commitSha: SHA_3 })
    ).toThrow(expect.objectContaining({ code: 'CHECKPOINT_IN_PROGRESS' }));
    expect(() =>
      beginWikiCheckpoint({
        context: {
          ...windowContext(),
          assignedChunk: {
            ...windowContext().assignedChunk!,
            nextIndex: 2,
          },
        },
        sessionId: 'session-1',
        commitSha: SHA_1,
      })
    ).toThrow(expect.objectContaining({ code: 'COMMIT_OUT_OF_ORDER' }));
  });

  it('rejects foreign sessions, out-of-order commits, and duplicates', () => {
    const base = {
      context: context(),
      output: { version: 1 as const, outcomes: [] },
      commitSha: SHA_1,
      status: 'noop' as const,
      revisions: [],
      completedAt: '2026-08-11T00:00:00.000Z',
    };
    expect(() => checkpointWikiCommit({ ...base, sessionId: 'foreign' })).toThrow(
      expect.objectContaining({ code: 'SESSION_MISMATCH' })
    );
    expect(() =>
      checkpointWikiCommit({ ...base, sessionId: 'session-1', commitSha: SHA_2 })
    ).toThrow(expect.objectContaining({ code: 'COMMIT_OUT_OF_ORDER' }));
    expect(() =>
      checkpointWikiCommit({
        ...base,
        sessionId: 'session-1',
        output: {
          version: 1,
          outcomes: [
            {
              commitSha: SHA_1,
              status: 'noop',
              revisions: [],
              completedAt: '2026-08-11T00:00:00.000Z',
            },
          ],
        },
      })
    ).toThrow(expect.objectContaining({ code: 'COMMIT_OUT_OF_ORDER' }));
  });

  it('rejects cancelled and incomplete outcomes', () => {
    const attempt = (overrides: Record<string, unknown>) =>
      checkpointWikiCommit({
        context: context(),
        output: { version: 1, outcomes: [] },
        sessionId: 'session-1',
        commitSha: SHA_1,
        status: 'noop',
        revisions: [],
        completedAt: '2026-08-11T00:00:00.000Z',
        ...overrides,
      });

    expect(() => attempt({ context: context({ phase: 'CANCELLED' }) })).toThrow(
      expect.objectContaining({ code: 'RUN_CANCELLED' })
    );
    expect(() => attempt({ status: 'updated', revisions: [] })).toThrow(
      expect.objectContaining({ code: 'PARTIAL_APPLY' })
    );
  });

  it('does not count or advance the cursor for bootstrap', () => {
    const bootstrap = context({
      phase: 'BOOTSTRAPPING',
      assignedChunk: {
        kind: 'BOOTSTRAP',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: ['ROOT_BOOTSTRAP'],
        nextIndex: 0,
      },
    });
    const result = checkpointWikiCommit({
      context: bootstrap,
      output: { version: 1, outcomes: [] },
      sessionId: 'session-1',
      commitSha: 'ROOT_BOOTSTRAP',
      status: 'updated',
      revisions: [
        {
          action: 'created',
          commitSha: 'ROOT_BOOTSTRAP',
          canvasId: 'canvas-1',
          canvasVersionId: 'version-1',
          contentHash: 'hash-1',
          sourcePaths: ['src/main.ts'],
        },
      ],
      completedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(result.context.cursorSha).toBeNull();
    expect(result.context.counts.processed).toBe(0);
    expect(result.context.assignedChunk).toBeNull();
  });

  it('records target-head correction evidence without advancing commit counts', () => {
    const corrected = context({
      phase: 'CORRECTING',
      cursorSha: SHA_2,
      counts: { total: 2, processed: 2, updated: 1, noop: 1, failed: 0 },
      assignedChunk: {
        kind: 'CORRECTION',
        conversationId: 'correction-conversation',
        sessionId: 'correction-session',
        commitShas: [SHA_2],
        nextIndex: 0,
      },
    });
    const result = checkpointWikiCommit({
      context: corrected,
      output: {
        version: 1,
        outcomes: [
          {
            commitSha: SHA_2,
            status: 'noop',
            revisions: [],
            completedAt: '2026-08-11T00:00:00.000Z',
          },
        ],
      },
      sessionId: 'correction-session',
      commitSha: SHA_2,
      status: 'noop',
      revisions: [],
      completedAt: '2026-08-11T01:00:00.000Z',
    });

    expect(result.context.cursorSha).toBe(SHA_2);
    expect(result.context.counts.processed).toBe(2);
    expect(result.output.outcomes).toHaveLength(2);
  });

  it('surfaces parser corruption instead of silently resetting state', () => {
    expect(() => parseWikiExecutionContext('{"version":2}')).toThrow();
    expect(() => parseWikiExecutionOutput('{"version":1,"outcomes":[],"extra":true}')).toThrow();
    expect(new WikiCheckpointError('PARTIAL_APPLY', 'bad').name).toBe('WikiCheckpointError');
  });

  it('keeps the durable checkpoint prefix when an agent fails mid-chunk', () => {
    const dispatched = context();
    const checkpointed = checkpointWikiCommit({
      context: dispatched,
      output: { version: 1, outcomes: [] },
      sessionId: 'session-1',
      commitSha: SHA_1,
      status: 'noop',
      revisions: [],
      completedAt: '2026-08-11T00:00:00.000Z',
    }).context;

    const recovered = recoverWikiFailureContext(serializeWikiRunState(checkpointed), dispatched);
    expect(recovered.cursorSha).toBe(SHA_1);
    expect(recovered.counts).toMatchObject({ processed: 1, noop: 1 });
    expect(recovered.assignedChunk?.nextIndex).toBe(1);
    expect(recoverWikiFailureContext(null, dispatched)).toBe(dispatched);
  });

  it('treats a fully checkpointed assignment as stronger evidence than transport failure', () => {
    const dispatched = context({
      assignedChunk: {
        kind: 'COMMITS',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        commitShas: [SHA_1],
        nextIndex: 0,
      },
      selectedCommitShas: [SHA_1],
      counts: { total: 1, processed: 0, updated: 0, noop: 0, failed: 0 },
    });
    const checkpointed = checkpointWikiCommit({
      context: dispatched,
      output: { version: 1, outcomes: [] },
      sessionId: 'session-1',
      commitSha: SHA_1,
      status: 'noop',
      revisions: [],
      completedAt: '2026-08-11T00:00:00.000Z',
    }).context;

    expect(wikiAssignmentDurablyCompleted(dispatched, checkpointed)).toBe(true);
    expect(
      wikiAssignmentDurablyCompleted(dispatched, {
        ...checkpointed,
        phase: 'PARTIALLY_FAILED',
      })
    ).toBe(false);
    expect(
      wikiAssignmentDurablyCompleted(dispatched, {
        ...checkpointed,
        sessionId: 'foreign-session',
      })
    ).toBe(false);
  });

  it('skips synthetic bootstrap for a root start and requires it for a real parent', () => {
    expect(
      requiresWikiBootstrap({
        runMode: 'INITIAL',
        bootstrapRef: 'ROOT_BOOTSTRAP',
        completedCommitRefs: [],
      })
    ).toBe(false);
    expect(
      requiresWikiBootstrap({
        runMode: 'INITIAL',
        bootstrapRef: SHA_1,
        completedCommitRefs: [],
      })
    ).toBe(true);
    expect(
      requiresWikiBootstrap({
        runMode: 'INITIAL',
        bootstrapRef: SHA_1,
        completedCommitRefs: [SHA_1],
      })
    ).toBe(false);
  });
});
