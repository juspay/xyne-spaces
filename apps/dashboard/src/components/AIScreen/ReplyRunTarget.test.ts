import { describe, expect, it } from 'vitest';
import { replyRunTargetState } from './ReplyRunTarget';

describe('replyRunTargetState (XYNE-66324)', () => {
  it('labels a device run', () => {
    expect(
      replyRunTargetState({
        type: 'bot',
        runOrigin: {
          kind: 'local-harness',
          provider: 'codex-cli',
          harnessName: 'Codex CLI',
          label: "Ann's Codex CLI",
        },
      }),
    ).toEqual({ kind: 'device', live: false, label: "Ann's Codex CLI" });
  });

  it('says when a dispatched device run failed over to the server', () => {
    expect(
      replyRunTargetState({
        type: 'bot',
        runOrigin: { kind: 'server', fallbackFrom: { provider: 'claude-code' } },
      }),
    ).toEqual({ kind: 'server-fallback', harness: 'Claude Code', reason: 'failed-over' });
  });

  it('says when a turn meant for the device ran on the server (no device online)', () => {
    expect(
      replyRunTargetState({ type: 'bot', expectedLocalHarness: 'local-harness:claude-code' }),
    ).toEqual({ kind: 'server-fallback', harness: 'Claude Code', reason: 'not-used' });
  });

  it('stays quiet while streaming, on errors, and for plain server runs', () => {
    expect(
      replyRunTargetState({
        type: 'bot',
        isStreaming: true,
        expectedLocalHarness: 'local-harness:claude-code',
      }),
    ).toBeNull();
    expect(
      replyRunTargetState({
        type: 'bot',
        expectedLocalHarness: 'local-harness:claude-code',
        errorInfo: { title: 'x', message: 'y' },
      }),
    ).toBeNull();
    expect(replyRunTargetState({ type: 'bot' })).toBeNull();
    expect(replyRunTargetState({ type: 'user' })).toBeNull();
  });
});
