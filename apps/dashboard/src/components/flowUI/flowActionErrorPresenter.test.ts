import { describe, expect, it } from 'vitest';
import { presentFlowActionError, presentThrownFlowActionError } from './flowActionErrorPresenter';

describe('presentFlowActionError (XYNE-66467)', () => {
  it('shows the server message for a typed error', () => {
    expect(
      presentFlowActionError({
        type: 'error',
        code: 'PERMISSION_DENIED',
        message: "You don't have edit access to this canvas.",
      } as never),
    ).toEqual({
      code: 'PERMISSION_DENIED',
      text: "You don't have edit access to this canvas.",
      retryable: false,
    });
  });

  it('never shows nested JSON or the old "App backend error N" wrapper', () => {
    const legacy = presentFlowActionError({
      message:
        '{"error":"App backend error 422","details":["{\\"type\\":\\"error\\",\\"code\\":\\"TOOL_EXECUTION_FAILED\\"}"]}',
    });
    expect(legacy.text).not.toMatch(/\{|App backend error/);
    expect(presentFlowActionError({ message: 'App backend error 502' }).text).not.toMatch(
      /App backend/,
    );
  });

  it('offers retry only for retryable codes', () => {
    expect(presentFlowActionError({ code: 'UPSTREAM_UNAVAILABLE', message: 'x' }).retryable).toBe(
      true,
    );
    expect(presentFlowActionError({ code: 'RATE_LIMITED', message: 'x' }).retryable).toBe(true);
    expect(presentFlowActionError({ code: 'PERMISSION_DENIED', message: 'x' }).retryable).toBe(
      false,
    );
    expect(presentFlowActionError({ code: 'TOOL_EXECUTION_FAILED', message: 'x' }).retryable).toBe(
      false,
    );
  });

  it("uses the card author's errorMessage only for unclassified errors", () => {
    expect(presentFlowActionError({ message: 'boom' }, 'Could not save').text).toBe(
      'Could not save',
    );
    expect(
      presentFlowActionError(
        { code: 'PERMISSION_DENIED', message: 'No edit access' },
        'Could not save',
      ).text,
    ).toBe('No edit access');
  });
});

describe('presentThrownFlowActionError', () => {
  it('reads the typed body the axios interceptor attaches as responseData', () => {
    const err = Object.assign(new Error('The app took too long to respond.'), {
      status: 504,
      responseData: {
        error: 'App backend timed out',
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'The app took too long to respond. It is safe to try again.',
        retryable: true,
      },
    });
    expect(presentThrownFlowActionError(err)).toEqual({
      code: 'UPSTREAM_UNAVAILABLE',
      text: 'The app took too long to respond. It is safe to try again.',
      retryable: true,
    });
  });

  it('treats a network error with no response as retryable', () => {
    expect(presentThrownFlowActionError(new Error('Network Error')).retryable).toBe(true);
  });
});
