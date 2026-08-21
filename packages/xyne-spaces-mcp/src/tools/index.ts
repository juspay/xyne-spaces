/**
 * The tool registry.
 *
 * Separate from `src/index.ts` so it can be imported without starting a server —
 * `scripts/check-operations.mjs` reads this list to verify every backend
 * operation the tools name is still there and still takes what they send.
 */

import type { ToolDef } from "./shared.js";
import { identityTools } from "./identity.js";
import { channelTools } from "./channels.js";
import { threadTools } from "./threads.js";
import { messageTools } from "./messages.js";
import { ticketTools } from "./tickets.js";
import { lookupTools } from "./lookups.js";
import { commsTools } from "./comms.js";
import { clawTools } from "./claw.js";

export const allTools: ToolDef[] = [...identityTools, ...channelTools, ...threadTools, ...messageTools, ...ticketTools, ...lookupTools, ...commsTools, ...clawTools];
