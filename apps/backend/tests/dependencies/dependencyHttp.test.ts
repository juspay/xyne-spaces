import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
const { dependencyMoveContext, sendDependencyError } =
  await import('../../src/services/dependencies/http');
const { currentDependencyMoveOptions } = await import('../../src/bypassAcl/dependencyStageGate');
import { DependencyError } from '../../src/services/dependencies/types';

function response() {
  let status: number | undefined;
  let body: unknown;
  const res = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
  } as unknown as Response;
  return { res, status: () => status, body: () => body };
}
const request = (body: unknown) =>
  ({ user: { id: 'authenticated', workspaceId: 'workspace' }, body }) as Request;
test('HTTP intent preserves authenticated attribution and context across awaited work', async () => {
  const { res } = response();
  let task: Promise<void> | undefined;
  dependencyMoveContext(
    request({
      actorId: 'forged',
      workspaceId: 'other',
      automation: true,
      dependencyOverride: { reason: '  Risk  ', adminOverride: true },
    }),
    res,
    (() => {
      task = (async () => {
        await Promise.resolve();
        assert.deepEqual(currentDependencyMoveOptions(), {
          actorId: 'authenticated',
          workspaceId: 'workspace',
          automation: false,
          reason: 'Risk',
          adminOverride: true,
        });
      })();
    }) as NextFunction,
  );
  await task;
  assert.equal(currentDependencyMoveOptions(), undefined);
});
test('HTTP malformed intent is refused before continuation without reflecting private input', () => {
  const result = response();
  let invoked = false;
  dependencyMoveContext(
    request({ dependencyOverride: { reason: 'private reason', userId: 'forged' } }),
    result.res,
    () => {
      invoked = true;
    },
  );
  assert.equal(invoked, false);
  assert.equal(result.status(), 400);
  assert.doesNotMatch(JSON.stringify(result.body()), /private reason|forged/);
});
test('HTTP move intent requires authentication', () => {
  const result = response();
  let invoked = false;
  dependencyMoveContext({ body: { actorId: 'forged' } } as Request, result.res, () => {
    invoked = true;
  });
  assert.equal(invoked, false);
  assert.equal(result.status(), 401);
});
test('HTTP refusal returns typed counts only and does not capture ordinary errors', () => {
  const result = response();
  assert.equal(sendDependencyError(new Error('ordinary'), result.res), false);
  const error = new DependencyError(
    'DEPENDENCY_HARD_GATE',
    'Unresolved dependencies prevent this stage move',
    409,
    { hardCount: 2, softCount: 1, canAdminOverride: true },
  );
  assert.equal(sendDependencyError(error, result.res), true);
  assert.equal(result.status(), 409);
  assert.deepEqual(result.body(), {
    error: error.message,
    code: error.code,
    details: { code: error.code, hardCount: 2, softCount: 1, canAdminOverride: true },
  });
});

for (const [code, status] of [
  ['DEPENDENCY_CYCLE', 409],
  ['DEPENDENCY_BUSY', 409],
  ['DEPENDENCY_FLAG_UNAVAILABLE', 503],
] as const) {
  test(`HTTP ${code} preserves its retry status without returning private context`, () => {
    const result = response();
    const error = new DependencyError(code, 'Dependency operation cannot proceed', status);
    assert.equal(sendDependencyError(error, result.res), true);
    assert.equal(result.status(), status);
    assert.deepEqual(result.body(), {
      error: 'Dependency operation cannot proceed', code, details: { code },
    });
  });
}
