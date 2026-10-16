import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fileLimitError } from '@/src/features/xyne-ai/model/composerInputs';
import { isCollectionPick, togglePick } from '@/src/features/xyne-ai/model/contextPicks';
import { commandSections, withCommand } from '@/src/features/xyne-ai/model/composerInputs';

const MB = 1024 * 1024;
const root = { type: 'collection', id: 'c1', title: 'Handbook' };
const folder = { type: 'folder', id: 'f1', title: 'Policies' };

describe('withCommand', () => {
  it('puts the command at the start of the message', () => {
    assert.equal(withCommand('', 'design'), '/design ');
    assert.equal(withCommand('a login page', 'design'), '/design a login page');
  });

  it('replaces a command already there', () => {
    assert.equal(withCommand('/design a login page', 'review'), '/review a login page');
    assert.equal(withCommand('/design', 'review'), '/review ');
  });
});

describe('commandSections', () => {
  it('lists the ai-screen commands by section', () => {
    const names = commandSections.flatMap(({ commands }) => commands.map(({ name }) => name));
    assert.ok(names.includes('design'));
    assert.ok(!names.includes('goal'));
    assert.deepEqual(
      commandSections.map(({ title }) => title),
      ['Producing something', 'Controlling this thread'],
    );
  });
});

describe('togglePick', () => {
  it('adds a folder together with its root collection, once', () => {
    const picked = togglePick([], folder, root);
    assert.deepEqual(picked, [root, folder]);
    assert.deepEqual(togglePick([root], folder, root), [root, folder]);
  });

  it('removes a pick but keeps the root', () => {
    assert.deepEqual(togglePick([root, folder], folder, root), [root]);
  });

  it('adds nothing past the limit, root included', () => {
    const full = Array.from({ length: 19 }, (_, i) => ({
      type: 'channel',
      id: `c${i}`,
      title: 'c',
    }));
    assert.equal(togglePick(full, folder, root), full);
    assert.equal(togglePick(full, root).length, 20);
  });
});

describe('isCollectionPick', () => {
  it('matches only knowledge-base picks', () => {
    assert.equal(isCollectionPick(root), true);
    assert.equal(isCollectionPick({ type: 'channel', id: 'x', title: 'x' }), false);
  });
});

describe('fileLimitError', () => {
  const file = (size: number): { originalFilename: string; size: number } => ({
    originalFilename: 'a.bin',
    size,
  });

  it('accepts files within the limits', () => {
    assert.equal(fileLimitError([], [file(MB)]), null);
  });

  it('rejects a file over 10MB', () => {
    assert.match(fileLimitError([], [file(11 * MB)]) ?? '', /too large: a\.bin/);
  });

  it('counts files already attached towards the 25MB total', () => {
    const data = 'A'.repeat(Math.ceil(((20 * MB) / 3) * 4));
    const existing = [{ filename: 'big', mimeType: 't', data }];
    assert.match(fileLimitError(existing, [file(6 * MB)]) ?? '', /25MB/);
  });
});
