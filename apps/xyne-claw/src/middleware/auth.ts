import { requireService } from "../service-assertion.js";

/**
 * Inbound auth for the runtime's routes: only claw-auth may call them, proven
 * by its signed, single-use service assertion (service-assertion.ts). There is
 * no shared key.
 */
export const requireClawAuthService = requireService("xyne-claw-auth");

/** Debug reads may also be forwarded from the runtime pod that doesn't own the session. */
export const requireClawAuthOrRuntime = requireService("xyne-claw-auth", "xyne-claw");
