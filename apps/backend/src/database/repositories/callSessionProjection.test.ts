/**
 * Regression guard for the "49-minute call shown as 18 seconds" bug.
 *
 * Root cause: a rejoin (a status-transition event) overwrote Call.startedAt, so
 * duration = endedAt - startedAt collapsed to the LAST session. The fix makes an
 * append-only CallSession the source of truth and re-projects Call.startedAt/endedAt
 * as MIN(startedAt)..MAX(endedAt) over sessions on every session close, in one place
 * (CallRepository.closeOpenCallSession). These tests drive that private method with a
 * fake transaction client and assert the projection is the full envelope regardless of
 * how sessions interleave.
 */

// --- Mock the heavy module graph pulled in by callRepository.ts. None of these are
// --- exercised by closeOpenCallSession; they only need to exist at import time.
jest.mock('../client', () => ({ DatabaseClient: { getInstance: jest.fn() } }));
jest.mock('@/database/tenant/workspace-utils', () => ({ resolveWorkspaceIdFromModel: jest.fn() }));
jest.mock('@/zero/utils/systemMessagesUtils', () => ({ updateCallSystemMessageIfNeeded: jest.fn() }));
jest.mock('./index', () => ({ repositories: {} }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock('@/services/messageMetadataService', () => ({ messageMetadataService: {} }));
jest.mock('@/utils/email', () => ({ normalizeEmailList: jest.fn() }));
jest.mock('@/services/callVespaQueue', () => ({
  CallVespaFeedSource: {},
  queueCallVespaDelete: jest.fn(),
  queueCallVespaFeed: jest.fn(),
}));
jest.mock('@/utils/callParticipantCountUtils', () => ({ refreshCallParticipantPreview: jest.fn() }));
jest.mock('./messageArtifactRepository', () => ({ setSlashCommandArtifactLifecycle: jest.fn() }));
jest.mock('@xyne/shared', () => ({
  CallOrigin: {}, CallStatus: { ACTIVE: 'ACTIVE', ENDED: 'ENDED', SCHEDULED: 'SCHEDULED' },
  CallType: {}, InvitationResponse: {}, MeetingStatus: {}, MessageType: {},
  MessageArtifactStatus: { COMPLETED: 'COMPLETED' }, TagMethod: {},
}));

import { CallRepository } from './callRepository';

type Session = { id: string; startedAt: Date; endedAt: Date | null };

/**
 * Minimal fake of the Prisma TransactionClient surface that closeOpenCallSession uses:
 * callSession.findFirst / update / aggregate and call.update. Backed by an in-memory
 * session array so the aggregate reflects the update the method just made.
 */
function makeTx(sessions: Session[]) {
  const callUpdates: Array<{ startedAt?: Date; endedAt?: Date }> = [];
  const tx = {
    callSession: {
      findFirst: jest.fn(async () => {
        const open = sessions
          .filter((s) => s.endedAt === null)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return open[0] ? { id: open[0].id } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = sessions.find((x) => x.id === where.id);
        if (s) s.endedAt = data.endedAt;
        return s;
      }),
      aggregate: jest.fn(async () => {
        const starts = sessions.map((s) => s.startedAt.getTime());
        const ends = sessions.filter((s) => s.endedAt).map((s) => s.endedAt!.getTime());
        return {
          _min: { startedAt: starts.length ? new Date(Math.min(...starts)) : null },
          _max: { endedAt: ends.length ? new Date(Math.max(...ends)) : null },
        };
      }),
    },
    call: {
      update: jest.fn(async ({ data }: any) => {
        callUpdates.push(data);
        return data;
      }),
    },
  };
  return { tx, callUpdates };
}

const repo = new CallRepository();
const close = (tx: any, callId: string, endedAt: Date) =>
  (repo as any).closeOpenCallSession(tx, callId, endedAt);

describe('CallRepository.closeOpenCallSession (call-duration projection)', () => {
  it('projects the FULL first-join..last-leave envelope across a rejoin (the 18s regression)', async () => {
    // Session 1: 18:00:00 -> 18:20:00 (closed). Session 2 (rejoin): 18:40:00 -> still open.
    const s1Start = new Date('2026-01-01T18:00:00Z');
    const s1End = new Date('2026-01-01T18:20:00Z');
    const s2Start = new Date('2026-01-01T18:40:00Z');
    const s2End = new Date('2026-01-01T18:49:00Z'); // final leave, 49 min after first join
    const sessions: Session[] = [
      { id: 's1', startedAt: s1Start, endedAt: s1End },
      { id: 's2', startedAt: s2Start, endedAt: null },
    ];
    const { tx, callUpdates } = makeTx(sessions);

    const envelope = await close(tx, 'call-1', s2End);

    // The still-open session got closed at the final leave.
    expect(sessions.find((s) => s.id === 's2')!.endedAt).toEqual(s2End);
    // Projection is MIN(start)=first join, MAX(end)=last leave — NOT the last session only.
    expect(envelope.startedAt).toEqual(s1Start);
    expect(envelope.endedAt).toEqual(s2End);
    expect(callUpdates).toHaveLength(1);
    expect(callUpdates[0].startedAt).toEqual(s1Start);
    expect(callUpdates[0].endedAt).toEqual(s2End);
    const durationMin = (envelope.endedAt!.getTime() - envelope.startedAt!.getTime()) / 60000;
    expect(durationMin).toBe(49); // not 9 (last session), not 18s
  });

  it('is idempotent when there is no open session (re-project only)', async () => {
    const start = new Date('2026-01-01T10:00:00Z');
    const end = new Date('2026-01-01T10:30:00Z');
    const sessions: Session[] = [{ id: 's1', startedAt: start, endedAt: end }];
    const { tx, callUpdates } = makeTx(sessions);

    const envelope = await close(tx, 'call-2', end);

    expect(tx.callSession.update).not.toHaveBeenCalled(); // nothing open to close
    expect(envelope.startedAt).toEqual(start);
    expect(envelope.endedAt).toEqual(end);
    expect(callUpdates[0].startedAt).toEqual(start);
  });
});
