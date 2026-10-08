import { BoardType, TicketStatusV2 } from '@xyne/shared';
import {
  resolveReleaseCompletionStage,
  type CompletionStage,
  type CompletionTransition,
} from '../resolveReleaseCompletionStage';

const stage = (id: string, sequenceNumber: number, status: TicketStatusV2): CompletionStage => ({
  id,
  name: id,
  sequenceNumber,
  defaultTicketStatusV2: status,
});

// Todo(1) → Dev(2) → Merged(3) → Done(4,C) → QA(5) → Shipped(6,C); Rejected(7,X)
const linearStages = [
  stage('Todo', 1, TicketStatusV2.TODO),
  stage('Dev', 2, TicketStatusV2.STARTED),
  stage('Merged', 3, TicketStatusV2.STARTED),
  stage('Done', 4, TicketStatusV2.COMPLETED),
  stage('QA', 5, TicketStatusV2.STARTED),
  stage('Shipped', 6, TicketStatusV2.COMPLETED),
  stage('Rejected', 7, TicketStatusV2.CANCELLED),
];

const run = (overrides: Partial<Parameters<typeof resolveReleaseCompletionStage>[0]>) =>
  resolveReleaseCompletionStage({
    boardType: BoardType.DEFAULT,
    stages: linearStages,
    transitions: [],
    standardPathStageIds: [],
    currentStageName: 'Merged',
    ...overrides,
  });

const targetName = (r: ReturnType<typeof resolveReleaseCompletionStage>) =>
  r.kind === 'TARGET' ? `${r.stage.name}:${r.source}` : r.kind;

describe('resolveReleaseCompletionStage', () => {
  it('skips tickets already in a Completed stage', () => {
    expect(run({ currentStageName: 'Done' }).kind).toBe('ALREADY_COMPLETED');
  });

  it('returns NO_TARGET when the board has no Completed stage', () => {
    const r = run({ stages: linearStages.filter(s => s.defaultTicketStatusV2 !== TicketStatusV2.COMPLETED) });
    expect(r.kind).toBe('NO_TARGET');
  });

  describe('configured stage', () => {
    it('uses the configured Completed stage', () => {
      expect(targetName(run({ configuredStageName: 'Shipped' }))).toBe('Shipped:CONFIGURED');
    });

    it('ignores a configured stage that is not in the Completed group', () => {
      expect(targetName(run({ configuredStageName: 'QA' }))).toBe('Done:LINEAR');
    });

    it('ignores a configured stage that no longer exists', () => {
      expect(targetName(run({ configuredStageName: 'Gone' }))).toBe('Done:LINEAR');
    });
  });

  describe('linear boards', () => {
    it('picks the first Completed stage after the current stage', () => {
      expect(targetName(run({ currentStageName: 'Merged' }))).toBe('Done:LINEAR');
      expect(targetName(run({ currentStageName: 'QA' }))).toBe('Shipped:LINEAR');
    });

    it('moves Todo tickets forward too', () => {
      expect(targetName(run({ currentStageName: 'Todo' }))).toBe('Done:LINEAR');
    });

    it('falls back to the lowest Completed stage when none is after the current one (Rejected at the end)', () => {
      expect(targetName(run({ currentStageName: 'Rejected' }))).toBe('Done:FALLBACK');
    });

    it('falls back when the current stage is unknown', () => {
      expect(targetName(run({ currentStageName: 'Deleted stage' }))).toBe('Done:FALLBACK');
    });
  });

  describe('non-linear boards', () => {
    const nl = [
      stage('Backlog', 1, TicketStatusV2.TODO),
      stage('Build', 2, TicketStatusV2.STARTED),
      stage('Merged', 3, TicketStatusV2.STARTED),
      stage('Verified', 4, TicketStatusV2.COMPLETED),
      stage('Closed', 5, TicketStatusV2.COMPLETED),
      stage('Rejected', 6, TicketStatusV2.CANCELLED),
    ];
    const t = (from: string | null, to: string): CompletionTransition => ({ fromStageId: from, toStageId: to });

    it('follows the Standard Path forward from the current position', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        standardPathStageIds: ['Backlog', 'Build', 'Merged', 'Closed'],
        currentStageName: 'Build',
      });
      expect(targetName(r)).toBe('Closed:STANDARD_PATH');
      expect(r.kind === 'TARGET' && r.enteredFromStageId).toBe('Merged');
    });

    it('uses the first Completed stage on the path when the ticket is off-path', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        standardPathStageIds: ['Backlog', 'Build', 'Merged', 'Closed'],
        currentStageName: 'Rejected',
      });
      expect(targetName(r)).toBe('Closed:STANDARD_PATH');
      expect(r.kind === 'TARGET' && r.enteredFromStageId).toBe('Rejected');
    });

    it('without a Standard Path, picks the nearest reachable Completed stage', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        transitions: [t('Merged', 'Build'), t('Build', 'Closed'), t('Merged', 'Rejected')],
        currentStageName: 'Merged',
      });
      // Merged → Build → Closed (Verified is not reachable via explicit edges)
      expect(targetName(r)).toBe('Closed:REACHABLE');
      expect(r.kind === 'TARGET' && r.enteredFromStageId).toBe('Build');
    });

    it('breaks reachability ties by lower sequenceNumber', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        transitions: [t('Merged', 'Closed'), t('Merged', 'Verified')],
        currentStageName: 'Merged',
      });
      expect(targetName(r)).toBe('Verified:REACHABLE');
    });

    it('honours global (from-any) transitions', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        transitions: [t('Merged', 'Rejected'), t(null, 'Closed')],
        currentStageName: 'Merged',
      });
      expect(targetName(r)).toBe('Closed:REACHABLE');
    });

    it('treats a stage with no outgoing transitions as unrestricted', () => {
      const r = run({ boardType: BoardType.NON_LINEAR, stages: nl, currentStageName: 'Merged' });
      expect(targetName(r)).toBe('Verified:REACHABLE');
    });

    it('falls back to the lowest Completed stage when nothing is reachable', () => {
      const r = run({
        boardType: BoardType.NON_LINEAR,
        stages: nl,
        transitions: [t('Merged', 'Build'), t('Build', 'Merged')],
        currentStageName: 'Merged',
      });
      expect(targetName(r)).toBe('Verified:FALLBACK');
    });
  });

  describe('flow boards', () => {
    it('does not use the blind fallback', () => {
      const r = run({
        boardType: BoardType.FLOW,
        transitions: [
          { fromStageId: 'Merged', toStageId: 'QA' },
          { fromStageId: 'QA', toStageId: 'Merged' },
        ],
      });
      expect(r.kind).toBe('NO_TARGET');
    });

    it('uses the configured stage', () => {
      expect(targetName(run({ boardType: BoardType.FLOW, configuredStageName: 'Shipped' }))).toBe('Shipped:CONFIGURED');
    });
  });
});
