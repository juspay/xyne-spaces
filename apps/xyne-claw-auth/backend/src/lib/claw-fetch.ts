import { CONFIG } from "../config.js";
import { streamDispatcher } from "./consume-claw-stream.js";
import { createLogger } from "../logger.js";

const log = createLogger("run");

const RUN_RETRY_DELAY_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function collectErrorCodes(err: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (typeof value === "object") {
      const maybe = value as { code?: unknown; cause?: unknown; errors?: unknown };
      if (typeof maybe.code === "string") codes.push(maybe.code);
      visit(maybe.cause);
      if (Array.isArray(maybe.errors)) {
        for (const child of maybe.errors) visit(child);
      }
    }
  };
  visit(err);
  return codes;
}

function isConnectionRefusedClassError(err: unknown): boolean {
  const codes = collectErrorCodes(err);
  return codes.includes("ECONNREFUSED") || codes.includes("EAI_AGAIN");
}

export async function fetchClawRunWithRetry(init: RequestInit, label: string): Promise<globalThis.Response> {
  let retried = false;
  for (;;) {
    try {
      const response = await fetch(`${CONFIG.xyneClawUrl}/run`, {
        ...init,
        // `dispatcher` is an undici extension not in the DOM RequestInit type.
        dispatcher: streamDispatcher,
      } as unknown as RequestInit);
      if (response.status === 503 && !retried) {
        retried = true;
        log.warn(`[run] proxy: retrying claw /run once after 503 (${label})`);
        await sleep(RUN_RETRY_DELAY_MS);
        continue;
      }
      return response;
    } catch (err) {
      if (!retried && isConnectionRefusedClassError(err)) {
        retried = true;
        log.warn(
          `[run] proxy: retrying claw /run once after ${collectErrorCodes(err).join(",") || "connection refusal"} (${label})`,
        );
        await sleep(RUN_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}
