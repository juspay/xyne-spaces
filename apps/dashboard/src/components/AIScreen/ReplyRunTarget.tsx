import type { ReactElement } from 'react';
import { Laptop, Server } from 'lucide-react';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';

const HARNESS_NAMES: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
  /* eslint-enable @typescript-eslint/naming-convention */
};

/** "Claude Code" for `claude-code` or `local-harness:claude-code`. */
export function harnessDisplayName(providerOrModelId: string | undefined): string {
  const provider = (providerOrModelId ?? '').replace(/^local-harness:/, '');
  return HARNESS_NAMES[provider] ?? (provider || 'your local harness');
}

export type ReplyRunTargetState =
  | { kind: 'device'; live: boolean; label: string }
  | { kind: 'server-fallback'; harness: string; reason: 'failed-over' | 'not-used' }
  | null;

/**
 * Where a reply ran, as the reader should hear it (XYNE-66324):
 * - on the user's device — claw-auth's `clawRunOrigin.kind === 'local-harness'`;
 * - on Xyne's servers although the device was expected — either claw-auth
 *   failed the device run over (`kind: 'server'` + `fallbackFrom`), or the run
 *   never went to the device (no device origin on a finished turn that was
 *   pinned to / auto-routed to a laptop harness).
 * Plain server runs that never involved a device say nothing.
 */
export function replyRunTargetState(
  message: Pick<
    Message,
    'type' | 'isStreaming' | 'errorInfo' | 'runOrigin' | 'expectedLocalHarness'
  >,
): ReplyRunTargetState {
  if (message.type !== 'bot') return null;
  const origin = message.runOrigin;
  if (origin?.kind === 'local-harness') {
    const name = origin.harnessName ?? harnessDisplayName(origin.provider);
    return { kind: 'device', live: !!message.isStreaming, label: origin.label?.trim() || name };
  }
  if (origin?.kind === 'server' && origin.fallbackFrom) {
    return {
      kind: 'server-fallback',
      harness: origin.fallbackFrom.harnessName ?? harnessDisplayName(origin.fallbackFrom.provider),
      reason: 'failed-over',
    };
  }
  if (message.expectedLocalHarness && !message.isStreaming && !message.errorInfo) {
    return {
      kind: 'server-fallback',
      harness: harnessDisplayName(message.expectedLocalHarness),
      reason: 'not-used',
    };
  }
  return null;
}

/** One quiet line under the agent byline saying where the reply ran. */
export function ReplyRunTarget({ message }: { message: Message }): ReactElement | null {
  const state = replyRunTargetState(message);
  if (!state) return null;

  if (state.kind === 'device') {
    return (
      <div
        data-testid='reply-run-target'
        data-run-target='device'
        className='flex items-center gap-1.5 text-xs text-muted-foreground'
      >
        <Laptop className='size-3.5 shrink-0' aria-hidden />
        <span className='truncate'>
          {state.live ? 'Running' : 'Ran'} on your device · {state.label}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid='reply-run-target'
      data-run-target='server'
      className='flex items-center gap-1.5 text-xs text-muted-foreground'
    >
      <Server className='size-3.5 shrink-0' aria-hidden />
      <span className='truncate'>
        {state.reason === 'failed-over'
          ? `Ran on Xyne's servers — ${state.harness} on your device didn't finish it`
          : `Ran on Xyne's servers, not on your device (${state.harness})`}
      </span>
    </div>
  );
}
