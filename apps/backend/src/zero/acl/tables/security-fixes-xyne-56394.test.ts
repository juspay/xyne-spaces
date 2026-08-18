/**
 * POT for XYNE-56394 security fixes.
 *
 * Each mutation ACL below previously gated only on workspace membership (or, for
 * ticket_stage_requests, only on delete), letting a workspace member who is NOT a
 * participant of a private channel — or an admin of another org — update/delete/insert
 * rows they should not touch. These tests drive each fixed `canUpdate/canDelete/
 * canInsert/canUpsert` with a mock transaction and assert the new channel/org gate
 * throws for the unauthorized actor and still passes for the authorized one.
 *
 * The mock transaction returns queued rows in call order (mirrors messages-acl.test.ts);
 * the zql query builder is a no-op chainable — the ACL branch logic is what's under test.
 */

jest.mock('@xyne/shared', () => ({
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  OrgRole: { ADMIN: 'ADMIN', OWNER: 'OWNER', MEMBER: 'MEMBER' },
  WorkspaceRole: { COMMUNITY_MEMBER: 'COMMUNITY_MEMBER', MEMBER: 'MEMBER' },
  schema: { tables: {} },
}));

jest.mock('../../queries', () => {
  const makeChain = () =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : (..._a: unknown[]) => makeChain()),
      apply: () => makeChain(),
    });
  return { zql: new Proxy({}, { get: () => makeChain() }) };
});

jest.mock('../core/guest-access', () => ({
  assertGuestWriteBlocked: jest.fn(),
}));

import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { ImpactsACL } from './impacts-acl';
import { RcasACL } from './rcas-acl';
import { CoesACL } from './coes-acl';
import { ReleaseAttributionsACL } from './release-attributions-acl';
import { ClassificationMappingsACL } from './classification-mappings-acl';
import { TicketStageRequestsACL } from './ticket-stage-requests-acl';
import { OrgMembersACL } from './org-members-acl';

const WS = 'workspace-1';
const ctx: QueryContext = {
  userID: 'user-1',
  workspaceId: WS,
  role: 'MEMBER',
  orgRole: 'ADMIN',
  memberId: 'member-1',
};

function txReturning(...rows: unknown[]): Transaction<Schema> {
  return {
    run: jest.fn().mockImplementation(() => Promise.resolve(rows.shift())),
  } as unknown as Transaction<Schema>;
}

describe('XYNE-56394 channel-gate family (M4–M9)', () => {
  it('ImpactsACL.canUpdate rejects a non-participant of the ticket channel', async () => {
    const acl = new ImpactsACL(ctx);
    const tx = txReturning(
      { id: 'i1', workspaceId: WS, ticketId: 't1' }, // stored impact row
      { id: 't1', workspaceId: WS }, // ticket exists in workspace
      null, // channel access check -> not PUBLIC and not a participant
    );
    await expect(acl.canUpdate({ id: 'i1' } as never, tx)).rejects.toThrow(
      /access to the ticket's channel/,
    );
  });

  it('ImpactsACL.canUpdate allows a participant', async () => {
    const acl = new ImpactsACL(ctx);
    const tx = txReturning(
      { id: 'i1', workspaceId: WS, ticketId: 't1' },
      { id: 't1', workspaceId: WS },
      { id: 't1' }, // channel access check -> accessible
    );
    await expect(acl.canUpdate({ id: 'i1' } as never, tx)).resolves.toBeUndefined();
  });

  it('RcasACL.canDelete rejects a non-participant', async () => {
    const acl = new RcasACL(ctx);
    const tx = txReturning(
      { id: 'r1', workspaceId: WS, ticketId: 't1' },
      { id: 't1', workspaceId: WS },
      null,
    );
    await expect(acl.canDelete({ id: 'r1' } as never, tx)).rejects.toThrow(
      /access to the ticket's channel/,
    );
  });

  it('CoesACL.canUpdate rejects a non-participant of the RCA ticket channel', async () => {
    const acl = new CoesACL(ctx);
    const tx = txReturning(
      { id: 'c1', workspaceId: WS, rcaId: 'r1' }, // stored coe row
      { id: 'r1', workspaceId: WS, ticketId: 't1' }, // rca row
      null, // ticket channel access -> denied
    );
    await expect(acl.canUpdate({ id: 'c1' } as never, tx)).rejects.toThrow(
      /RCA ticket's channel/,
    );
  });

  it('ReleaseAttributionsACL.canDelete rejects a non-participant', async () => {
    const acl = new ReleaseAttributionsACL(ctx);
    const tx = txReturning(
      { id: 'ra1', workspaceId: WS, ticketId: 't1' },
      { id: 't1', workspaceId: WS },
      null,
    );
    await expect(acl.canDelete({ id: 'ra1' } as never, tx)).rejects.toThrow(
      /access to the ticket's channel/,
    );
  });

  it('ClassificationMappingsACL.canDelete rejects a non-participant of a PRIVATE channel', async () => {
    const acl = new ClassificationMappingsACL(ctx);
    const tx = txReturning(
      { id: 'cm1', workspaceId: WS, channelId: 'ch1' }, // stored mapping
      { id: 'ch1', workspaceId: WS, visibility: 'PRIVATE' }, // private channel
      null, // no participant row
    );
    await expect(acl.canDelete({ id: 'cm1' } as never, tx)).rejects.toThrow(
      /access to this channel/,
    );
  });

  it('ClassificationMappingsACL.canDelete allows a PUBLIC channel', async () => {
    const acl = new ClassificationMappingsACL(ctx);
    const tx = txReturning(
      { id: 'cm1', workspaceId: WS, channelId: 'ch1' },
      { id: 'ch1', workspaceId: WS, visibility: 'PUBLIC' },
    );
    await expect(acl.canDelete({ id: 'cm1' } as never, tx)).resolves.toBeUndefined();
  });

  it('TicketStageRequestsACL.canInsert now enforces the channel gate (was workspace-only)', async () => {
    const acl = new TicketStageRequestsACL(ctx);
    const tx = txReturning(null); // ticket channel access -> denied
    await expect(
      acl.canInsert({ workspaceId: WS, ticketId: 't1' } as never, tx),
    ).rejects.toThrow(/access to the ticket's channel/);
  });

  it('TicketStageRequestsACL.canUpsert (new row) enforces the channel gate', async () => {
    const acl = new TicketStageRequestsACL(ctx);
    const tx = txReturning(
      null, // no existing row -> new-row branch
      null, // ticket channel access -> denied
    );
    await expect(
      acl.canUpsert({ id: 'x1', workspaceId: WS, ticketId: 't1' } as never, tx),
    ).rejects.toThrow(/access to the ticket's channel/);
  });
});

describe('XYNE-56394 cross-org OrgMembers escalation (H1)', () => {
  it('canUpdate rejects an admin acting on a member of a DIFFERENT org', async () => {
    const acl = new OrgMembersACL(ctx);
    const tx = txReturning(
      { memberId: 'm2', orgId: 'orgB', role: 'MEMBER' }, // target in org B
      { memberId: 'member-1', orgId: 'orgA' }, // caller's own membership -> org A
    );
    await expect(acl.canUpdate({ memberId: 'm2' } as never, tx)).rejects.toThrow(
      /different organization/,
    );
  });

  it('canUpdate allows an admin acting within their OWN org', async () => {
    const acl = new OrgMembersACL(ctx);
    const tx = txReturning(
      { memberId: 'm2', orgId: 'orgA', role: 'MEMBER' }, // target in org A
      { memberId: 'member-1', orgId: 'orgA' }, // caller also in org A
    );
    await expect(acl.canUpdate({ memberId: 'm2' } as never, tx)).resolves.toBeUndefined();
  });

  it('canDelete rejects an admin acting on a member of a DIFFERENT org', async () => {
    const acl = new OrgMembersACL(ctx);
    const tx = txReturning(
      { memberId: 'm2', orgId: 'orgB', role: 'MEMBER' },
      { memberId: 'member-1', orgId: 'orgA' },
    );
    await expect(acl.canDelete({ memberId: 'm2' } as never, tx)).rejects.toThrow(
      /different organization/,
    );
  });
});
