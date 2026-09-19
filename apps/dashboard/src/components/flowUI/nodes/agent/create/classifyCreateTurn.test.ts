import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCreateTurn,
  parseLocalRename,
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

  void it('classifies a first describe as a full canvas edit', () => {
    const text = 'Build a standup scribe that posts a Slack summary every morning.';
    const result = classifyCreateTurn(text, true);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, ['name', 'slug', 'description', 'systemPrompt', 'tools']);
    assert.equal(shouldGeneratePrompt(result, true, text), true);
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
});
