import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createModeQuery,
  decideCreateCanvasAction,
  parseCreateChatAction,
  stripCreateMarkers,
} from './createChatMode.ts';

void describe('parseCreateChatAction', () => {
  void it('puts the user text first so recents are not the system prompt', () => {
    const q = createModeQuery('fdaas', {
      empty: true,
      name: '',
      slug: '',
      description: '',
      instructions: '',
    });
    assert.equal(q.startsWith('fdaas\n'), true);
    assert.match(q, /XYNE_CREATE_DRAFT/);
  });

  void it('strips draft markers from the visible reply', () => {
    const parsed = parseCreateChatAction(
      'I will fill the canvas now.\nXYNE_CREATE_DRAFT: standup scribe that posts Slack summaries',
    );
    assert.equal(parsed.visible, 'I will fill the canvas now.');
    assert.equal(parsed.draftIntent, 'standup scribe that posts Slack summaries');
    assert.equal(parsed.idle, false);
  });

  void it('treats gibberish without a marker as idle', () => {
    const parsed = parseCreateChatAction('Not sure what that means — want to describe an agent?');
    assert.equal(parsed.draftIntent, null);
    assert.equal(parsed.idle, false);
    assert.equal(stripCreateMarkers('fdaas').trim(), 'fdaas');
  });

  void it('parses rename and idle markers', () => {
    assert.equal(
      parseCreateChatAction('XYNE_CREATE_RENAME: Pulse Digest').renameTo,
      'Pulse Digest',
    );
    assert.equal(parseCreateChatAction('Sure.\nXYNE_CREATE_IDLE').idle, true);
  });
});

void describe('decideCreateCanvasAction', () => {
  void it('does not draft from garbage or greetings even if the classifier is noisy', () => {
    const garbage = decideCreateCanvasAction({
      userText: 'fdaas',
      canvasEmpty: true,
      intakePending: false,
      marker: parseCreateChatAction('Should I draft this?'),
    });
    assert.equal(garbage.type, 'idle');

    const hi = decideCreateCanvasAction({
      userText: 'hi',
      canvasEmpty: true,
      intakePending: false,
      marker: parseCreateChatAction('Hi — the canvas on the right is the agent.\nXYNE_CREATE_IDLE'),
    });
    assert.equal(hi.type, 'idle');
  });

  void it('keeps a thin describe idle unless the model emits a draft marker', () => {
    const thin = decideCreateCanvasAction({
      userText: 'make an agent',
      canvasEmpty: true,
      intakePending: false,
      marker: parseCreateChatAction('Who is this for?\nXYNE_CREATE_IDLE'),
    });
    assert.equal(thin.type, 'idle');

    const richNoMarker = decideCreateCanvasAction({
      userText: 'Build a standup scribe that posts a Slack summary every morning.',
      canvasEmpty: true,
      intakePending: false,
      marker: parseCreateChatAction('A few questions first: who is this for?'),
    });
    assert.equal(richNoMarker.type, 'idle');
  });

  void it('drafts when the model emits XYNE_CREATE_DRAFT', () => {
    const action = decideCreateCanvasAction({
      userText: 'Build a standup scribe that posts a Slack summary every morning.',
      canvasEmpty: true,
      intakePending: false,
      marker: parseCreateChatAction(
        'Filling the canvas.\nXYNE_CREATE_DRAFT: standup scribe that posts a Slack summary every morning',
      ),
    });
    assert.equal(action.type, 'draft');
    if (action.type === 'draft') {
      assert.match(action.intent, /standup scribe/i);
      assert.ok(action.fields.includes('systemPrompt'));
    }
  });

  void it('renames from a marker or a local rename without generate-prompt', () => {
    const marked = decideCreateCanvasAction({
      userText: 'call it Pulse',
      canvasEmpty: false,
      intakePending: false,
      marker: parseCreateChatAction('Renamed.\nXYNE_CREATE_RENAME: Pulse Digest'),
    });
    assert.deepEqual(marked, { type: 'rename', name: 'Pulse Digest' });

    const local = decideCreateCanvasAction({
      userText: 'rename it Pulse Digest',
      canvasEmpty: false,
      intakePending: false,
      marker: parseCreateChatAction('Done.'),
    });
    assert.deepEqual(local, { type: 'rename', name: 'Pulse Digest' });
  });

  void it('drafts intake skip/answers without a marker', () => {
    const skip = decideCreateCanvasAction({
      userText: 'skip',
      canvasEmpty: true,
      intakePending: true,
      marker: parseCreateChatAction('Filling it from what we have.'),
    });
    assert.equal(skip.type, 'draft');

    const answer = decideCreateCanvasAction({
      userText: 'for the design team, 5 bullets in Slack, never mention private channels',
      canvasEmpty: true,
      intakePending: true,
      marker: parseCreateChatAction('Got it — drafting now.'),
    });
    assert.equal(answer.type, 'draft');
  });
});
