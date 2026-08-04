import { ChannelRepository } from './channelRepository';

/**
 * Regression test for XYNE-55082.
 *
 * Bug: `ChannelRepository.findByName` resolved a channel by name globally,
 * ignoring the workspace. Because channel names are only unique *within* a
 * workspace (see `checkDuplicateName`, scoped by `project.workspaceId`), two
 * workspaces can both own a `#general`. The unscoped lookup returned whichever
 * row the DB happened to hit first — e.g. `ensureUserInGeneralChannel` could add
 * a brand-new user to another workspace's `#general`, breaking tenant isolation.
 *
 * Fix: `findByName(name, workspaceId)` filters on the denormalized
 * `Channel.workspaceId` column. This test seeds two workspaces that share the
 * channel name `general` and asserts the lookup is workspace-scoped.
 */
describe('ChannelRepository.findByName — workspace scoping (XYNE-55082)', () => {
  const WS_A = 'ws_alpha';
  const WS_B = 'ws_beta';

  // Two workspaces, each with its own #general (plus an unrelated channel).
  const rows = [
    { id: 'chan_a_general', name: 'general', workspaceId: WS_A },
    { id: 'chan_a_random', name: 'random', workspaceId: WS_A },
    { id: 'chan_b_general', name: 'general', workspaceId: WS_B },
  ];

  // Faithful-enough emulation of the Prisma `findFirst` predicate the
  // repository builds: AND of `workspaceId` (equality) and
  // `name` (case-insensitive equality). Crucially, if `workspaceId` is
  // undefined (the pre-fix behaviour), it is NOT applied — so the old code
  // would match on name alone and return the first row, failing this test.
  const makeRepo = () => {
    const repo = new ChannelRepository();
    (repo as unknown as { db: unknown }).db = {
      channel: {
        findFirst: async ({ where }: { where: any }) => {
          const wantName: string | undefined = where?.name?.equals;
          const insensitive = where?.name?.mode === 'insensitive';
          const wantWs: string | undefined = where?.workspaceId;
          const match = rows.find((r) => {
            const nameOk =
              wantName === undefined
                ? true
                : insensitive
                  ? r.name.toLowerCase() === wantName.toLowerCase()
                  : r.name === wantName;
            const wsOk = wantWs === undefined ? true : r.workspaceId === wantWs;
            return nameOk && wsOk;
          });
          return match ?? null;
        },
      },
    };
    return repo;
  };

  it('resolves #general within workspace A to workspace A\'s channel', async () => {
    const channel = await makeRepo().findByName('general', WS_A);
    expect(channel?.id).toBe('chan_a_general');
    expect(channel?.workspaceId).toBe(WS_A);
  });

  it('resolves #general within workspace B to workspace B\'s channel', async () => {
    const channel = await makeRepo().findByName('general', WS_B);
    expect(channel?.id).toBe('chan_b_general');
    expect(channel?.workspaceId).toBe(WS_B);
  });

  it('never returns another workspace\'s channel with the same name', async () => {
    const a = await makeRepo().findByName('general', WS_A);
    const b = await makeRepo().findByName('general', WS_B);
    expect(a?.id).not.toBe(b?.id);
  });

  it('returns null when the name exists only in a different workspace', async () => {
    // `random` exists only in workspace A; a lookup scoped to B must miss.
    const channel = await makeRepo().findByName('random', WS_B);
    expect(channel).toBeNull();
  });

  it('matches channel names case-insensitively but still within the workspace', async () => {
    const channel = await makeRepo().findByName('GENERAL', WS_A);
    expect(channel?.id).toBe('chan_a_general');
  });
});
