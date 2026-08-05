/**
 * XYNE-55089 — Concurrency safety for DM / GROUP_DM channel creation.
 *
 * Verifies that many simultaneous "open DM" requests for the same participant
 * set converge on a SINGLE channel row (the partial unique index on
 * (workspaceId, name) WHERE scopeType IN ('DM','GROUP_DM') plus the P2002
 * get-or-create fallback), rather than inserting duplicates.
 *
 * Requires the migration `20260805120000_dm_channel_unique_participant_key`
 * to be applied to the test database.
 */
import { PrismaClient } from '@prisma/client';
import { ChannelRepository } from '../channelRepository';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

const prisma = new PrismaClient();
const repo = new ChannelRepository();

const suffix = `${Date.now()}`;
let workspaceId: string;
let projectId: string;
const userIds: string[] = [];
const orgMemberIds: string[] = [];
let orgId: string;

async function makeUser(tag: string): Promise<string> {
  const member = await prisma.orgMember.create({
    data: {
      orgId,
      email: `dmconc-${tag}-${suffix}@example.test`,
      role: 'MEMBER',
    },
  });
  orgMemberIds.push(member.memberId);
  const u = await prisma.user.create({
    data: {
      name: `dmconc-${tag}-${suffix}`,
      email: `dmconc-${tag}-${suffix}@example.test`,
      providerUserId: `dmconc-${tag}-${suffix}`,
      workspaceId,
      orgMemberId: member.memberId,
    },
  });
  return u.id;
}

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `dmconc-org-${suffix}`, createdBy: 'test' },
  });
  orgId = org.orgId;
  const ws = await prisma.workspace.create({
    data: { name: `dmconc-ws-${suffix}`, orgId: org.orgId, createdBy: 'test' },
  });
  workspaceId = ws.id;
  const project = await prisma.project.create({
    data: {
      name: `dmconc-dm-${suffix}`,
      code: `DMC${suffix.slice(-5)}`,
      type: 'DM',
      workspaceId,
      createdBy: 'test',
    },
  });
  projectId = project.id;
  for (const tag of ['a', 'b', 'c']) {
    userIds.push(await makeUser(tag));
  }
});

afterAll(async () => {
  // Channels created by these tests carry no participants/stats, so a direct
  // delete by workspace is safe.
  await prisma.channel.deleteMany({ where: { workspaceId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.orgMember.deleteMany({ where: { memberId: { in: orgMemberIds } } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  if (ws) await prisma.organization.deleteMany({ where: { orgId: ws.orgId } });
  await prisma.$disconnect();
});

const N = 10;

it('collapses concurrent 1:1 DM opens into a single channel', async () => {
  const [a, b] = userIds;
  const name = [a, b].sort().join(',');

  const results = await Promise.all(
    Array.from({ length: N }, () =>
      repo.getOrCreateDmChannel({
        scopeType: ChannelScopeType.DM,
        name,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: a,
        projectId,
        workspaceId,
      }),
    ),
  );

  // Exactly one row in the DB for this participant key.
  const rows = await prisma.channel.findMany({ where: { workspaceId, name } });
  expect(rows).toHaveLength(1);

  // Every caller received the same channel id.
  const ids = new Set(results.map((r) => r.channel.id));
  expect(ids.size).toBe(1);
  expect([...ids][0]).toBe(rows[0].id);

  // Exactly one caller actually inserted; the rest lost the race.
  expect(results.filter((r) => r.created)).toHaveLength(1);
});

it('collapses concurrent group DM opens into a single channel', async () => {
  const name = [...userIds].sort().join(',');

  const results = await Promise.all(
    Array.from({ length: N }, () =>
      repo.getOrCreateDmChannel({
        scopeType: ChannelScopeType.GROUP_DM,
        name,
        visibility: ChannelVisibility.PRIVATE,
        createdBy: userIds[0],
        projectId,
        workspaceId,
      }),
    ),
  );

  const rows = await prisma.channel.findMany({
    where: { workspaceId, name, scopeType: 'GROUP_DM' },
  });
  expect(rows).toHaveLength(1);

  const ids = new Set(results.map((r) => r.channel.id));
  expect(ids.size).toBe(1);
  expect(results.filter((r) => r.created)).toHaveLength(1);
});

it('rejects non-DM scope types', async () => {
  await expect(
    repo.getOrCreateDmChannel({
      scopeType: ChannelScopeType.DEFAULT,
      name: `not-a-dm-${suffix}`,
      createdBy: userIds[0],
      projectId,
      workspaceId,
    }),
  ).rejects.toThrow();
});
