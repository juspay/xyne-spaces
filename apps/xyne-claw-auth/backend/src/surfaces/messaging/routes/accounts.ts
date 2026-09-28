/**
 * Account lifecycle for a messaging channel: create/list/update/delete,
 * login/logout, the login artifact (QR) and a status readback. Generic over
 * the channel — the plugin only contributes capabilities, the login kind and
 * its residue schema.
 */
import { Router, type Request, type Response } from "express";
import QRCode from "qrcode";
import { CONFIG } from "../../../config.js";
import { errMsg } from "../../../lib/errors.js";
import { createLogger } from "../../../logger.js";
import { prisma } from "../../../db.js";
import { accountManager, getLoginArtifact } from "../account-manager.js";
import { leaseHolder, publishControl } from "../placement.js";
import { type AnyChannelPlugin } from "../plugin.js";
import {
  createAccountBodySchema,
  loginBodySchema,
  parseAccountConfig,
  updateAccountBodySchema,
  type AccountConfig,
} from "../schema.js";
import {
  bindDefaultAgent,
  createAccount,
  findDefaultAgent,
  findOrgAgentBySlug,
  getSurface,
  listOrgAccounts,
  listOwnedAccounts,
  authStateFor,
  setAccountStatus,
  toChannelAccount,
  unlinkIdentity,
  updateAccountConfig,
  type AccountRow,
} from "../store.js";
import { channelOf, resolveAccountAuthor, resolveAccountRequest } from "./context.js";

const log = createLogger("channel-accounts-api");
export const accountsRouter = Router({ mergeParams: true });
const router = accountsRouter;

function validateChannelResidue(plugin: AnyChannelPlugin, residue: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!plugin.channelConfigSchema) return { ok: true, value: residue ?? undefined };
  const parsed = plugin.channelConfigSchema.safeParse(residue ?? {});
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
}

async function accountView(row: AccountRow, plugin: AnyChannelPlugin) {
  const account = toChannelAccount(row);
  const [bound, holder] = await Promise.all([findDefaultAgent(account, account.surfaceId), leaseHolder(account.id)]);
  const { channel: residue, ...core } = account.config;
  return {
    id: account.id,
    accountKey: account.accountKey,
    channel: account.channel,
    orgId: account.orgId,
    ...core,
    channelConfig: residue ?? null,
    agent: bound ? { slug: bound.agent.slug, name: bound.agent.name } : null,
    login: plugin.login,
    scope: plugin.accountScope,
    ownerUserId: account.config.ownerUserId ?? null,
    loginFields: plugin.loginFields ?? [],
    transport: plugin.transport,
    // Webhook channels need this URL pasted into the provider's console. In
    // local dev CONFIG.selfUrl is localhost, so the path is exposed too and
    // the admin prefixes their own public origin (a tunnel).
    ...(plugin.transport === "webhook"
      ? {
          webhookPath: `/claw/api/v1/surfaces/${account.channel}/webhook/${account.id}`,
          webhookUrl: `${CONFIG.selfUrl}/claw/api/v1/surfaces/${account.channel}/webhook/${account.id}`,
        }
      : {}),
    capabilities: plugin.capabilities,
    leaseHolder: holder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get("/accounts", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  if (!plugin) {
    res.status(404).json({ success: false, error: "Unknown channel" });
    return;
  }
  const caller = await resolveAccountAuthor(req, plugin);
  if (!caller.ok) {
    res.status(caller.status).json({ success: false, error: caller.error });
    return;
  }
  const rows = caller.isAdmin
    ? await listOrgAccounts(plugin.key, caller.orgId)
    : await listOwnedAccounts(plugin.key, caller.orgId, caller.userId);
  res.json({ success: true, accounts: await Promise.all(rows.map((row) => accountView(row, plugin))) });
});

router.post("/accounts", async (req: Request, res: Response) => {
  const plugin = channelOf(req);
  if (!plugin) {
    res.status(404).json({ success: false, error: "Unknown channel" });
    return;
  }
  const caller = await resolveAccountAuthor(req, plugin);
  if (!caller.ok) {
    res.status(caller.status).json({ success: false, error: caller.error });
    return;
  }
  const body = createAccountBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.message });
    return;
  }
  const surface = await getSurface(plugin.key);
  if (!surface || surface.status !== "ACTIVE") {
    res.status(500).json({ success: false, error: `Surface "${plugin.key}" is not seeded` });
    return;
  }
  const agent = await findOrgAgentBySlug(body.data.agentSlug, caller.orgId);
  if (!agent) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }
  const residue = validateChannelResidue(plugin, body.data.channel);
  if (!residue.ok) {
    res.status(400).json({ success: false, error: residue.error });
    return;
  }
  const config: AccountConfig = parseAccountConfig({
    label: body.data.label ?? agent.name,
    createdByUserId: caller.userId,
    // On a user-scoped channel this records whose number it is, which is what
    // the owner's own "You" chat dispatches against. It is never used for
    // anybody else's messages.
    ...(plugin.accountScope === "user"
      ? {
          ownerUserId: caller.userId,
          // A personal number answers in groups only for now: a linked device
          // sees every DM the person receives, and answering those means
          // sending messages from them that they did not write. And there it
          // waits to be addressed, since not every line in a chat someone owns
          // is a request.
          dmPolicy: "disabled" as const,
          requireMention: true,
        }
      : {
          // A shared business number is the opposite: every message sent to it
          // was deliberately sent to a service, so a plain "what's my leave
          // balance?" is the normal case and demanding "/agent" in front of it
          // would be friction for no gain.
          requireMention: false,
        }),
    desiredState: "stopped",
    connState: "disconnected",
    ...(residue.value !== undefined ? { channel: residue.value } : {}),
  });
  const row = await createAccount({ orgId: caller.orgId, surfaceId: surface.id, agentId: agent.id, config });
  log.info(
    `[channels] account created id=${row.id} channel=${plugin.key} scope=${plugin.accountScope} org=${caller.orgId} by=${caller.userId}`,
  );
  res.status(201).json({ success: true, account: await accountView(row, plugin) });
});

router.get("/accounts/:id", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  res.json({ success: true, account: await accountView(resolved.account, resolved.plugin) });
});

router.patch("/accounts/:id", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const body = updateAccountBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.message });
    return;
  }
  const { orgId: _orgId, agentSlug, channel, ...policyPatch } = body.data;
  const account = toChannelAccount(resolved.account);

  if (agentSlug) {
    const agent = await findOrgAgentBySlug(agentSlug, account.orgId);
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    await bindDefaultAgent({ surfaceId: account.surfaceId, accountKey: account.accountKey, agentId: agent.id });
    await publishControl({ op: "rebind", accountId: account.id });
  }
  const patch: Record<string, unknown> = { ...policyPatch };
  if (channel !== undefined) {
    const residue = validateChannelResidue(resolved.plugin, channel);
    if (!residue.ok) {
      res.status(400).json({ success: false, error: residue.error });
      return;
    }
    patch["channel"] = residue.value;
  }
  if (Object.keys(patch).length > 0) await updateAccountConfig(account.id, patch);
  await accountManager.wake(account.id);
  const fresh = await prisma.connectedSurface.findUniqueOrThrow({ where: { id: account.id }, include: { surface: { select: { key: true } } } });
  res.json({ success: true, account: await accountView(fresh, resolved.plugin) });
});

router.delete("/accounts/:id", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const account = toChannelAccount(resolved.account);
  await updateAccountConfig(account.id, { desiredState: "stopped" });
  await publishControl({ op: "logout", accountId: account.id });
  await setAccountStatus(account.id, "INACTIVE");
  // Auth state never outlives the account; linked identities go with it.
  await authStateFor(account.id).clear();
  await prisma.$transaction([
    prisma.surfaceAgent.deleteMany({ where: { surfaceId: account.surfaceId, surfaceTenantId: account.accountKey } }),
    prisma.userSurfaceIdentity.deleteMany({ where: { surfaceId: account.surfaceId, surfaceWorkspaceId: account.accountKey } }),
  ]);
  log.info(`[channels] account deleted id=${account.id} by=${resolved.userId}`);
  res.json({ success: true });
});

router.post("/accounts/:id/login", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const body = loginBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ success: false, error: body.error.message });
    return;
  }
  const account = toChannelAccount(resolved.account);
  if (resolved.plugin.login.kind === "token") {
    const store = authStateFor(account.id);
    const fields = resolved.plugin.loginFields ?? [];
    if (fields.length > 0) {
      const supplied = body.data.secrets ?? {};
      const missing = fields.filter((field) => !supplied[field.key]).map((field) => field.label);
      if (missing.length > 0) {
        res.status(400).json({ success: false, error: `Missing: ${missing.join(", ")}` });
        return;
      }
      for (const field of fields) await store.set(field.key, "", supplied[field.key] as string);
    } else {
      if (!body.data.token) {
        res.status(400).json({ success: false, error: "token is required for this channel" });
        return;
      }
      await store.set("bot-token", "", body.data.token);
    }
  }
  await updateAccountConfig(account.id, { desiredState: "running", connState: "pending_login" });
  await publishControl({ op: "login", accountId: account.id });
  await accountManager.wake(account.id);
  res.json({ success: true, connState: "pending_login", login: resolved.plugin.login });
});

router.post("/accounts/:id/logout", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const account = toChannelAccount(resolved.account);
  await updateAccountConfig(account.id, { desiredState: "stopped" });
  await publishControl({ op: "logout", accountId: account.id });
  // The owning pod unlinks the device on stopAccount("logout"); clearing here
  // too guarantees no creds survive even if that pod is gone.
  await authStateFor(account.id).clear();
  res.json({ success: true, connState: "disconnected" });
});

router.get("/accounts/:id/login-artifact", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const account = toChannelAccount(resolved.account);
  const artifact = await getLoginArtifact(account.id);
  let qr: string | null = null;
  if (artifact && resolved.plugin.login.kind === "qr") {
    try {
      qr = await QRCode.toDataURL(artifact, { errorCorrectionLevel: "M", margin: 1, width: 320 });
    } catch (err) {
      log.warn(`[channels] QR render failed account=${account.id}: ${errMsg(err)}`);
    }
  }
  res.json({
    success: true,
    connState: account.config.connState,
    desiredState: account.config.desiredState,
    login: resolved.plugin.login,
    artifact: resolved.plugin.login.kind === "qr" ? artifact : null,
    qr,
  });
});

router.get("/accounts/:id/status", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const view = await accountView(resolved.account, resolved.plugin);
  res.json({
    success: true,
    status: {
      connState: view.connState,
      desiredState: view.desiredState,
      displayId: view.displayId ?? null,
      selfId: view.selfId ?? null,
      leaseHolder: view.leaseHolder,
      ownedByThisPod: accountManager.owns(view.id),
      lastConnectedAt: view.lastConnectedAt ?? null,
      lastDisconnect: view.lastDisconnect ?? null,
    },
  });
});

/** Admin unlink: severs any user's identity on this account. The self-service
 *  counterpart (your own numbers only) lives in numbers.ts. */
router.delete("/accounts/:id/identities/:senderId", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const account = toChannelAccount(resolved.account);
  const senderId = typeof req.params["senderId"] === "string" ? decodeURIComponent(req.params["senderId"]) : "";
  const result = await unlinkIdentity({ surfaceId: account.surfaceId, accountKey: account.accountKey, senderId });
  log.info(`[channels] identity unlinked account=${account.id} sender=${senderId} by=${resolved.userId}`);
  res.json({ success: true, removed: result.count });
});

/**
 * Groups this account can be allowlisted into. Without this the only way to
 * find a group id is to message the group and read it out of the server log,
 * which is fine for whoever runs the server and useless for everyone else.
 */
router.get("/accounts/:id/groups", async (req: Request, res: Response) => {
  const resolved = await resolveAccountRequest(req);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const account = toChannelAccount(resolved.account);
  if (!resolved.plugin.listGroups) {
    res.json({ success: true, groups: [], supported: false });
    return;
  }
  if (account.config.connState !== "connected") {
    res.status(409).json({ success: false, error: `This ${resolved.plugin.displayName} account is not connected.` });
    return;
  }
  try {
    const groups = await accountManager.listGroups(account.id);
    if (groups === null) {
      // Another pod holds the socket; a sweep moves it within ~30s.
      res.status(503).json({ success: false, error: "This account is running on another server right now — try again in a moment." });
      return;
    }
    res.json({ success: true, groups, supported: true });
  } catch (err) {
    log.warn(`[channels] listGroups failed account=${account.id}: ${errMsg(err)}`);
    res.status(502).json({ success: false, error: "Could not read the group list from the messenger." });
  }
});
