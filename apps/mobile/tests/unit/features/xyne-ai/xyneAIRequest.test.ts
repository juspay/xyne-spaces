import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildStreamRequestBody } from '@/src/features/xyne-ai/api/xyneAIRequest';

describe('buildStreamRequestBody', () => {
  it('sends the same body as the web client for a standalone chat', () => {
    assert.deepEqual(buildStreamRequestBody({ query: 'hi', sessionId: 's1' }), {
      query: 'hi',
      channel_ids: [],
      conversation_id: '',
      session_id: 's1',
      web_search_enabled: false,
      deep_research_enabled: false,
      create_canvas_enabled: false,
      instant: false,
      research_context: null,
      version: 'v2',
    });
  });

  it('adds the selected agent, model and thinking level under the web client keys', () => {
    const body = buildStreamRequestBody({
      query: 'hi',
      sessionId: '',
      agentSlug: 'research',
      model: 'claude-sonnet-4-20250514',
      modelProvider: 'litellm',
      thinkingLevel: 'high',
      instant: true,
    });
    assert.equal(body['agentSlug'], 'research');
    assert.equal(body['model'], 'claude-sonnet-4-20250514');
    assert.equal(body['modelProvider'], 'litellm');
    assert.equal(body['thinkingLevel'], 'high');
    assert.equal(body['instant'], true);
  });

  it('leaves out the provider when no model is picked', () => {
    const body = buildStreamRequestBody({ query: 'hi', sessionId: '', modelProvider: 'litellm' });
    assert.equal('model' in body, false);
    assert.equal('modelProvider' in body, false);
    assert.equal('agentSlug' in body, false);
    assert.equal('thinkingLevel' in body, false);
  });

  it('sends the search modes and the regenerate branch under the web client keys', () => {
    const body = buildStreamRequestBody({
      query: 'hi',
      sessionId: '',
      webSearchEnabled: true,
      deepResearchEnabled: true,
      parentMessageId: 'u1',
      isRegenerate: true,
    });
    assert.equal(body['web_search_enabled'], true);
    assert.equal(body['deep_research_enabled'], true);
    assert.equal(body['parent_message_id'], 'u1');
    assert.equal(body['is_regenerate'], true);
  });

  it('sends picked context as ids per kind plus the attached context, like the web client', () => {
    const attachedContext = [
      { type: 'channel', id: 'c1', title: 'general' },
      { type: 'ticket', id: 't1', title: 'Bug', metadata: { xyneId: 'XYS-9' } },
      { type: 'canvas', id: 'k1', title: 'Plan' },
      { type: 'call', id: 'r1', title: 'Standup', threadId: 'conv1' },
      { type: 'user', id: 'u1', title: 'Sam' },
    ];
    const body = buildStreamRequestBody({ query: 'hi', sessionId: '', attachedContext });
    assert.deepEqual(body['channel_ids'], ['c1']);
    assert.deepEqual(body['ticket_ids'], ['t1']);
    assert.deepEqual(body['canvas_ids'], ['k1']);
    assert.deepEqual(body['call_ids'], ['r1']);
    assert.deepEqual(body['attached_context'], attachedContext);
  });

  it('leaves the context keys out when nothing is picked', () => {
    const body = buildStreamRequestBody({ query: 'hi', sessionId: '', attachedContext: [] });
    assert.equal('attached_context' in body, false);
    assert.equal('ticket_ids' in body, false);
  });
});
