import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCreateTurn,
  detectIntakeGaps,
  isSkipIntake,
  parseLocalRename,
  planDescribe,
  shouldGeneratePrompt,
} from './classifyCreateTurn.ts';

void describe('classifyCreateTurn', () => {
  void it('treats greetings as reply-only', () => {
    const result = classifyCreateTurn('hi', true);
    assert.equal(result.kind, 'reply');
    assert.deepEqual(result.fields, []);
    assert.equal(shouldGeneratePrompt(result, true, 'hi'), false);
  });

  void it('never drafts from Q&A about instructions', () => {
    const result = classifyCreateTurn('what can I put in instructions?', true);
    assert.equal(result.kind, 'reply');
    assert.equal(shouldGeneratePrompt(result, true, 'what can I put in instructions?'), false);
  });

  void it('treats how-do-I MCP as reply, not a canvas edit', () => {
    const result = classifyCreateTurn('how do I add MCP?', false);
    assert.equal(result.kind, 'reply');
    assert.equal(shouldGeneratePrompt(result, false, 'how do I add MCP?'), false);
  });

  void it('asks follow-ups for a one-line agent request instead of drafting', () => {
    const result = classifyCreateTurn('make an agent', true);
    assert.equal(result.kind, 'intake');
    assert.equal(shouldGeneratePrompt(result, true, 'make an agent'), false);
    assert.equal(planDescribe('make an agent'), 'ask');
  });

  void it('asks follow-ups for a thin standup request', () => {
    const result = classifyCreateTurn('build a standup agent', true);
    assert.equal(result.kind, 'intake');
    assert.equal(shouldGeneratePrompt(result, true, 'build a standup agent'), false);
  });

  void it('classifies a first describe as a full canvas edit', () => {
    const text = 'Build a standup scribe that posts a Slack summary every morning.';
    const result = classifyCreateTurn(text, true);
    assert.equal(result.kind, 'edit');
    assert.equal(result.askAfter, true);
    assert.deepEqual(result.fields, ['name', 'slug', 'description', 'systemPrompt', 'tools']);
    assert.equal(shouldGeneratePrompt(result, true, text), true);
    assert.ok(detectIntakeGaps(text).includes('audience'));
  });

  void it('treats skip during intake as a canvas edit', () => {
    assert.equal(isSkipIntake('skip'), true);
    const result = classifyCreateTurn('skip', true, { intakePending: true });
    assert.equal(result.kind, 'edit');
    assert.equal(shouldGeneratePrompt(result, true, 'skip'), true);
  });

  void it('treats an intake answer as a canvas edit', () => {
    const answer = 'for the design team, 5 bullets in Slack, never mention private channels';
    const result = classifyCreateTurn(answer, true, { intakePending: true });
    assert.equal(result.kind, 'edit');
    assert.equal(shouldGeneratePrompt(result, true, answer), true);
  });

  void it('keeps follow-up handle Q&A as reply-only', () => {
    const result = classifyCreateTurn('why did you pick that handle?', false);
    assert.equal(result.kind, 'reply');
    assert.equal(shouldGeneratePrompt(result, false, 'why did you pick that handle?'), false);
  });

  void it('patches instructions only for a shorten follow-up', () => {
    const text = 'make the instructions shorter';
    const result = classifyCreateTurn(text, false);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, ['systemPrompt']);
    assert.equal(shouldGeneratePrompt(result, false, text), true);
  });

  void it('renames locally without generate-prompt', () => {
    const text = 'rename it Pulse Digest';
    assert.equal(parseLocalRename(text), 'Pulse Digest');
    const result = classifyCreateTurn(text, false);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, ['name', 'slug']);
    assert.equal(shouldGeneratePrompt(result, false, text), false);
  });

  void it('asks one clarifying question when the turn is ambiguous', () => {
    const result = classifyCreateTurn('maybe later', true);
    assert.equal(result.kind, 'clarify');
    assert.equal(shouldGeneratePrompt(result, true, 'maybe later'), false);
  });

  void it('does not draft from gibberish', () => {
    for (const text of ['fdaas', 'dasdsad', 'asdasdsa']) {
      const result = classifyCreateTurn(text, true);
      assert.equal(result.kind, 'clarify');
      assert.equal(shouldGeneratePrompt(result, true, text), false);
    }
  });
});
