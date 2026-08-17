/**
 * Claw Resource — remote agents.
 *
 * The fourth kind of operation in this SDK, alongside catalog reads, catalog
 * writes, and search. Claw runs on a separate service with a separate credential,
 * so it has its own login: see `core/claw-auth.ts`.
 */

import { Resource } from './base.js';
import { clawOperations, TERMINAL_RUN_STATUSES, toRun } from '../registry/claw.js';
import { newId } from '../core/ids.js';
import { NotFoundError, SdkError } from '../core/errors.js';
import type { ClawAuth, ClawLoginOptions } from '../core/claw-auth.js';
import type { Transport } from '../core/transport.js';
import type { Operation } from '../registry/types.js';
import type {
  ClawAgent,
  ClawLoginResult,
  ClawRun,
  ClawRunInput,
  ClawSession,
} from '../types/index.js';

export interface ClawRunAndWaitInput extends ClawRunInput {
  /** Give up waiting after this long. Default 5 minutes. */
  timeoutMs?: number;
  /** Called between polls, with the session id, so callers can show progress. */
  onProgress?: (sessionId: string) => void | Promise<void>;
  /** Abort the wait. The run itself keeps going server-side. */
  signal?: AbortSignal;
}

const DEFAULT_WAIT_MS = 300_000;
const MAX_POLL_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClawResource extends Resource {
  constructor(
    transport: Transport,
    private readonly auth: ClawAuth
  ) {
    super(transport);
  }

  /**
   * Every Claw call adopts a stored token first, so a client constructed with a
   * `clawTokenStore` works without an explicit login.
   */
  protected override async call<TArgs, TResult>(
    operation: Operation<TArgs, TResult>,
    args: TArgs
  ): Promise<TResult> {
    await this.auth.ensureToken();
    return super.call(operation, args);
  }

  // ----- Auth (separate from the Spaces login) -----

  /**
   * Log in to Claw with the device flow.
   *
   * This is **not** the Spaces login — Claw is a different service with its own
   * credential, so being authenticated for `sdk.users` says nothing about Claw.
   * The SDK cannot open a browser, so surface the prompt yourself.
   *
   * @example
   * await sdk.claw.login({
   *   onPrompt: ({ verifyUrl, userCode }) =>
   *     console.log(`Open ${verifyUrl} and enter ${userCode}`),
   * });
   */
  login(options?: ClawLoginOptions): Promise<ClawLoginResult> {
    return this.auth.login(options);
  }

  /** Forget the Claw token. Leaves the Spaces token untouched. */
  logout(): Promise<void> {
    return this.auth.logout();
  }

  /** Whether a Claw token is currently held. */
  async isLoggedIn(): Promise<boolean> {
    await this.auth.ensureToken();
    return this.auth.getToken() !== undefined;
  }

  // ----- Agents and sessions -----

  /**
   * List the agents this account can dispatch to.
   *
   * @returns Agents with the `slug` that `runAgent` takes
   *
   * @example
   * const agents = await sdk.claw.listAgents();
   */
  listAgents(): Promise<ClawAgent[]> {
    return this.call(clawOperations.listAgents, undefined);
  }

  /**
   * List recent runs, newest first.
   *
   * @param limit - How many to return (1–100, default 20)
   *
   * @example
   * const sessions = await sdk.claw.listSessions(50);
   */
  listSessions(limit = 20): Promise<ClawSession[]> {
    return this.call(clawOperations.listSessions, {
      limit: Math.max(1, Math.min(Math.floor(limit), 100)),
    });
  }

  /**
   * Fetch one run: a summary plus the full row (tool calls, timing, token usage).
   *
   * @example
   * const { run, detail } = await sdk.claw.getRun(sessionId);
   */
  async getRun(sessionId: string): Promise<{ run: ClawRun; detail: Record<string, unknown> }> {
    const detail = await this.call(clawOperations.getRun, { sessionId });
    return { run: toRun(sessionId, detail), detail };
  }

  // ----- Running agents -----

  /**
   * Dispatch a task and return as soon as the run is created.
   *
   * Poll it with `getRun`, or use `runAgentAndWait` to do that for you.
   *
   * Pass `channelId` (from `sdk.channels.list()`) to have the agent post its reply
   * into that Spaces thread, or `deliverTo: 'dm'` for the caller's own DM. That is
   * the one place Claw and Spaces meet.
   *
   * @example
   * const { sessionId } = await sdk.claw.runAgent({
   *   agent: 'ask-ai',
   *   task: 'Summarise yesterday in #deploys',
   * });
   */
  async runAgent(input: ClawRunInput): Promise<{ sessionId: string; conversationId: string }> {
    // Generated here rather than in mapArgs so the caller learns the value — it is
    // the key for continuing this thread in a later run.
    const conversationId = input.conversationId ?? `sdk-${newId()}`;
    const sessionId = await this.call(clawOperations.createRun, {
      agent: input.agent,
      task: input.task,
      conversationId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.deliverTo ? { deliverTo: input.deliverTo } : {}),
    });
    return { sessionId, conversationId };
  }

  /**
   * Dispatch a task and poll until it finishes.
   *
   * Backs off between polls up to 10s. On timeout the run is usually still going —
   * the error carries the session id so you can pick it up with `getRun`.
   *
   * @example
   * const { run } = await sdk.claw.runAgentAndWait({
   *   agent: 'ask-ai',
   *   task: 'Review PR 1174',
   *   timeoutMs: 600_000,
   * });
   * if (run.status === 'completed') console.log(run.result);
   */
  async runAgentAndWait(
    input: ClawRunAndWaitInput
  ): Promise<{ run: ClawRun; conversationId: string }> {
    const { sessionId, conversationId } = await this.runAgent(input);

    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_WAIT_MS);
    let pollMs = 2000;
    let sawRun = false;

    while (Date.now() < deadline) {
      if (input.signal?.aborted) {
        throw new SdkError('api_error', `Stopped waiting for Claw run ${sessionId}.`);
      }
      await sleep(pollMs);
      if (input.onProgress) await input.onProgress(sessionId);

      try {
        const { run } = await this.getRun(sessionId);
        sawRun = true;
        if (TERMINAL_RUN_STATUSES.includes(run.status.toLowerCase())) {
          return { run, conversationId };
        }
      } catch (err) {
        // The run row is written shortly after /run returns, so a 404 before the
        // first successful read is expected rather than an error.
        if (!(err instanceof NotFoundError) || sawRun) throw err;
      }

      pollMs = Math.min(Math.floor(pollMs * 1.5), MAX_POLL_MS);
    }

    throw new SdkError(
      'timeout',
      `Claw run ${sessionId} did not finish in time. It may still be running — ` +
        `check it with getRun('${sessionId}').`
    );
  }
}
