import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("model-fallback");

type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

type StreamAgent = { streamFn: StreamFn };

export interface StreamModelFallbackOptions {
  label: string;
  onFallback?: (reason: string) => void;
}

function errorText(event: Extract<AssistantMessageEvent, { type: "error" }>): string {
  return event.error.errorMessage ?? "provider error";
}

function errorMessage(model: Model<Api>, message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
}

export function installStreamModelFallback(
  agent: StreamAgent,
  primary: Model<Api>,
  fallback: Model<Api>,
  opts: StreamModelFallbackOptions,
): void {
  const base = agent.streamFn;
  let degraded = false;

  const switchToFallback = (reason: string): void => {
    if (degraded) return;
    degraded = true;
    log.warn(`[${opts.label}] ${primary.id} failed before output (${reason.slice(0, 200)}) — falling back to ${fallback.id} for the rest of this session`);
    metric.count("subagent_model_fallback", { from: primary.id, to: fallback.id });
    opts.onFallback?.(reason);
  };

  agent.streamFn = (model, context, options) => {
    if (model.id !== primary.id || model.provider !== primary.provider) {
      return base(model, context, options);
    }
    if (degraded) return base(fallback, context, options);

    const out = createAssistantMessageEventStream();

    const drain = async (iterator: AsyncIterator<AssistantMessageEvent>): Promise<void> => {
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) out.push(next.value);
    };

    const tryPrimary = async (): Promise<string | null> => {
      const held: AssistantMessageEvent[] = [];
      try {
        const iterator = (await base(model, context, options))[Symbol.asyncIterator]();
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
          const event = next.value;
          if (event.type === "start") {
            held.push(event);
            continue;
          }
          if (event.type === "error" && event.reason === "error" && !options?.signal?.aborted) {
            return errorText(event);
          }
          for (const h of held) out.push(h);
          out.push(event);
          await drain(iterator);
          return null;
        }
        for (const h of held) out.push(h);
        return null;
      } catch (err) {
        if (options?.signal?.aborted) return null;
        return err instanceof Error ? err.message : String(err);
      }
    };

    void (async () => {
      const failure = await tryPrimary();
      if (failure !== null) {
        switchToFallback(failure);
        await drain((await base(fallback, context, options))[Symbol.asyncIterator]());
      }
    })()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[${opts.label}] fallback stream failed: ${message}`);
        out.push({ type: "error", reason: "error", error: errorMessage(fallback, message) });
      })
      .finally(() => out.end());

    return out;
  };
}
