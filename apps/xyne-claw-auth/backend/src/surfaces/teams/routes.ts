/**
 * Tenant binding for a Teams account's org: which Microsoft tenants it
 * answers. Lives on the account routes (/surfaces/teams/accounts/:id/tenants)
 * so it shares their gate — an admin of the account's org, or a platform
 * admin — but a binding belongs to the org, not to the one account it was
 * made through.
 *
 *   GET    /accounts/:id/tenants             the org's bound tenants
 *   POST   /accounts/:id/tenants             { tenantId } → bind
 *   DELETE /accounts/:id/tenants/:tenantId   unbind, and drop its Teams links
 *
 * Mounted for every channel by the messaging router; anything but Teams gets
 * the same 404 as an unknown account.
 */
import { Router, type Request, type Response } from "express";
import { createLogger } from "../../logger.js";
import { resolveAccountRequest } from "../messaging/routes/context.js";
import { toChannelAccount } from "../messaging/store.js";
import { guidSchema } from "./schema.js";
import { bindTenant, listTenantBindings, unbindTenant } from "./tenants.js";
import type { TeamsTenantBinding } from "@prisma/client";

const log = createLogger("teams-tenants-api");
export const teamsTenantsRouter = Router({ mergeParams: true });

function tenantView(row: TeamsTenantBinding) {
  return { tenantId: row.tenantId, boundByUserId: row.boundByUserId, createdAt: row.createdAt };
}

async function resolveTeamsAccount(req: Request, res: Response) {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return null;
  }
  if (resolved.plugin.key !== "teams") {
    res.status(404).json({ success: false, error: "Account not found" });
    return null;
  }
  return { userId: resolved.userId, account: toChannelAccount(resolved.account) };
}

teamsTenantsRouter.get("/accounts/:id/tenants", async (req: Request, res: Response) => {
  const resolved = await resolveTeamsAccount(req, res);
  if (!resolved) return;
  const rows = await listTenantBindings(resolved.account.orgId);
  res.json({ success: true, tenants: rows.map(tenantView) });
});

teamsTenantsRouter.post("/accounts/:id/tenants", async (req: Request, res: Response) => {
  const resolved = await resolveTeamsAccount(req, res);
  if (!resolved) return;
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const tenantId = guidSchema.safeParse(body["tenantId"]);
  if (!tenantId.success) {
    res.status(400).json({ success: false, error: "tenantId must be a Microsoft tenant GUID" });
    return;
  }
  const outcome = await bindTenant({ tenantId: tenantId.data, orgId: resolved.account.orgId, userId: resolved.userId });
  if (!outcome.ok) {
    // Does not say which org: that is the other org's business.
    res.status(409).json({ success: false, error: "That Microsoft tenant is already connected to another organization." });
    return;
  }
  if (outcome.created) {
    log.info(`[teams] tenant bound org=${resolved.account.orgId} tenant=${tenantId.data} by=${resolved.userId}`);
  }
  res.status(outcome.created ? 201 : 200).json({ success: true, tenant: tenantView(outcome.binding) });
});

teamsTenantsRouter.delete("/accounts/:id/tenants/:tenantId", async (req: Request, res: Response) => {
  const resolved = await resolveTeamsAccount(req, res);
  if (!resolved) return;
  const tenantId = guidSchema.safeParse(req.params["tenantId"]);
  if (!tenantId.success) {
    res.status(400).json({ success: false, error: "tenantId must be a Microsoft tenant GUID" });
    return;
  }
  const result = await unbindTenant({ tenantId: tenantId.data, orgId: resolved.account.orgId, userId: resolved.userId });
  log.info(
    `[teams] tenant unbound org=${resolved.account.orgId} tenant=${tenantId.data} by=${resolved.userId} unlinked=${result.unlinked}`,
  );
  res.json({ success: true, removed: result.removed, unlinked: result.unlinked });
});
