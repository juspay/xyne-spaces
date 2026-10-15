import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getAskAIErrorInfo, getTransportErrorInfo } from '@/src/features/xyne-ai/model/askAIError';

describe('getAskAIErrorInfo', () => {
  it('maps a known HTTP status', () => {
    assert.equal(getAskAIErrorInfo('slow down', 429).title, 'Rate limit reached');
  });

  it('describes an unmapped status', () => {
    const unavailable = getAskAIErrorInfo(undefined, 507);
    assert.equal(unavailable.title, 'Request failed');
    assert.match(unavailable.message, /HTTP 507/);
  });

  it('reads the status out of the provider error text', () => {
    assert.equal(
      getAskAIErrorInfo('litellm error {"code":"429"}', undefined).title,
      'Rate limit reached',
    );
    assert.equal(
      getAskAIErrorInfo('Upstream failed [503]', undefined).title,
      'Model service unavailable',
    );
    assert.equal(
      getAskAIErrorInfo('{"type":"auth_error"}', undefined).title,
      'Authentication failed',
    );
  });

  it('keeps the advice and the backend text for the technical details', () => {
    const error = getAskAIErrorInfo('litellm 429 slow', 429);
    assert.match(error.helpText ?? '', /Wait a moment/);
    assert.equal(error.rawError, 'litellm 429 slow');
    assert.equal(getAskAIErrorInfo(undefined, 429).rawError, undefined);
  });

  it('ignores a status outside the HTTP range', () => {
    assert.equal(getAskAIErrorInfo('BudgetExceededError', 0).title, 'Usage limit reached');
  });

  it('summarises a context limit with token counts', () => {
    const error = getAskAIErrorInfo(
      'context length is only 8000 — you passed 12000 input tokens',
      undefined,
    );
    assert.equal(error.title, 'Context too large');
    assert.match(error.message, /about 12,000 input tokens.*up to 8/);
  });

  it('matches error classes by keyword, most specific first', () => {
    assert.equal(
      getAskAIErrorInfo('litellm.ContextWindowExceededError', undefined).title,
      'Context too large',
    );
    assert.equal(
      getAskAIErrorInfo('ReadTimeout while streaming', undefined).title,
      'Request timed out',
    );
    assert.equal(
      getAskAIErrorInfo('TypeError: x is undefined', undefined).title,
      'Internal processing error',
    );
    assert.equal(
      getAskAIErrorInfo('SomeException', undefined).title,
      "Ask AI couldn't complete this request",
    );
    assert.equal(getAskAIErrorInfo('fetch failed', undefined).title, 'Network error');
  });

  it('falls back to the raw text, or a generic message when there is none', () => {
    assert.equal(getAskAIErrorInfo('Weird failure', undefined).message, 'Weird failure');
    assert.equal(
      getAskAIErrorInfo(undefined, undefined).message,
      'Something went wrong while generating a response.',
    );
  });
});

describe('getTransportErrorInfo', () => {
  it('tells the user their own session expired on 401', () => {
    assert.equal(getTransportErrorInfo(401).message, 'Your session expired. Sign in again.');
  });

  it('reports an unreachable server when there was no response', () => {
    assert.equal(
      getTransportErrorInfo(undefined).message,
      "Can't reach Xyne. Check your connection.",
    );
  });

  it('uses the status table for other failures', () => {
    assert.equal(getTransportErrorInfo(429).title, 'Rate limit reached');
  });
});
