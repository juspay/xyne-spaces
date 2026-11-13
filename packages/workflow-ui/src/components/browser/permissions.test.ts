import { describe, it, expect } from 'vitest';
import { entryCan } from './permissions.js';
import type { BrowserEntry } from './types.js';

const file = (permittedActions?: BrowserEntry['permittedActions']): BrowserEntry => ({
  kind: 'file',
  id: 'w1',
  name: 'W',
  format: 'workflow',
  ...(permittedActions ? { permittedActions } : {}),
});
const folder = (permittedActions?: BrowserEntry['permittedActions']): BrowserEntry => ({
  kind: 'folder',
  id: 'f1',
  name: 'F',
  ...(permittedActions ? { permittedActions } : {}),
});

describe('entryCan — row-action gating', () => {
  it('maps a file entry to workflow:* actions', () => {
    const owner = file(['workflow:read', 'workflow:update', 'workflow:delete', 'workflow:share']);
    expect(entryCan(owner, 'update')).toBe(true);
    expect(entryCan(owner, 'delete')).toBe(true);
    expect(entryCan(owner, 'share')).toBe(true);
  });

  it('maps a folder entry to folder:* actions', () => {
    const owner = folder(['folder:read', 'folder:update', 'folder:delete', 'folder:share']);
    expect(entryCan(owner, 'update')).toBe(true);
    expect(entryCan(owner, 'delete')).toBe(true);
    expect(entryCan(owner, 'share')).toBe(true);
  });

  it('withholds actions a viewer lacks', () => {
    const viewer = file(['workflow:read']);
    expect(entryCan(viewer, 'update')).toBe(false);
    expect(entryCan(viewer, 'delete')).toBe(false);
    expect(entryCan(viewer, 'share')).toBe(false);
  });

  it('does not cross resource types — a folder-share grant never enables a file', () => {
    const wrongType = file(['folder:share', 'folder:update']);
    expect(entryCan(wrongType, 'share')).toBe(false);
    expect(entryCan(wrongType, 'update')).toBe(false);
  });

  it('is optimistic when permittedActions is undefined (backend still enforces)', () => {
    expect(entryCan(file(), 'delete')).toBe(true);
    expect(entryCan(folder(), 'share')).toBe(true);
  });
});
