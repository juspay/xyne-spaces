import { describe, it, expect } from 'vitest';
import { AllowAllAuthorizer, AccessDeniedError, ResourceNotFoundError } from './default.js';
import { ALL_ACTIONS, refLabel, type ResourceRef } from './types.js';

const wfRef: ResourceRef = {
  type: 'workflow',
  id: 'w1',
  record: {
    id: 'w1',
    status: 'ACTIVE',
    config: null,
    eventType: 'MANUAL',
    summary: null,
    folderId: 'f1',
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
};

describe('AllowAllAuthorizer', () => {
  const authz = new AllowAllAuthorizer();

  it('permits every known action on any resource', async () => {
    const perms = await authz.permissions({ userId: 'u1' }, wfRef);
    expect(perms).toEqual(ALL_ACTIONS);
    expect(perms).toContain('workflow:run');
    expect(perms).toContain('execution:approve');
  });

  it('permits the container actions on root, so top-level creates are open', async () => {
    const perms = await authz.permissions({ userId: 'u1' }, { type: 'root' });
    expect(perms).toContain('folder:create');
    expect(perms).toContain('workflow:create');
  });

  it('filters every list to all', async () => {
    for (const type of ['workflow', 'folder', 'credential', 'approval'] as const) {
      expect(await authz.visibleFilter({ userId: 'u1' }, type)).toEqual({ kind: 'all' });
    }
  });
});

describe('refLabel', () => {
  it('labels an instance ref and the container', () => {
    expect(refLabel(wfRef)).toBe('workflow:w1');
    expect(refLabel({ type: 'root' })).toBe('root');
  });
});

describe('AccessDeniedError', () => {
  it('carries the action and ref and reads as a denial', () => {
    const err = new AccessDeniedError('workflow:run', wfRef);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AccessDeniedError');
    expect(err.action).toBe('workflow:run');
    expect(err.ref).toBe(wfRef);
    expect(err.message).toContain('workflow:run');
    expect(err.message).toContain('workflow:w1');
  });

  it('names the container when create is denied at root', () => {
    const err = new AccessDeniedError('folder:create', { type: 'root' });
    expect(err.message).toContain('root');
  });
});

describe('ResourceNotFoundError', () => {
  it('carries the type and id', () => {
    const err = new ResourceNotFoundError('Folder', 'f9');
    expect(err.name).toBe('ResourceNotFoundError');
    expect(err.type).toBe('Folder');
    expect(err.id).toBe('f9');
    expect(err.message).toContain('f9');
  });
});
