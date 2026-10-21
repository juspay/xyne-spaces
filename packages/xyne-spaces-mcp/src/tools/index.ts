/**
 * The tool registry.
 *
 * Separate from `src/index.ts` so it can be imported without starting a server.
 */

import type { ToolDef } from "./shared.js";
import { loginTools } from "./login.js";
import { identityTools } from "./identity.js";
import { channelTools } from "./channels.js";
import { threadTools } from "./threads.js";
import { messageTools } from "./messages.js";
import { ticketTools } from "./tickets.js";
import { lookupTools } from "./lookups.js";
import { commsTools } from "./comms.js";
import { clawTools } from "./claw.js";

export const allTools: ToolDef[] = [...loginTools, ...identityTools, ...channelTools, ...threadTools, ...messageTools, ...ticketTools, ...lookupTools, ...commsTools, ...clawTools];
