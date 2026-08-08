import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSdlcAskAiContext } from './sdlcAskAiContext';

void test('requires canvas evidence before live repository inspection', () => {
  const context = buildSdlcAskAiContext({
    repo: {
      id: 'repo-1',
      name: 'Hyper Switch',
      url: 'https://github.com/juspay/hyperswitch',
    },
    channelId: 'channel-1',
    baselineDocuments: [{ title: 'Core Code Map', content: 'Architecture summary.' }],
    linkedContext: [],
  });

  assert.match(context, /Before using repository sandbox tools/);
  assert.match(context, /spaces-search/);
  assert.match(context, /type: canvas/);
  assert.match(context, /in: channel-1/);
  assert.match(context, /spaces-read-canvas/);
  assert.match(context, /up to three of the most relevant results/);
  assert.match(
    context,
    /Do not answer a substantive repository question without this canvas preflight/
  );
});

void test('embeds baseline documents so the agent does not need to rediscover them', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [{ title: 'Run Guide', content: 'Use make run.' }],
    linkedContext: ['Linked ticket context'],
  });

  assert.match(context, /## Run Guide\nUse make run\./);
  assert.match(context, /The approved baseline documents below are already loaded/);
  assert.match(context, /Linked ticket context/);
});
