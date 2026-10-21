import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";
import {
  allTerminal,
  claimEvalFinalize,
  clearEvalState,
  listPendingEvals,
  readEvalResults,
} from "../lib/eval-run.js";
import { finalizeEval } from "../lib/webhook-commands/eval.js";

const log = createLogger("eval-sweeper");

const SWEEP_MS = Math.max(5_000, Number(process.env["EVAL_SWEEP_MS"]) || 15_000);

let timer: NodeJS.Timeout | undefined;
let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const pending = await listPendingEvals();
    for (const state of pending) {
      const results = await readEvalResults(state.dispatches).catch(() => null);
      if (!results) continue;
      const expired = Date.now() > Date.parse(state.deadlineAt);
      if (!allTerminal(results) && !expired) continue;
      if (!(await claimEvalFinalize(state.id))) continue;
      try {
        await finalizeEval(state, log);
      } catch (err) {
        log.warn(`[eval-sweeper] finalize failed for ${state.id}: ${errMsg(err)}`);
      }
      await clearEvalState(state.id);
    }
  } catch (err) {
    log.warn(`[eval-sweeper] sweep failed: ${errMsg(err)}`);
  } finally {
    sweeping = false;
  }
}

export function initEvalSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref();
  log.info("[eval-sweeper] Worker started");
}

export async function closeEvalSweeper(): Promise<void> {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
