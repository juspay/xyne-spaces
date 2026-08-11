/**
 * Regression test for the recording-share 409 bug.
 *
 * The detailed-summary streaming writer persists `detailedSummaryCanvasId` onto
 * Call.metadata mid-processing (so the UI can mount the canvas). `finalizeCallUpdates`
 * then runs at the end of processTranscript. It previously merged onto the STALE
 * in-memory `call.metadata` snapshot captured at the start of processing and
 * whole-column-overwrote Call.metadata — clobbering the streamed id whenever the
 * final generation result was null (`detailedSummaryCanvasId: undefined`). The
 * share endpoint then read an absent pointer and threw 409 "Detailed summary
 * canvas is not ready yet" — permanently.
 *
 * The fix: source the merge base from a FRESH DB read, not the stale snapshot.
 */

// --- Mock the module's heavy imports so only `repositories` + `logger` matter ---
const findByExternalId = jest.fn();
const update = jest.fn();

jest.mock('@/database/repositories', () => ({
  repositories: { calls: { findByExternalId, update } },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/queues/vespaQueue', () => ({ vespaQueue: { add: jest.fn() } }));
jest.mock('@/vespa/src/types', () => ({ fileSchema: 'file', SubApp: {} }));
jest.mock('@/utils/distributedLock', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));
jest.mock('@/services/transcriptService', () => ({ transcriptService: {} }));
jest.mock('@/services/callDocumentService', () => ({
  callDocumentService: {},
  numberTranscriptSegments: jest.fn(),
}));
jest.mock('@/services/canvasService', () => ({ findExistingDetailedSummaryCanvas: jest.fn() }));
jest.mock('@/bots/unified/services/unified-bot-user-service.js', () => ({
  unifiedBotUserService: {},
}));
jest.mock('@/tags/service', () => ({
  tagService: {},
  TagServiceError: class TagServiceError extends Error {},
}));
jest.mock('@/database/repositories/tagRepository', () => ({ tagRepository: {} }));
jest.mock('@xyne/shared', () => ({ TAG_FORMAT_REGEX: /.*/, TagMethod: {} }));

import { noteTakerTranscriptService } from './noteTakerTranscriptService';

type AnyCall = Record<string, unknown>;

const invokeFinalize = (call: AnyCall, updates: unknown): Promise<void> =>
  // finalizeCallUpdates is private; reach it directly for a focused unit test.
  (noteTakerTranscriptService as unknown as {
    finalizeCallUpdates: (c: AnyCall, u: unknown) => Promise<void>;
  }).finalizeCallUpdates(call, updates);

beforeEach(() => {
  findByExternalId.mockReset();
  update.mockReset();
  update.mockResolvedValue({});
});

describe('finalizeCallUpdates — metadata merge does not clobber the streamed summary canvas id', () => {
  it('preserves detailedSummaryCanvasId written mid-processing even when the final result is null', async () => {
    // In-memory snapshot captured at processTranscript entry — predates the streaming write.
    const staleCall: AnyCall = {
      id: 'call-db-id',
      externalId: 'ext-338cabed',
      metadata: { notesCanvasId: 'notes-1' }, // NO detailedSummaryCanvasId yet
    };

    // What the DB actually holds now: the streaming writer already persisted the id.
    findByExternalId.mockResolvedValue({
      id: 'call-db-id',
      externalId: 'ext-338cabed',
      metadata: { notesCanvasId: 'notes-1', detailedSummaryCanvasId: 'summary-canvas-1' },
    });

    // generateDetailedSummaryCanvas returned null after the early persist → undefined id here.
    await invokeFinalize(staleCall, {
      metadata: {
        transcriptEntryCount: 42,
        detailedSummaryCanvasId: undefined,
      },
    });

    expect(findByExternalId).toHaveBeenCalledWith('ext-338cabed');
    expect(update).toHaveBeenCalledTimes(1);

    const persistedMetadata = (update.mock.calls[0][1] as { metadata: Record<string, unknown> })
      .metadata;

    // The share endpoint reads exactly this key — it must survive.
    expect(persistedMetadata.detailedSummaryCanvasId).toBe('summary-canvas-1');
    expect(persistedMetadata.notesCanvasId).toBe('notes-1');
    expect(persistedMetadata.transcriptEntryCount).toBe(42);
  });

  it('still writes a freshly-produced id through when generation succeeds', async () => {
    const staleCall: AnyCall = {
      id: 'call-db-id',
      externalId: 'ext-1',
      metadata: { notesCanvasId: 'notes-1' },
    };
    findByExternalId.mockResolvedValue({
      id: 'call-db-id',
      externalId: 'ext-1',
      metadata: { notesCanvasId: 'notes-1' },
    });

    await invokeFinalize(staleCall, {
      metadata: { transcriptEntryCount: 10, detailedSummaryCanvasId: 'summary-canvas-2' },
    });

    const persistedMetadata = (update.mock.calls[0][1] as { metadata: Record<string, unknown> })
      .metadata;
    expect(persistedMetadata.detailedSummaryCanvasId).toBe('summary-canvas-2');
    expect(persistedMetadata.notesCanvasId).toBe('notes-1');
  });
});
