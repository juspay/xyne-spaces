/**
 * The design system a run inherits, resolved once and handed to the runtime.
 *
 * Shared by both dispatch paths deliberately. `run-stream.ts` does not import
 * start-run.ts, so wiring one and not the other would apply a user's design
 * system in threads and ignore it on /ai — the same split that bit XYNE-66810.
 */

import { designSystemRepository } from "../repositories/index.js";
import { errMsg } from "./errors.js";

import { createLogger } from "../logger.js";
const log = createLogger("design-system-context");

/** Shape handed to xyne-claw on `agentConfig.designSystemRef`. */
export interface DesignSystemRef {
  id: string | null;
  name: string;
  designMd: string;
  tokensCss: string;
  tokensCssDark: string;
  origin: string;
}

interface AgentLike {
  orgId: string;
  config: unknown;
}

/**
 * Resolve the system for this run, or null.
 *
 * Order lives in designSystemRepository.resolveForAgent: a conversation's own
 * pin beats the agent default, which beats the pre-migration config text.
 *
 * Never throws. This is a DB read on the dispatch path, and a blip must not
 * stop someone's run — a failure degrades to null, which leaves the runtime on
 * the legacy `agentConfig.designSystem` text exactly as before.
 */
export async function resolveDesignSystemRef(
  agent: AgentLike,
  conversationId?: string | null,
): Promise<DesignSystemRef | null> {
  try {
    const resolvedSystem = await designSystemRepository.resolveForAgent(
      agent as Parameters<typeof designSystemRepository.resolveForAgent>[0],
      conversationId ?? null,
    );
    if (!resolvedSystem) return null;

    const ref: DesignSystemRef = {
      id: resolvedSystem.id,
      name: resolvedSystem.name,
      designMd: resolvedSystem.designMd,
      tokensCss: resolvedSystem.tokensCss,
      tokensCssDark: resolvedSystem.tokensCssDark,
      origin: resolvedSystem.origin,
    };
    log.info(
      `[design-system] resolved origin=${ref.origin} id=${ref.id ?? "legacy"} chars=${ref.designMd.length}` +
        ` themes=${ref.tokensCssDark ? "light+dark" : "light"}`,
    );
    return ref;
  } catch (err) {
    log.warn(`[design-system] resolve failed, run continues without it: ${errMsg(err)}`);
    return null;
  }
}
