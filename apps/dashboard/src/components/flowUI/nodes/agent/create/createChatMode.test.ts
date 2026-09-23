import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createModeQuery,
  compactCreateDraftChatReply,
  decideCreateCanvasAction,
  parseCreateChatAction,
  sectionCompleteChatLine,
  shouldHoldDraftChatAck,
  stripCreateMarkers,
  visibleCreateReply,
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
    assert.match(q, /standup bot/);
    assert.match(q, /XYNE_CREATE_ASK/);
    assert.match(q, /also suggest the matching Hub rows/);
    assert.match(q, /# Agent authoring/);
    assert.match(q, /Ask AI chat/);
    assert.doesNotMatch(q, /propose-agent/);
    assert.doesNotMatch(q, /In chat, state them explicitly as \*\*Name\*\*/);
  });

  void it('holds draft chat ack until canvas sections land', () => {
    const draft =
      'Drafted Design Radar on the canvas.\nXYNE_CREATE_DRAFT: design radar';
    assert.equal(shouldHoldDraftChatAck(draft), true);
    assert.equal(visibleCreateReply(draft, true), '');
    assert.equal(visibleCreateReply(draft, false), '');
    assert.equal(
      shouldHoldDraftChatAck('Hi — the canvas on the right is the agent.\nXYNE_CREATE_IDLE'),
      false,
    );
    assert.equal(
      visibleCreateReply('Hi — the canvas on the right is the agent.\nXYNE_CREATE_IDLE', false),
      'Hi — the canvas on the right is the agent.',
    );
    assert.equal(sectionCompleteChatLine({ field: 'name', name: 'Standup Scribe' }), 'Name set to Standup Scribe.');
    assert.equal(sectionCompleteChatLine({ field: 'systemPrompt' }), 'Instructions are on the canvas.');
    assert.equal(sectionCompleteChatLine({ field: 'tools', hubRow: 'mcp' }), 'Also suggested MCP for email / X.');
  });

  void it('strips draft markers from the visible reply', () => {
    const parsed = parseCreateChatAction(
      'I will fill the canvas now.\nXYNE_CREATE_DRAFT: standup scribe that posts Slack summaries',
    );
    assert.equal(parsed.visible, 'I will fill the canvas now.');
    assert.equal(parsed.draftIntent, 'standup scribe that posts Slack summaries');
    assert.equal(parsed.idle, false);
    assert.equal(parsed.ask, false);
  });

  void it('compacts profile dumps into a short canvas ack', () => {
    const wall =
      '**Name**: Design Radar (@design-radar)\n' +
      '**Description**: Surfaces design trends.\n' +
      '**Instructions**:\nYou are Design Radar.\n' +
      '**Rules**:\nStay concise.';
    assert.equal(compactCreateDraftChatReply(wall), 'Drafted Design Radar on the canvas.');
    assert.equal(
      visibleCreateReply(`${wall}\nXYNE_CREATE_DRAFT: design radar`, false),
      '',
    );
    assert.equal(
      compactCreateDraftChatReply('Drafted Design Radar on the canvas.'),
      'Drafted Design Radar on the canvas.',
    );
  });

  void it('treats gibberish without a marker as idle', () => {
    const parsed = parseCreateChatAction('Not sure what that means — want to describe an agent?');
    assert.equal(parsed.draftIntent, null);
    assert.equal(parsed.idle, false);
    assert.equal(parsed.ask, false);
    assert.equal(stripCreateMarkers('fdaas').trim(), 'fdaas');
  });

  void it('parses rename, idle, and ask markers', () => {
    assert.equal(
      parseCreateChatAction('XYNE_CREATE_RENAME: Pulse Digest').renameTo,
      'Pulse Digest',
    );
    assert.equal(parseCreateChatAction('Sure.\nXYNE_CREATE_IDLE').idle, true);
    const ask = parseCreateChatAction('Which tracker — Jira or Linear?\nXYNE_CREATE_ASK');
    assert.equal(ask.ask, true);
    assert.equal(ask.idle, true);
    assert.equal(ask.draftIntent, null);
  });
});

void describe('decideCreateCanvasAction', () => {
  void it('does not draft from garbage or greetings even if the classifier is noisy', () => {
    const garbage = decideCreateCanvasAction({
      userText: 'fdaas',
      canvasEmpty: true,
      marker: parseCreateChatAction('Should I draft this?'),
    });
    assert.equal(garbage.type, 'idle');

    const hi = decideCreateCanvasAction({
      userText: 'hi',
      canvasEmpty: true,
      marker: parseCreateChatAction('Hi — the canvas on the right is the agent.\nXYNE_CREATE_IDLE'),
    });
    assert.equal(hi.type, 'idle');
  });

  void it('keeps ask-only turns idle so Create is not gated', () => {
    const ask = decideCreateCanvasAction({
      userText: 'build something that either files Jira or Linear tickets',
      canvasEmpty: true,
      marker: parseCreateChatAction('Which tracker should it write to?\nXYNE_CREATE_ASK'),
    });
    assert.equal(ask.type, 'idle');
  });

  void it('drafts a thin job when the model emits XYNE_CREATE_DRAFT', () => {
    const action = decideCreateCanvasAction({
      userText: 'standup bot',
      canvasEmpty: true,
      marker: parseCreateChatAction(
        'Drafting a standup bot with reasonable defaults.\nXYNE_CREATE_DRAFT: standup bot',
      ),
    });
    assert.equal(action.type, 'draft');
    if (action.type === 'draft') {
      assert.equal(action.intent, 'standup bot');
      assert.deepEqual(action.fields, ['name', 'slug', 'description', 'systemPrompt']);
    }
  });

  void it('does not fill tools unless the user named them', () => {
    const unnamed = decideCreateCanvasAction({
      userText: 'I wanna do A',
      canvasEmpty: true,
      marker: parseCreateChatAction('Drafting an agent for A.\nXYNE_CREATE_DRAFT: I wanna do A'),
    });
    assert.equal(unnamed.type, 'draft');
    if (unnamed.type === 'draft') {
      assert.deepEqual(unnamed.fields, ['name', 'slug', 'description', 'systemPrompt']);
    }

    const named = decideCreateCanvasAction({
      userText: 'Build a standup scribe that posts a Slack summary every morning.',
      canvasEmpty: true,
      marker: parseCreateChatAction(
        'Filling the canvas.\nXYNE_CREATE_DRAFT: standup scribe that posts a Slack summary every morning',
      ),
    });
    assert.equal(named.type, 'draft');
    if (named.type === 'draft') {
      assert.deepEqual(named.fields, ['name', 'slug', 'description', 'systemPrompt', 'tools']);
    }
  });

  void it('leaves an empty-canvas job idle unless the model emits a draft marker', () => {
    const noMarker = decideCreateCanvasAction({
      userText: 'standup bot',
      canvasEmpty: true,
      marker: parseCreateChatAction('A standup bot that collects updates.'),
    });
    assert.equal(noMarker.type, 'idle');
  });

  void it('renames from a marker or a local rename without generate-prompt', () => {
    const marked = decideCreateCanvasAction({
      userText: 'call it Pulse',
      canvasEmpty: false,
      marker: parseCreateChatAction('Renamed.\nXYNE_CREATE_RENAME: Pulse Digest'),
    });
    assert.deepEqual(marked, { type: 'rename', name: 'Pulse Digest' });

    const local = decideCreateCanvasAction({
      userText: 'rename it Pulse Digest',
      canvasEmpty: false,
      marker: parseCreateChatAction('Done.'),
    });
    assert.deepEqual(local, { type: 'rename', name: 'Pulse Digest' });
  });

  void it('patches instructions on a filled canvas without a marker', () => {
    const action = decideCreateCanvasAction({
      userText: 'make the instructions shorter',
      canvasEmpty: false,
      marker: parseCreateChatAction('Tightening the instructions.'),
    });
    assert.equal(action.type, 'draft');
    if (action.type === 'draft') {
      assert.deepEqual(action.fields, ['systemPrompt']);
    }
  });

  void it('applies hub capability edits when the model ends with XYNE_CREATE_IDLE', () => {
    const action = decideCreateCanvasAction({
      userText: 'Add one useful MCP integration to the agent hub for standups.',
      canvasEmpty: false,
      marker: parseCreateChatAction('Added Slack MCP for standups.\nXYNE_CREATE_IDLE'),
    });
    assert.equal(action.type, 'draft');
    if (action.type === 'draft') {
      assert.deepEqual(action.fields, ['tools']);
    }
  });
});
