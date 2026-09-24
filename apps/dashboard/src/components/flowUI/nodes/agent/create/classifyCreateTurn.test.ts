import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyCreateTurn,
  firstDraftFields,
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

  void it('allows hub MCP adds on a filled canvas without regenning instructions', () => {
    const text = 'Add one useful MCP integration to the agent hub for standups.';
    const result = classifyCreateTurn(text, false);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, ['tools']);
    assert.equal(shouldGeneratePrompt(result, false, text), true);
  });

  void it('asks (does not draft) for vague make-an-agent', () => {
    const result = classifyCreateTurn('make an agent', true);
    assert.equal(result.kind, 'clarify');
    assert.deepEqual(result.fields, []);
    assert.equal(shouldGeneratePrompt(result, true, 'make an agent'), false);
  });

  void it('asks for create a bot with no job', () => {
    const result = classifyCreateTurn('create a bot', true);
    assert.equal(result.kind, 'clarify');
  });

  void it('infers tools for a thin standup job (channel/standup cue)', () => {
    const result = classifyCreateTurn('build a standup agent', true);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, [
      'name',
      'slug',
      'description',
      'systemPrompt',
      'tools',
    ]);
    assert.equal(shouldGeneratePrompt(result, true, 'build a standup agent'), true);
    assert.deepEqual(firstDraftFields('standup bot'), [
      'name',
      'slug',
      'description',
      'systemPrompt',
      'tools',
    ]);
  });

  void it('adds tools when the request implies email / X.com capabilities', () => {
    const text =
      'Build an agent that posts to X.com and sends a daily email digest of mentions.';
    assert.deepEqual(firstDraftFields(text), [
      'name',
      'slug',
      'description',
      'systemPrompt',
      'tools',
    ]);
    const result = classifyCreateTurn(text, true);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, [
      'name',
      'slug',
      'description',
      'systemPrompt',
      'tools',
    ]);
  });

  void it('keeps vague make-a-bot as clarify (no draft)', () => {
    const result = classifyCreateTurn('make a bot', true);
    assert.equal(result.kind, 'clarify');
  });

  void it('adds tools when the job names Slack (or soft-cues it)', () => {
    const text = 'Build a standup scribe that posts a Slack summary every morning.';
    const result = classifyCreateTurn(text, true);
    assert.equal(result.kind, 'edit');
    assert.deepEqual(result.fields, ['name', 'slug', 'description', 'systemPrompt', 'tools']);
    assert.equal(shouldGeneratePrompt(result, true, text), true);
  });

  void it('infers tools + knowledge from job semantics without MCP nouns', () => {
    const text =
      'Create a scribe that posts daily summaries to the eng channel, emails the lead, and researches competitors on the web using our product docs.';
    const fields = firstDraftFields(text);
    assert.ok(fields.includes('tools'), JSON.stringify(fields));
    assert.ok(fields.includes('knowledge'), JSON.stringify(fields));
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

  void it('maps choose/use/pick MCP follow-ups to tools, not instructions', () => {
    for (const text of [
      'choose Slack MCP',
      'use the GitHub MCP',
      'pick Slack for standups',
      'add the GitHub MCP',
    ]) {
      const result = classifyCreateTurn(text, false);
      assert.equal(result.kind, 'edit', text);
      assert.ok(result.fields.includes('tools'), text);
      assert.equal(result.fields.includes('systemPrompt'), false, text);
    }
  });
});
