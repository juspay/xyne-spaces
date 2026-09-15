/**
 * Activities.updatedAt semantics.
 *
 * The activity feed sorts by `updatedAt desc`, so this column must only move
 * when a row genuinely re-engages the user (creation, reaction/reply
 * bubbling, recording-summary regeneration). Background writes — the
 * classification pipeline, markAsRead, backfills — must leave it untouched,
 * otherwise already-seen notifications jump back to the top of the feed and
 * look like they "re-triggered".
 *
 * Two layers of coverage:
 *
 * 1. Live-database behaviour: inserts stamp a creation value, plain Prisma
 *    updates (classification / markAsRead / retry shapes) do NOT bump the
 *    column, and only updates that pass `updatedAt` explicitly re-sort.
 * 2. Source guards on the call sites, so a refactor cannot silently
 *    reintroduce an unintended bump (or drop an intended one).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';

// jest does not load apps/backend/.env.local; the live-database block below
// needs DATABASE_URL, so load it before constructing the PrismaClient.
if (!process.env.DATABASE_URL) {
  loadEnv({ path: join(__dirname, '../../../.env.local') });
}

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_USER_ID = 'test-activity-updatedat';
const TEST_WORKSPACE_ID = 'test-activity-updatedat-workspace';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createTestActivity = () =>
  prisma.activity.create({
    data: {
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      actorAction: 'test_action',
      actionSource: 'test',
      actionSourceId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      actorId: 'test-actor',
    },
  });

describe('Activity updatedAt: live-database semantics', () => {
  beforeAll(async () => {
    await prisma.activity.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  it('inserts stamp updatedAt with the creation time', async () => {
    const before = Date.now();
    const row = await createTestActivity();

    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('a classification-style update does NOT bump updatedAt', async () => {
    // Mirrors activityClassificationService.updateClassification /
    // updateClassificationAudience payloads.
    const row = await createTestActivity();
    await sleep(25);

    const updated = await prisma.activity.update({
      where: { id: row.id },
      data: {
        classification: 'ACTIONABLE',
        classificationConfidence: 0.42,
        classificationJobType: null,
      },
    });

    expect(updated.updatedAt.getTime()).toBe(row.updatedAt.getTime());
  });

  it('a markAsRead-style updateMany does NOT bump updatedAt', async () => {
    // Mirrors services/unreadService.ts markThreadAsViewed / markChannelAsViewed.
    const row = await createTestActivity();
    await sleep(25);

    await prisma.activity.updateMany({
      where: { userId: TEST_USER_ID, id: row.id, isRead: false },
      data: { isRead: true },
    });

    const after = await prisma.activity.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.updatedAt.getTime()).toBe(row.updatedAt.getTime());
    expect(after.isRead).toBe(true);
  });

  it('a retry/reset-style updateMany does NOT bump updatedAt', async () => {
    // Mirrors activityClassificationWorkerService scheduleRetry /
    // resetProcessingOnStart / markPermanentFailure payloads.
    const row = await createTestActivity();
    await sleep(25);

    await prisma.activity.updateMany({
      where: { id: row.id },
      data: {
        classification: 'PENDING',
        classificationJobType: null,
        classificationConfidence: null,
      },
    });

    const after = await prisma.activity.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.updatedAt.getTime()).toBe(row.updatedAt.getTime());
  });

  it('passing updatedAt explicitly still re-sorts (reaction/reply bubbling)', async () => {
    // Mirrors activityService.upsertReactionActivityV2 / upsertReplyActivityV2
    // update paths and noteTakerTranscriptService.recordSummaryReadyActivity.
    const row = await createTestActivity();
    const bumpedAt = new Date(row.updatedAt.getTime() + 60_000);

    const updated = await prisma.activity.update({
      where: { id: row.id },
      data: { isRead: false, updatedAt: bumpedAt },
    });

    expect(updated.updatedAt.getTime()).toBe(bumpedAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });
});

describe('Activity updatedAt: schema and call-site guards', () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

  /**
   * Slices a method out of a service source file: from its signature up to
   * the next sibling member (or the class end), so a multi-line params type
   * or a nested callback does not cut the extraction short.
   */
  const extractFunction = (src: string, name: string): string => {
    const start = src.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const boundaries = [
      src.indexOf('\n  async ', start + 1),
      src.indexOf('\n  private ', start + 1),
      src.indexOf('\n  static ', start + 1),
      src.indexOf('\n}', start + 1),
    ].filter((i) => i !== -1);
    expect(boundaries.length).toBeGreaterThan(0);
    return src.slice(start, Math.min(...boundaries));
  };

  const extractCallBlocks = (src: string, marker: string): string[] => {
    const blocks: string[] = [];
    let idx = src.indexOf(marker);
    while (idx !== -1) {
      const end = src.indexOf('});', idx);
      expect(end).toBeGreaterThan(-1);
      blocks.push(src.slice(idx, end));
      idx = src.indexOf(marker, end);
    }
    return blocks;
  };

  it('the Activity model does not use @updatedAt and keeps a creation default', () => {
    const field = Prisma.dmmf.datamodel.models
      .find((m) => m.name === 'Activity')
      ?.fields.find((f) => f.name === 'updatedAt');

    expect(field).toBeDefined();
    // Prisma must not auto-bump the column on updates...
    expect(field?.isUpdatedAt).toBe(false);
    // ...but inserts still get a creation timestamp without every call site
    // passing one explicitly.
    expect(field?.hasDefaultValue).toBe(true);

    const schema = read('../../../prisma/schema.prisma');
    const modelBlock = schema.slice(
      schema.indexOf('model Activity {'),
      schema.indexOf('model UserExternalToken {')
    );
    expect(modelBlock).toMatch(/updatedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(modelBlock).not.toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });

  it('reaction and reply bubbling update paths re-sort explicitly', () => {
    const src = read('./activityService.ts');

    for (const fn of ['upsertReactionActivityV2', 'upsertReplyActivityV2']) {
      const body = extractFunction(src, fn);
      // Exactly one bump: the update path. The create path relies on the
      // column default.
      expect(body.match(/updatedAt: new Date\(\)/g)?.length).toBe(1);
    }
  });

  it('recording-summary regeneration re-sorts explicitly', () => {
    const src = read('../noteTakerTranscriptService.ts');
    const body = extractFunction(src, 'recordSummaryReadyActivity');
    expect(body.match(/updatedAt: new Date\(\)/g)?.length).toBe(1);
  });

  it('the actor-repoint fixup neither bumps updatedAt nor needs raw SQL', () => {
    const src = read('./activityService.ts');
    const body = extractFunction(src, 'updateReactionActivityActorIdOnlyV2');
    expect(body).not.toContain('updatedAt');
    expect(body).not.toContain('$executeRaw');
  });

  it('read actions (unreadService) do not set updatedAt on activities', () => {
    const src = read('../unreadService.ts');
    const blocks = extractCallBlocks(src, 'prisma.activity.updateMany(');
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block).toContain('isRead: true');
      expect(block).not.toMatch(/updatedAt\s*:/);
    }
  });

  it('the classification pipeline never mentions updatedAt', () => {
    for (const rel of [
      './activityClassificationService.ts',
      './activityClassificationWorkerService.ts',
    ]) {
      expect(read(rel)).not.toContain('updatedAt');
    }
  });
});
