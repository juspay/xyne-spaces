import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createLogger } from "./logger.js";

const log = createLogger("llm");

type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

type StreamAgent = { streamFn: StreamFn };

let llmCallsInFlight = 0;

function isFirstContentEvent(event: AssistantMessageEvent): boolean {
  return event.type !== "start";
}

function eventOk(event: AssistantMessageEvent | undefined, result: AssistantMessage | undefined): boolean {
  if (event?.type === "error") return false;
  const stopReason = result?.stopReason;
  return stopReason !== "error" && stopReason !== "aborted";
}

function sanitize(v: string | number | boolean): string {
  return String(v).replace(/\s+/g, "_").slice(0, 120);
}

function metricLine(
  ttftMs: number,
  totalMs: number,
  provider: string,
  model: string,
  sessionId: string,
  ok: boolean,
  inflightAtStart: number,
): string {
  return [
    "[metric]",
    "name=llm_call",
    "kind=observe",
    `ttft_ms=${ttftMs}`,
    `total_ms=${totalMs}`,
    `provider=${sanitize(provider)}`,
    `model=${sanitize(model)}`,
    `session=${sanitize(sessionId)}`,
    `ok=${ok}`,
    `inflight=${inflightAtStart}`,
  ].join(" ");
}

function wrapStream(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  sessionId: string,
  startedAt: number,
  inflightAtStart: number,
): AssistantMessageEventStream {
  let firstContentAt: number | undefined;
  let lastTerminalEvent: AssistantMessageEvent | undefined;
  let settled = false;

  const settle = (result?: AssistantMessage): void => {
    if (settled) return;
    settled = true;
    const now = Date.now();
    const totalMs = now - startedAt;
    const ttftMs = (firstContentAt ?? now) - startedAt;
    const ok = eventOk(lastTerminalEvent, result);
    const provider = model.provider || "unknown";
    const modelId = model.id || model.name || "unknown";
    log.info(metricLine(ttftMs, totalMs, provider, modelId, sessionId, ok, inflightAtStart));
    if (ttftMs > 30_000) {
      log.warn(`[llm] slow-ttft ttft_ms=${ttftMs} provider=${sanitize(provider)} inflight=${inflightAtStart}`);
    }
    llmCallsInFlight = Math.max(0, llmCallsInFlight - 1);
  };

  const resultPromise = stream.result().then((result) => {
    settle(result);
    return result;
  });

  const wrapped = {
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
      try {
        for await (const event of stream) {
          if (firstContentAt === undefined && isFirstContentEvent(event)) {
            firstContentAt = Date.now();
          }
          if (event.type === "done" || event.type === "error") {
            lastTerminalEvent = event;
          }
          yield event;
          if (event.type === "done") {
            settle(event.message);
          } else if (event.type === "error") {
            settle(event.error);
          }
        }
      } catch (err) {
        settle();
        throw err;
      }
    },
    result(): Promise<AssistantMessage> {
      return resultPromise;
    },
  };

  return wrapped as AssistantMessageEventStream;
}

export function installLlmCallMetrics(agent: StreamAgent, sessionId: string): void {
  const baseStreamFn = agent.streamFn;
  agent.streamFn = (model, context, options) => {
    const startedAt = Date.now();
    llmCallsInFlight += 1;
    const inflightAtStart = llmCallsInFlight;
    const settleBeforeStream = (ok: boolean): void => {
      const totalMs = Date.now() - startedAt;
      const provider = model.provider || "unknown";
      const modelId = model.id || model.name || "unknown";
      log.info(metricLine(totalMs, totalMs, provider, modelId, sessionId, ok, inflightAtStart));
      if (totalMs > 30_000) {
        log.warn(`[llm] slow-ttft ttft_ms=${totalMs} provider=${sanitize(provider)} inflight=${inflightAtStart}`);
      }
      llmCallsInFlight = Math.max(0, llmCallsInFlight - 1);
    };
    try {
      const stream = baseStreamFn(model, context, options);
      return Promise.resolve(stream)
        .then((resolvedStream) => wrapStream(resolvedStream, model, sessionId, startedAt, inflightAtStart))
        .catch((err: unknown) => {
          settleBeforeStream(false);
          throw err;
        });
    } catch (err) {
      settleBeforeStream(false);
      throw err;
    }
  };
}
