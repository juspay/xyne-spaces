import { describe, it, expect } from 'vitest';
import { canPerform, isPermissionDenied, friendlyMutationError } from './permissions.js';

describe('canPerform', () => {
  it('allows optimistically when permittedActions is undefined (list rows / no authorizer)', () => {
    expect(canPerform(undefined, 'workflow:update')).toBe(true);
    expect(canPerform(undefined, 'workflow:run')).toBe(true);
  });

  it('permits an action present in the set', () => {
    expect(canPerform(['workflow:read', 'workflow:update'], 'workflow:update')).toBe(true);
  });

  it('denies an action absent from the set', () => {
    expect(canPerform(['workflow:read'], 'workflow:update')).toBe(false);
    expect(canPerform([], 'workflow:run')).toBe(false);
  });
});

describe('isPermissionDenied', () => {
  it('is true only for a 403-status error', () => {
    expect(isPermissionDenied({ status: 403 })).toBe(true);
  });

  it('is false for other statuses / plain errors / nullish', () => {
    expect(isPermissionDenied({ status: 400 })).toBe(false);
    expect(isPermissionDenied(new Error('boom'))).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
    expect(isPermissionDenied('nope')).toBe(false);
  });
});

describe('friendlyMutationError', () => {
  it('normalizes a 403 to a permission message', () => {
    expect(friendlyMutationError({ status: 403, message: 'Access denied: workflow:run on workflow:wf1' }))
      .toBe("You don't have permission to perform this action.");
  });

  it('passes through other error messages', () => {
    expect(friendlyMutationError(new Error('Trigger failed'))).toBe('Trigger failed');
    expect(friendlyMutationError('weird')).toBe('weird');
  });
});
