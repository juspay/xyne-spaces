/**
 * Behavioural lock on the workspace stamper.
 *
 * `stampArgsForWorkspace` decides what happens to the tenant key on a write. The fifth
 * argument is the enforcement switch: refuse a payload naming another workspace, or correct
 * it. Both positions must keep the boundary — they differ only in whether the caller is told.
 *
 * Models are real (Prisma.dmmf, no connection): Message carries workspaceId and has stampable
 * relations; Workspace does not carry one.
 */

const warn = jest.fn();
jest.mock('@/utils/logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: jest.fn() } }));

// eslint-disable-next-line import/first
import { stampArgsForWorkspace } from './stamp';

const WS = 'ws-1';
const OTHER = 'ws-2';

const REFUSE = true;
const CORRECT = false;

beforeEach(() => warn.mockReset());

/** Tags emitted during a test. */
const tags = (): string[] => warn.mock.calls.map((c) => c[0] as string);
const foreignWarnings = () =>
  warn.mock.calls.filter((c) => c[0] === '[acl] create names a different workspace').map((c) => c[1]);

describe('create', () => {
  it('leaves a payload that already names the caller workspace untouched', () => {
    const args = { data: { id: 'm', workspaceId: WS } };
    const out = stampArgsForWorkspace('Message', 'create', args, WS, REFUSE);

    expect(out).toBe(args); // same reference: nothing needed changing
    expect(tags()).toHaveLength(0);
  });

  it('fills a missing workspaceId', () => {
    const out = stampArgsForWorkspace('Message', 'create', { data: { id: 'm' } }, WS, REFUSE);

    expect(out).toEqual({ data: { id: 'm', workspaceId: WS } });
    expect(tags()).toContain('[STAMP] filled a missing workspaceId — caller should pass it explicitly');
  });

  it('refuses a payload naming another workspace when the switch is on', () => {
    expect(() =>
      stampArgsForWorkspace('Message', 'create', { data: { id: 'm', workspaceId: OTHER } }, WS, REFUSE),
    ).toThrow(/Cannot write Message for a different workspace/);

    // Reported before refusing, so the log is complete in both positions.
    expect(foreignWarnings()[0]).toMatchObject({ given: OTHER, enforced: WS, refused: true });
  });

  it('corrects a payload naming another workspace when the switch is off', () => {
    const out = stampArgsForWorkspace('Message', 'create', { data: { id: 'm', workspaceId: OTHER } }, WS, CORRECT);

    // The boundary holds either way — off means "corrected and reported", not "allowed".
    expect(out).toEqual({ data: { id: 'm', workspaceId: WS } });
    expect(foreignWarnings()[0]).toMatchObject({ given: OTHER, enforced: WS, refused: false });
  });

  it('does not mutate the caller\'s object when correcting', () => {
    const data = { id: 'm', workspaceId: OTHER };
    stampArgsForWorkspace('Message', 'create', { data }, WS, CORRECT);

    expect(data.workspaceId).toBe(OTHER); // copy-on-write
  });

  it('checks every row of a createMany', () => {
    const out = stampArgsForWorkspace(
      'Message',
      'createMany',
      { data: [{ id: 'a' }, { id: 'b', workspaceId: OTHER }] },
      WS,
      CORRECT,
    );

    expect(out).toEqual({ data: [{ id: 'a', workspaceId: WS }, { id: 'b', workspaceId: WS }] });
  });
});

describe('the workspace relation, not just the scalar', () => {
  it('refuses a connect to another workspace when the switch is on', () => {
    expect(() =>
      stampArgsForWorkspace(
        'Message',
        'create',
        { data: { id: 'm', workspace: { connect: { id: OTHER } } } },
        WS,
        REFUSE,
      ),
    ).toThrow(/Cannot connect Message to a different workspace/);
  });

  it('corrects a foreign connect when the switch is off', () => {
    const out = stampArgsForWorkspace(
      'Message',
      'create',
      { data: { id: 'm', workspace: { connect: { id: OTHER } } } },
      WS,
      CORRECT,
    );

    expect(out).toEqual({ data: { id: 'm', workspace: { connect: { id: WS } } } });
  });

  it('leaves a connect to the caller workspace alone', () => {
    const args = { data: { id: 'm', workspace: { connect: { id: WS } } } };
    const out = stampArgsForWorkspace('Message', 'create', args, WS, REFUSE);

    expect(out).toBe(args);
  });
});

describe('update', () => {
  it('does not stamp the existing row', () => {
    const args = { where: { id: 'm' }, data: { content: 'hi' } };
    const out = stampArgsForWorkspace('Message', 'update', args, WS, REFUSE);

    // A live row never acquires a tenant key it did not have.
    expect(out).toBe(args);
  });

  it('still refuses an update that moves the row to another workspace', () => {
    expect(() =>
      stampArgsForWorkspace('Message', 'update', { where: { id: 'm' }, data: { workspaceId: OTHER } }, WS, REFUSE),
    ).toThrow(/Cannot write Message for a different workspace/);
  });

  it('stamps a nested create inside an update', () => {
    const out = stampArgsForWorkspace(
      'Message',
      'update',
      { where: { id: 'm' }, data: { reactions: { create: [{ id: 'r' }] } } },
      WS,
      REFUSE,
    ) as { data: { reactions: { create: Array<{ workspaceId?: string }> } } };

    expect(out.data.reactions.create[0].workspaceId).toBe(WS);
  });
});

describe('upsert', () => {
  it('stamps the create half and leaves the update half alone', () => {
    const out = stampArgsForWorkspace(
      'Message',
      'upsert',
      { where: { id: 'm' }, create: { id: 'm' }, update: { content: 'hi' } },
      WS,
      REFUSE,
    );

    expect(out).toEqual({
      where: { id: 'm' },
      create: { id: 'm', workspaceId: WS },
      update: { content: 'hi' },
    });
  });

  it('refuses a foreign workspace in the create half', () => {
    expect(() =>
      stampArgsForWorkspace(
        'Message',
        'upsert',
        { where: { id: 'm' }, create: { id: 'm', workspaceId: OTHER }, update: {} },
        WS,
        REFUSE,
      ),
    ).toThrow(/Cannot write Message for a different workspace/);
  });
});

describe('what it leaves alone', () => {
  it('ignores reads', () => {
    const args = { where: { id: 'm' } };
    expect(stampArgsForWorkspace('Message', 'findMany', args, WS, REFUSE)).toBe(args);
  });

  it('ignores delete, which carries no payload to stamp', () => {
    const args = { where: { id: 'm' } };
    expect(stampArgsForWorkspace('Message', 'delete', args, WS, REFUSE)).toBe(args);
  });

  it('ignores a model with no workspaceId column', () => {
    const args = { data: { name: 'w' } };
    expect(stampArgsForWorkspace('Workspace', 'create', args, WS, REFUSE)).toBe(args);
  });
});
