import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { DependencyMoveOptions } from '../../src/bypassAcl/dependencyStageGate';

// Isolated SQL integration, NOT application ACL/E2E acceptance. Never truncate application tables.
test('dependency gate on real PostgreSQL transactions and independent connections', async t => {
  process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
  const {
    dependencyTicketWrite,
    dependencyBulkStageWrite,
    dependencyBoardPolicyWrite,
    zeroDependencySql,
    prismaDependencySql,
  } = await import('../../src/bypassAcl/dependencyStageGate');
  const connectionString =
    process.env.TICKET_DEPENDENCY_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(connectionString, 'A test DATABASE_URL is required; this test must not silently skip');
  assert.ok(
    process.env.TICKET_DEPENDENCY_TEST_DATABASE_URL ||
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname),
    'Remote databases require an explicit TICKET_DEPENDENCY_TEST_DATABASE_URL pointing to a disposable test database',
  );
  const pool = new Pool({ connectionString, max: 3 });
  const schema = `dependency_test_${randomUUID().replaceAll('-', '')}`;
  const first = await pool.connect();
  const second = await pool.connect();
  const clients = [first, second];
  const definitions: Record<string, string> = {
    ticket_dependency_overrides:
      'id text PRIMARY KEY, "workspaceId" text, "ticketId" text, "edgeId" text, "edgeKind" text, "actorId" text, action text, reason text, "createdAt" timestamptz DEFAULT NOW()',
    users: 'id text PRIMARY KEY, "workspaceId" text, role text',
    boards:
      'id text PRIMARY KEY, "workspaceId" text, "boardType" text, metadata jsonb, "createdBy" text',
    stages:
      'id text PRIMARY KEY, "workspaceId" text, "boardId" text, name text, "sequenceNumber" int, "defaultTicketStatusV2" text',
    tickets:
      'id text PRIMARY KEY, "workspaceId" text, "boardId" text, "channelId" text, "stageName" text, "statusV2" text, "updatedBy" text, "isArchived" boolean DEFAULT false, eta timestamptz',
    ticket_reference_mappings:
      'id text PRIMARY KEY, "workspaceId" text, "relationType" text, "sourceTicketId" text, "targetTicketId" text, strength text, "gatedStageId" text, "satisfiedStageId" text, "satisfiedAt" timestamptz, "overriddenAt" timestamptz, "overriddenBy" text, "overrideReason" text, "reviewNeededAt" timestamptz',
    sub_tickets: 'id text PRIMARY KEY, "workspaceId" text, "mappedTicketId" text',
    ticket_sub_ticket_mappings:
      'id text PRIMARY KEY, "workspaceId" text, "ticketId" text, "subTicketId" text, strength text, "gatedStageId" text, "satisfiedAt" timestamptz, "overriddenAt" timestamptz, "overriddenBy" text, "overrideReason" text',
    resources: 'id text PRIMARY KEY, name text',
    resource_access:
      'id text PRIMARY KEY, "workspaceId" text, "resourceId" text, "accessType" text, "userId" text, "groupId" text',
    user_groups: 'id text PRIMARY KEY, "workspaceId" text, "isActive" boolean',
    user_group_mappings:
      'id text PRIMARY KEY, "workspaceId" text, "userId" text, "userGroupId" text',
    ticket_activities:
      'id text PRIMARY KEY, "workspaceId" text, "ticketId" text, "updatedBy" text, timestamp timestamptz, "activityType" text, "channelId" text, value jsonb',
  };
  const sql = (client: PoolClient) => ({
    query: async (text: string, values: unknown[]) =>
      (
        await client.query(
          text.replaceAll(
            '"non_zero"."ticket_dependency_overrides"',
            `"${schema}"."ticket_dependency_overrides"`,
          ),
          values,
        )
      ).rows as unknown[],
  });
  const reset = async (strength = 'HARD', policy = {}) => {
    await first.query(
      `TRUNCATE ${Object.keys(definitions)
        .map(name => `"${schema}".${name}`)
        .join(', ')}`,
    );
    await first.query(
      "INSERT INTO users VALUES ('actor', 'ws', 'MEMBER'), ('admin', 'ws', 'MEMBER'), ('guest', 'ws', 'GUEST')",
    );
    await first.query('INSERT INTO boards VALUES ($1, $2, $3, $4, $5)', [
      'board',
      'ws',
      'DEFAULT',
      { dependencyPolicy: policy },
      'admin',
    ]);
    for (const [id, name, sequence, status] of [
      ['todo', 'Todo', 0, 'TODO'],
      ['doing', 'Doing', 1, 'STARTED'],
      ['done', 'Done', 2, 'COMPLETED'],
      ['cancel', 'Cancelled', 3, 'CANCELLED'],
    ]) {
      await first.query('INSERT INTO stages VALUES ($1, $2, $3, $4, $5, $6)', [
        id,
        'ws',
        'board',
        name,
        sequence,
        status,
      ]);
    }
    for (const [id, stage, status] of [
      ['hidden-blocker', 'Todo', 'TODO'],
      ['dependent', 'Doing', 'STARTED'],
    ]) {
      await first.query(
        'INSERT INTO tickets (id, "workspaceId", "boardId", "channelId", "stageName", "statusV2", "updatedBy") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, 'ws', 'board', 'channel', stage, status, 'actor'],
      );
    }
    await first.query(
      'INSERT INTO ticket_reference_mappings (id, "workspaceId", "relationType", "sourceTicketId", "targetTicketId", strength) VALUES ($1, $2, $3, $4, $5, $6)',
      ['edge', 'ws', 'BLOCKS', 'hidden-blocker', 'dependent', strength],
    );
  };
  const transition = async (
    client: PoolClient,
    id: string,
    name: string,
    status: string,
    options: Partial<DependencyMoveOptions> = {},
    after?: () => Promise<void>,
  ) => {
    await client.query('BEGIN');
    try {
      const result = await dependencyTicketWrite(
        sql(client),
        id,
        { stageName: name, statusV2: status },
        { actorId: 'actor', ...options },
        async () => {
          await client.query('UPDATE tickets SET "stageName" = $1, "statusV2" = $2 WHERE id = $3', [
            name,
            status,
            id,
          ]);
          await after?.();
          return 'written';
        },
        async () => true,
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };
  const edge = async () =>
    (await first.query('SELECT * FROM ticket_reference_mappings WHERE id = $1', ['edge'])).rows[0];
  try {
    await first.query(`CREATE SCHEMA "${schema}"`);
    for (const client of clients) await client.query(`SET search_path TO "${schema}"`);
    for (const [name, definition] of Object.entries(definitions))
      await first.query(`CREATE TABLE ${name} (${definition})`);
    const changePolicy = async (actorId: string, metadata: unknown) => {
      await first.query('BEGIN');
      try {
        await dependencyBoardPolicyWrite(sql(first), 'board', { metadata }, { actorId, workspaceId: 'ws' },
          () => first.query('UPDATE boards SET metadata = $1::jsonb WHERE id = $2', [JSON.stringify(metadata), 'board']));
        await first.query('COMMIT');
      } catch (error) { await first.query('ROLLBACK'); throw error; }
    };
    await t.test('board policy changes require live authority, unrelated metadata does not', async () => {
      await reset();
      await changePolicy('actor', { anotherSetting: true });
      const hard = { dependencyPolicy: { defaultStrength: 'HARD', hardGateStageIds: ['done'], automationOnSoftGate: 'STOP' } };
      await assert.rejects(changePolicy('actor', hard), { code: 'DEPENDENCY_FORBIDDEN' });
      await changePolicy('admin', hard);
      // Null/reset is a policy change too; unrelated settings must preserve the policy.
      await assert.rejects(changePolicy('actor', null), { code: 'DEPENDENCY_FORBIDDEN' });
      await changePolicy('actor', { ...hard, anotherSetting: false });
      await first.query('UPDATE boards SET "createdBy" = $1', ['other-admin']);
      await assert.rejects(changePolicy('admin', null), { code: 'DEPENDENCY_FORBIDDEN' });
    });
    const bulk = async (ids: string[], skip?: string, fail = false) => {
      await first.query('BEGIN');
      try {
        const result = await dependencyBulkStageWrite(
          sql(first),
          ids.map(id => ({ id, data: { stageName: 'Done', statusV2: 'COMPLETED' } })),
          { actorId: 'actor', workspaceId: 'ws' },
          async () => {
            for (const id of ids.filter(id => id !== skip))
              await first.query(
                'UPDATE tickets SET "stageName" = $1, "statusV2" = $2 WHERE id = $3',
                ['Done', 'COMPLETED', id],
              );
            if (fail) throw new Error('bulk writer failed');
            return 'bulk written';
          },
          async () => true,
        );
        await first.query('COMMIT');
        return result;
      } catch (error) {
        await first.query('ROLLBACK');
        throw error;
      }
    };
    await t.test('nested bulk stage writers emit one private override and redacted activity', async () => {
      await reset('SOFT');
      await first.query('BEGIN');
      const data = { stageName: 'Done', statusV2: 'COMPLETED' };
      const options = { actorId: 'actor', workspaceId: 'ws', reason: 'Private consent' };
      try {
        await dependencyBulkStageWrite(sql(first), [{ id: 'dependent', data }], options,
          () => dependencyTicketWrite(sql(first), 'dependent', data, options,
            () => first.query('UPDATE tickets SET "stageName" = $1, "statusV2" = $2 WHERE id = $3', ['Done', 'COMPLETED', 'dependent']),
            async () => true), async () => true);
        await first.query('COMMIT');
      } catch (error) { await first.query('ROLLBACK'); throw error; }
      const audit = (await first.query('SELECT * FROM ticket_dependency_overrides')).rows;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].reason, 'Private consent');
      const activities = (await first.query('SELECT * FROM ticket_activities')).rows;
      assert.equal(activities.length, 1);
      assert.doesNotMatch(JSON.stringify(activities), /Private consent|hidden-blocker/);
    });
    await t.test(
      'atomic bulk evaluates the final graph independently of target order',
      async () => {
        for (const ids of [
          ['dependent', 'hidden-blocker'],
          ['hidden-blocker', 'dependent'],
        ]) {
          await reset();
          assert.equal(await bulk(ids), 'bulk written');
          assert.ok((await edge()).satisfiedAt);
          assert.equal((await edge()).overriddenAt, null);
          assert.equal(
            (await first.query('SELECT count(*)::int AS count FROM ticket_dependency_overrides'))
              .rows[0].count,
            0,
          );
        }
      },
    );
    await t.test(
      'atomic bulk refuses before writing if any final blocker stays unresolved',
      async () => {
        await reset();
        await assert.rejects(bulk(['dependent']), { code: 'DEPENDENCY_HARD_GATE' });
        assert.equal(
          (await first.query('SELECT "stageName" FROM tickets WHERE id = $1', ['dependent']))
            .rows[0].stageName,
          'Doing',
        );
        assert.equal((await edge()).satisfiedAt, null);
      },
    );
    await t.test(
      'approval-only or skipped bulk target rolls every requested move back',
      async () => {
        await reset();
        await assert.rejects(bulk(['dependent', 'hidden-blocker'], 'hidden-blocker'), {
          code: 'DEPENDENCY_STAGE_NOT_APPLIED',
        });
        assert.equal(
          (await first.query('SELECT "stageName" FROM tickets WHERE id = $1', ['dependent']))
            .rows[0].stageName,
          'Doing',
        );
        assert.equal((await edge()).satisfiedAt, null);
        assert.equal(
          (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0].count,
          0,
        );
      },
    );
    await t.test('bulk writer failure and duplicate targets cannot leak satisfaction', async () => {
      await reset();
      await assert.rejects(
        bulk(['dependent', 'hidden-blocker'], undefined, true),
        /bulk writer failed/,
      );
      await assert.rejects(bulk(['dependent', 'dependent']), { code: 'DEPENDENCY_INPUT' });
      assert.equal((await edge()).satisfiedAt, null);
    });
    await t.test(
      'hard gate rejects without revealing privileged endpoint or invoking write',
      async () => {
        await reset();
        await assert.rejects(transition(first, 'dependent', 'Done', 'COMPLETED'), error => {
          assert.equal((error as { code: string }).code, 'DEPENDENCY_HARD_GATE');
          assert.doesNotMatch(JSON.stringify(error), /hidden-blocker|edge|board|channel/);
          return true;
        });
        assert.equal(
          (await first.query('SELECT "stageName" FROM tickets WHERE id = \'dependent\'')).rows[0]
            .stageName,
          'Doing',
        );
        assert.equal((await edge()).overriddenAt, null);
      },
    );
    await t.test(
      'soft gate requires a nonempty reason and overrides do not latch satisfaction',
      async () => {
        await reset('SOFT');
        await assert.rejects(
          transition(first, 'dependent', 'Done', 'COMPLETED', { reason: '   ' }),
          { code: 'DEPENDENCY_REASON_REQUIRED' },
        );
        await transition(first, 'dependent', 'Done', 'COMPLETED', { reason: '  Accepted risk  ' });
        assert.equal((await edge()).overrideReason, null);
        assert.equal(
          (await first.query(`SELECT reason FROM "${schema}".ticket_dependency_overrides`)).rows[0]
            .reason,
          'Accepted risk',
        );
        assert.equal((await edge()).satisfiedAt, null);
        assert.doesNotMatch(
          JSON.stringify((await first.query('SELECT value FROM ticket_activities')).rows),
          /Accepted risk|hidden-blocker/,
        );
      },
    );
    await t.test(
      'hard override reauthorizes board admin; client flag alone is insufficient',
      async () => {
        await reset();
        await assert.rejects(
          transition(first, 'dependent', 'Done', 'COMPLETED', {
            reason: 'Override',
            adminOverride: true,
          }),
          { code: 'DEPENDENCY_HARD_GATE' },
        );
        await transition(first, 'dependent', 'Done', 'COMPLETED', {
          actorId: 'admin',
          reason: 'Emergency',
          adminOverride: true,
        });
        assert.equal((await edge()).overriddenBy, null);
        assert.equal(
          (await first.query(`SELECT "actorId" FROM "${schema}".ticket_dependency_overrides`))
            .rows[0].actorId,
          'admin',
        );
      },
    );
    await t.test('inactive or foreign-workspace group cannot grant admin', async () => {
      await reset();
      await first.query(
        "INSERT INTO resources VALUES ('projects', 'LISTPROJECTS'); INSERT INTO user_groups VALUES ('group', 'ws', false); INSERT INTO user_group_mappings VALUES ('membership', 'ws', 'actor', 'group'); INSERT INTO resource_access VALUES ('grant', 'ws', 'projects', 'ADMIN', NULL, 'group')",
      );
      await assert.rejects(
        transition(first, 'dependent', 'Done', 'COMPLETED', {
          reason: 'Override',
          adminOverride: true,
        }),
        { code: 'DEPENDENCY_HARD_GATE' },
      );
      await first.query('UPDATE user_groups SET "isActive" = true, "workspaceId" = \'foreign\'');
      await assert.rejects(
        transition(first, 'dependent', 'Done', 'COMPLETED', {
          reason: 'Override',
          adminOverride: true,
        }),
        { code: 'DEPENDENCY_HARD_GATE' },
      );
      await first.query('UPDATE user_groups SET "workspaceId" = \'ws\'');
      await transition(first, 'dependent', 'Done', 'COMPLETED', {
        reason: 'Authorized group',
        adminOverride: true,
      });
    });
    await t.test('board policy upgrades legacy SOFT edges to hard', async () => {
      await reset('SOFT', { hardGateStageIds: ['done'] });
      await assert.rejects(
        transition(first, 'dependent', 'Done', 'COMPLETED', { reason: 'Not enough' }),
        { code: 'DEPENDENCY_HARD_GATE' },
      );
    });
    await t.test(
      'automation respects STOP and PROCEED without inventing a human reason',
      async () => {
        await reset('SOFT', { automationOnSoftGate: 'STOP' });
        await assert.rejects(
          transition(first, 'dependent', 'Done', 'COMPLETED', { automation: true }),
          { code: 'DEPENDENCY_AUTOMATION_STOP' },
        );
        await first.query("UPDATE boards SET metadata = '{}'::jsonb");
        await transition(first, 'dependent', 'Done', 'COMPLETED', { automation: true });
        assert.equal((await edge()).overrideReason, null);
        assert.equal(
          (await first.query(`SELECT reason FROM "${schema}".ticket_dependency_overrides`)).rows[0]
            .reason,
          'automation',
        );
      },
    );
    await t.test('completion latches once and reopening does not reblock', async () => {
      await reset();
      await transition(first, 'hidden-blocker', 'Done', 'COMPLETED');
      const at = (await edge()).satisfiedAt;
      assert.ok(at);
      await transition(first, 'hidden-blocker', 'Todo', 'TODO');
      await transition(first, 'dependent', 'Done', 'COMPLETED');
      assert.deepEqual((await edge()).satisfiedAt, at);
      assert.equal(
        (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0].count,
        1,
      );
    });
    await t.test('BLOCKS cancellation needs review rather than silently satisfying', async () => {
      await reset();
      await transition(first, 'hidden-blocker', 'Cancelled', 'CANCELLED');
      assert.equal((await edge()).satisfiedAt, null);
      assert.ok((await edge()).reviewNeededAt);
    });
    await t.test(
      'mapped CHILD cancellation satisfies while preserving the legacy mapping',
      async () => {
        await reset();
        await first.query(
          "DELETE FROM ticket_reference_mappings; INSERT INTO sub_tickets VALUES ('sub', 'ws', 'hidden-blocker'); INSERT INTO ticket_sub_ticket_mappings (id, \"workspaceId\", \"ticketId\", \"subTicketId\", strength) VALUES ('mapping', 'ws', 'dependent', 'sub', 'HARD')",
        );
        await transition(first, 'hidden-blocker', 'Cancelled', 'CANCELLED');
        assert.ok(
          (await first.query('SELECT "satisfiedAt" FROM ticket_sub_ticket_mappings')).rows[0]
            .satisfiedAt,
        );
        await transition(first, 'dependent', 'Done', 'COMPLETED');
      },
    );
    await t.test(
      'failed downstream write rolls back stage, override, latch and activity together',
      async () => {
        await reset('SOFT');
        await assert.rejects(
          transition(first, 'dependent', 'Done', 'COMPLETED', { reason: 'Risk' }, async () => {
            throw new Error('downstream failed');
          }),
          /downstream failed/,
        );
        assert.equal((await edge()).overriddenAt, null);
        assert.equal(
          (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0].count,
          0,
        );
        assert.equal(
          (await first.query('SELECT "stageName" FROM tickets WHERE id = \'dependent\'')).rows[0]
            .stageName,
          'Doing',
        );
      },
    );
    await t.test(
      'mixed graph lock uses the existing hashtext key and refuses a competing connection',
      async () => {
        await reset();
        await first.query('BEGIN');
        await first.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['link-subticket:ws:ws']);
        try {
          await assert.rejects(transition(second, 'dependent', 'Done', 'COMPLETED'), {
            code: 'DEPENDENCY_BUSY',
          });
        } finally {
          await first.query('ROLLBACK');
        }
        await transition(first, 'hidden-blocker', 'Done', 'COMPLETED');
        await transition(second, 'dependent', 'Done', 'COMPLETED');
      },
    );
    await t.test('board/status mismatch fails before the original write', async () => {
      await reset();
      await assert.rejects(transition(first, 'dependent', 'Done', 'CANCELLED'), {
        code: 'DEPENDENCY_STAGE',
      });
    });
    await t.test('a conditional no-op cannot fabricate a latch or override', async () => {
      await reset('SOFT');
      await first.query('BEGIN');
      try {
        await dependencyTicketWrite(
          sql(first),
          'dependent',
          { stageName: 'Done', statusV2: 'COMPLETED' },
          { actorId: 'actor', reason: 'Risk' },
          async () => ({ count: 0 }),
          async () => true,
        );
        await first.query('COMMIT');
      } catch (error) {
        await first.query('ROLLBACK');
        throw error;
      }
      assert.equal((await edge()).overriddenAt, null);
      assert.equal(
        (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0].count,
        0,
      );
    });
    await t.test(
      'CHILD free-text reasons are private and not stored in replicated rows',
      async () => {
        await reset('SOFT');
        await first.query(
          `DELETE FROM ticket_reference_mappings; INSERT INTO sub_tickets VALUES ('sub', 'ws', 'hidden-blocker'); INSERT INTO ticket_sub_ticket_mappings (id, "workspaceId", "ticketId", "subTicketId", strength) VALUES ('mapping', 'ws', 'dependent', 'sub', 'SOFT')`,
        );
        await transition(first, 'dependent', 'Done', 'COMPLETED', {
          reason: 'Hidden title on a private board',
        });
        const mapping = (await first.query('SELECT * FROM ticket_sub_ticket_mappings')).rows[0];
        assert.equal(mapping.overrideReason, null);
        assert.equal(mapping.overriddenBy, null);
        assert.ok(mapping.overriddenAt);
        assert.equal(
          (await first.query('SELECT reason FROM ticket_dependency_overrides')).rows[0].reason,
          'Hidden title on a private board',
        );
        assert.doesNotMatch(
          JSON.stringify((await first.query('SELECT * FROM ticket_activities')).rows),
          /Hidden title|private board|hidden-blocker/,
        );
      },
    );
    await t.test('workspace identity cannot be supplied by the row being moved', async () => {
      await reset();
      await assert.rejects(
        dependencyTicketWrite(
          sql(first),
          'dependent',
          { stageName: 'Done' },
          { actorId: 'actor', workspaceId: 'foreign' },
          async () => {
            throw new Error('must not write');
          },
          async () => false,
        ),
        { code: 'DEPENDENCY_NOT_FOUND' },
      );
    });
    await t.test('FLOW ignores incoming gates', async () => {
      await reset();
      await first.query('UPDATE boards SET "boardType" = \'FLOW\'');
      await transition(first, 'dependent', 'Done', 'COMPLETED');
      assert.equal((await edge()).satisfiedAt, null);
    });
    await t.test(
      'missing private audit storage fails closed and rolls the stage back',
      async () => {
        await reset('SOFT');
        await first.query('DROP TABLE ticket_dependency_overrides');
        try {
          await assert.rejects(
            transition(first, 'dependent', 'Done', 'COMPLETED', { reason: 'Risk' }),
            { code: '42P01' },
          );
          assert.equal((await edge()).overriddenAt, null);
          assert.equal(
            (await first.query('SELECT "stageName" FROM tickets WHERE id = \'dependent\'')).rows[0]
              .stageName,
            'Doing',
          );
          assert.equal(
            (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0]
              .count,
            0,
          );
        } finally {
          await first.query(
            `CREATE TABLE ticket_dependency_overrides (${definitions.ticket_dependency_overrides})`,
          );
        }
      },
    );
    await t.test('flag evaluator failure never invokes the ticket write', async () => {
      await reset();
      let written = false;
      await assert.rejects(
        dependencyTicketWrite(
          sql(first),
          'dependent',
          { stageName: 'Done' },
          { actorId: 'actor' },
          async () => {
            written = true;
          },
          async () => {
            throw new Error('provider unavailable');
          },
        ),
        /provider unavailable/,
      );
      assert.equal(written, false);
      assert.equal((await edge()).satisfiedAt, null);
    });
    await t.test(
      'real Prisma callback delegates reach the connection-bound guard exactly once',
      async () => {
        const { PrismaClient } = await import('@prisma/client');
        const { withAclExtension, currentTransactionClient } =
          await import('../../src/database/tenant/acl-extension');
        const raw = new PrismaClient({ datasourceUrl: connectionString });
        let calls = 0;
        // Short-circuit the actual model query: no application table is read or written.
        const wrapped = withAclExtension(
          raw,
          raw,
          async (_root, model, operation, _input, _execute, connection) => {
            assert.equal(model, 'Ticket');
            assert.equal(operation, 'update');
            assert.ok(connection);
            assert.equal(connection, currentTransactionClient());
            calls++;
            return { id: 'not-an-application-ticket' };
          },
        );
        try {
          await wrapped.$transaction(async transaction => {
            assert.deepEqual(
              await transaction.ticket.update({
                where: { id: 'not-an-application-ticket' },
                data: { stageName: 'Done' },
              }),
              { id: 'not-an-application-ticket' },
            );
          });
          assert.equal(calls, 1);
          assert.equal(currentTransactionClient(), undefined);
        } finally {
          await raw.$disconnect();
        }
      },
    );
    await t.test(
      'real Prisma SQL adapter rolls back ticket and gate effects on the same engine transaction',
      async () => {
        await reset();
        const { PrismaClient } = await import('@prisma/client');
        const raw = new PrismaClient({ datasourceUrl: connectionString });
        try {
          await assert.rejects(
            raw.$transaction(async transaction => {
              const adapter = prismaDependencySql(transaction);
              await adapter.query("SELECT set_config('search_path', $1, true)", [
                `"${schema}", public`,
              ]);
              await dependencyTicketWrite(
                adapter,
                'hidden-blocker',
                { stageName: 'Done', statusV2: 'COMPLETED' },
                { actorId: 'actor' },
                () =>
                  adapter.query(
                    'UPDATE tickets SET "stageName" = $1, "statusV2" = $2 WHERE id = $3 RETURNING id',
                    ['Done', 'COMPLETED', 'hidden-blocker'],
                  ),
                async () => true,
              );
              const latched = (await adapter.query(
                'SELECT "satisfiedAt" FROM ticket_reference_mappings',
                [],
              )) as Array<{ satisfiedAt: Date | null }>;
              assert.ok(latched[0].satisfiedAt);
              throw new Error('Prisma engine rollback');
            }),
            /Prisma engine rollback/,
          );
          assert.equal((await edge()).satisfiedAt, null);
          assert.equal(
            (await first.query('SELECT "stageName" FROM tickets WHERE id = \'hidden-blocker\''))
              .rows[0].stageName,
            'Todo',
          );
          assert.equal(
            (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0]
              .count,
            0,
          );
        } finally {
          await raw.$disconnect();
        }
      },
    );
    await t.test(
      'installed Zero pg adapter rolls back gate effects and ticket writes on its real transaction',
      async () => {
        await reset();
        const { zeroNodePg } = await import('@rocicorp/zero/server/adapters/pg');
        const { createSchema, table, string } = await import('@rocicorp/zero');
        const proofSchema = createSchema({
          tables: [
            table('tickets')
              .columns({ id: string(), stageName: string(), statusV2: string() })
              .primaryKey('id'),
          ],
          relationships: [],
        });
        const database = zeroNodePg(proofSchema, first);
        await assert.rejects(
          database.transaction(async transaction => {
            await dependencyTicketWrite(
              zeroDependencySql(transaction),
              'hidden-blocker',
              { stageName: 'Done', statusV2: 'COMPLETED' },
              { actorId: 'actor' },
              () =>
                transaction.mutate.tickets.update({
                  id: 'hidden-blocker',
                  stageName: 'Done',
                  statusV2: 'COMPLETED',
                }),
              async () => true,
            );
            assert.ok(
              (
                await transaction.dbTransaction.query(
                  'SELECT "satisfiedAt" FROM ticket_reference_mappings',
                  [],
                )
              )[0].satisfiedAt,
            );
            throw new Error('Zero adapter rollback');
          }),
          /Zero adapter rollback/,
        );
        assert.equal((await edge()).satisfiedAt, null);
        assert.equal(
          (await first.query('SELECT "stageName" FROM tickets WHERE id = \'hidden-blocker\''))
            .rows[0].stageName,
          'Todo',
        );
        assert.equal(
          (await first.query('SELECT count(*)::int AS count FROM ticket_activities')).rows[0].count,
          0,
        );
      },
    );
    await t.test(
      'migration preserves historical CHILD reasons privately before clearing replicated text',
      async () => {
        await reset();
        await first.query(`DROP TABLE ticket_dependency_overrides;
        INSERT INTO ticket_sub_ticket_mappings (id, "workspaceId", "ticketId", "subTicketId", "overrideReason", "overriddenBy", "overriddenAt")
        VALUES ('legacy', 'ws', 'dependent', 'sub', 'Historical hidden title', 'admin', NOW())`);
        const migration = await readFile(
          new URL(
            '../../prisma/migrations/20261127120000_ticket_dependency_override_audit/migration.sql',
            import.meta.url,
          ),
          'utf8',
        );
        // Only schema identifiers change; production application tables are never touched.
        const isolated = migration
          .replaceAll('"non_zero".', `"${schema}".`)
          .replaceAll('"public".', `"${schema}".`);
        await first.query('BEGIN');
        try {
          await first.query(isolated);
          await first.query('COMMIT');
        } catch (error) {
          await first.query('ROLLBACK');
          throw error;
        }
        assert.equal(
          (
            await first.query(
              'SELECT "overrideReason" FROM ticket_sub_ticket_mappings WHERE id = $1',
              ['legacy'],
            )
          ).rows[0].overrideReason,
          null,
        );
        const audit = (await first.query('SELECT * FROM ticket_dependency_overrides')).rows[0];
        assert.equal(audit.reason, 'Historical hidden title');
        assert.equal(audit.actorId, 'admin');
        assert.equal(audit.action, 'LEGACY_OVERRIDE');
      },
    );
  } finally {
    for (const client of clients) await client.query('ROLLBACK');
    await first.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const client of clients) client.release();
    await pool.end();
  }
});
