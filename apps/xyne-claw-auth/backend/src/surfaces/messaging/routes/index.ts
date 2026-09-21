/**
 * The messaging channels' HTTP boundary. Mounted by http/routes.ts at
 * /claw/api/v1/surfaces/:channel — one router for every channel; the
 * `:channel` param is resolved against the plugin registry per request.
 *
 * Auth split: the webhook ingress authenticates itself per plugin (no user
 * session — messengers POST there); the account routes are an admin API behind
 * a verified Spaces user session; /my-numbers is the same session with no admin
 * gate, because it only ever touches the caller's own identity rows.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireUserAuth } from "../../../middleware/require-auth.js";
import { accountsRouter } from "./accounts.js";
import { channelOf } from "./context.js";
import { numbersRouter } from "./numbers.js";
import { webhookRouter } from "./webhook.js";

export const messagingRouter = Router({ mergeParams: true });

messagingRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!channelOf(req)) {
    res.status(404).json({ success: false, error: "Unknown channel" });
    return;
  }
  next();
});
messagingRouter.use(webhookRouter);
messagingRouter.use(requireUserAuth, accountsRouter);
// Self-service, so no admin gate — every route is scoped to the caller.
messagingRouter.use(requireUserAuth, numbersRouter);
