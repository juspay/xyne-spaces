/**
 * Claw Resource
 *
 * Remote agents, reached through Spaces. There is no separate Claw login: the
 * Spaces backend relays these calls using its own service credential, so the
 * client's API key is the only credential involved.
 */

import { Resource } from './base.js';
import { clawOperations, TERMINAL_RUN_STATUSES } from '../registry/claw.js';
import { SdkError } from '../core/errors.js';
import type { ClawAgent, ClawRun, ClawRunInput } from '../types/index.js';

export interface ClawRunAndWaitInput extends ClawRunInput {
  /** Give up after this long. Default 5 minutes. */
  timeoutMs?: number;
  /** Called after each poll, while the run is still in flight. */
  onProgress?: (run: ClawRun) => void | Promise<void>;
  /** Abort waiting. The run itself keeps going. */
  signal?: AbortSignal;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClawResource extends Resource {
  /**
   * List the agents this deployment can run.
   *
   * @example
   * const agents = await sdk.claw.listAgents();
   * const slug = agents[0].slug;
   */
  listAgents(): Promise<ClawAgent[]> {
    return this.call(clawOperations.listAgents, undefined as void);
  }

  /**
   * Dispatch an agent and return as soon as it is queued.
   *
   * Passing `channelId` also posts the agent's reply into that Spaces thread —
   * the one place the two services meet.
   *
   * @example
   * const { sessionId } = await sdk.claw.run({ agent: 'ask-ai', task: 'Summarise today' });
   */
  run(input: ClawRunInput): Promise<{ sessionId: string }> {
    return this.call(clawOperations.run, input);
  }

  /**
   * Read a run's current state, including its result once it has finished.
   *
   * @throws {NotFoundError} if the session id is unknown
   */
  getRun(sessionId: string): Promise<ClawRun> {
    return this.call(clawOperations.getRun, { sessionId });
  }

  /**
   * Dispatch an agent and poll until it finishes.
   *
   * Backs off gently — a run takes tens of seconds at best, so polling hard buys
   * nothing. A timeout stops the waiting, not the run: the `sessionId` in the
   * error message can still be passed to {@link getRun}.
   *
   * @example
   * const run = await sdk.claw.runAndWait({ agent: 'ask-ai', task: 'Summarise today' });
   * console.log(run.status, run.result);
   */
  async runAndWait(input: ClawRunAndWaitInput): Promise<ClawRun> {
    const { timeoutMs = 300_000, onProgress, signal, ...runInput } = input;
    const { sessionId } = await this.run(runInput);

    const deadline = Date.now() + timeoutMs;
    let intervalMs = 1_000;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new SdkError('api_error', `Stopped waiting for Claw run ${sessionId}.`);
      }
      await sleep(intervalMs);
      intervalMs = Math.min(intervalMs * 1.5, 10_000);

      const run = await this.getRun(sessionId);
      if (TERMINAL_RUN_STATUSES.includes(run.status)) return run;
      if (onProgress) await onProgress(run);
    }

    throw new SdkError(
      'timeout',
      `Claw run ${sessionId} did not finish within ${timeoutMs}ms. It may still be running; poll getRun("${sessionId}").`,
    );
  }
}
