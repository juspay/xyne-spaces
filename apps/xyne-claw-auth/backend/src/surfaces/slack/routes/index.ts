/**
 * The Slack surface's HTTP boundary, assembled. Mounted by main.ts at
 * /claw/api/v1/surfaces/slack — URLs are unchanged from the pre-split
 * routes/surfaces-slack.ts monolith (split 2026-07-22, refactor session 2).
 */
import { Router } from "express";
import { appsRouter } from "./apps.js";
import { commandsRouter } from "./commands.js";
import { eventsRouter } from "./events.js";
import { oauthRouter } from "./oauth.js";

export const slackRouter = Router();
slackRouter.use(oauthRouter);
slackRouter.use(appsRouter);
slackRouter.use(commandsRouter);
slackRouter.use(eventsRouter);
