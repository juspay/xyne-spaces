/**
 * XYNE-55091 — Invitation acceptance must be an atomic check-and-set.
 *
 * Regression guard for the double-membership race: previously acceptInvitation
 * did a check-then-update, so two concurrent accepts of the same token both
 * passed validation and both created workspace membership. The fix claims the
 * invitation with a single conditional UPDATE (`WHERE acceptedAt IS NULL`), so
 * exactly one concurrent caller wins and the rest are treated as already-accepted.
 *
 * This test fires N concurrent accepts of the same PENDING invitation and asserts
 * that exactly one succeeds, the rest reject as already-accepted, and exactly one
 * user row is created.
 */
import { PrismaClient, WorkspaceRole } from '@prisma/client';

// Isolate the concurrency guard: stub the heavy, non-relevant collaborators so the
// only real DB effects under test are the invitation claim + user creation.
jest.mock('../services/permissionMatrix', () => ({
  grantPermissionsForRole: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/organizationDomainService', () => ({
  organizationDomainService: {
    assertOrgMemberLimit: jest.fn().mockResolvedValue(undefined),
  },
}));

import { invitationService } from '../services/invitationService';

const prisma = new PrismaClient();

describe('InvitationService.acceptInvitation — atomic check-and-set (XYNE-55091)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `invitee-${suffix}@example.com`;
  const providerUserId = `provider-${suffix}`;
  const invitationId = `inv-token-${suffix}`;

  let orgId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Org ${suffix}`, createdBy: 'seed-test' },
      select: { orgId: true },
    });
    orgId = org.orgId;

    const workspace = await prisma.workspace.create({
      data: { orgId, name: `WS ${suffix}`, createdBy: 'seed-test' },
      select: { id: true },
    });
    workspaceId = workspace.id;

    // Pre-existing org membership so the accept path resolves an orgMember and
    // creates the workspace user (the branch a double-accept would duplicate).
    await prisma.orgMember.create({
      data: { orgId, email: email.toLowerCase(), role: 'MEMBER' },
    });

    await prisma.invitation.create({
      data: {
        orgId,
        workspaceId,
        email,
        role: WorkspaceRole.MEMBER,
        invitedBy: 'seed-test',
        invitationId,
        acceptedAt: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { workspaceId } });
    await prisma.invitation.deleteMany({ where: { invitationId } });
    await prisma.orgMember.deleteMany({ where: { email: email.toLowerCase() } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { orgId } });
    await prisma.$disconnect();
  });

  it('lets exactly one of N concurrent accepts win; the rest are already-accepted', async () => {
    const CONCURRENCY = 5;
    const userData = {
      id: providerUserId,
      email,
      name: 'Concurrent Invitee',
      providerUserId,
      authProvider: 'GOOGLE',
    };

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        invitationService.acceptInvitation({ invitationId, userData }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    // Exactly one caller wins the atomic claim.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENCY - 1);

    // Losers fail as already-accepted (zero-rows-updated), not with some other error.
    for (const r of rejected) {
      expect((r.reason as Error).message).toMatch(/already been accepted/i);
    }

    // The invariant that matters: no double membership.
    const users = await prisma.user.findMany({
      where: { workspaceId, email },
    });
    expect(users).toHaveLength(1);

    // The token is durably marked accepted.
    const invitation = await prisma.invitation.findUnique({
      where: { invitationId },
      select: { acceptedAt: true },
    });
    expect(invitation?.acceptedAt).not.toBeNull();
  });

  it('rejects a subsequent (replayed) accept of an already-accepted token', async () => {
    const userData = {
      id: providerUserId,
      email,
      name: 'Concurrent Invitee',
      providerUserId,
      authProvider: 'GOOGLE',
    };

    await expect(
      invitationService.acceptInvitation({ invitationId, userData }),
    ).rejects.toThrow(/already been accepted/i);
  });
});
