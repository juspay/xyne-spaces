import { Router, type Request, type Response } from "express";
import { normalizeProviderName } from "../lib/provider-hints.js";
import { userProviderCredentialsRepository } from "../repositories/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("providers-internal");

const MAX_PROVIDERS = 6;

export const providersInternalRouter = Router();

providersInternalRouter.post("/available", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; providers?: unknown };
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const requested = Array.isArray(body.providers)
    ? [
        ...new Set(
          body.providers
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.trim())
            .filter((p) => p.length > 0),
        ),
      ].slice(0, MAX_PROVIDERS)
    : [];

  if (!userId || requested.length === 0) {
    res.json({ success: true, connected: [], existing: [], known: false });
    return;
  }

  const resolved = requested.map((name) => ({ name, match: normalizeProviderName(name) }));
  const existing = [
    ...new Set(
      resolved
        .map((entry) => entry.match)
        .filter((match): match is NonNullable<typeof match> => match !== null),
    ),
  ];
  const unknown = resolved.filter((entry) => entry.match === null).map((entry) => entry.name);

  try {
    const creds = await userProviderCredentialsRepository.listByUser(userId);
    const held = new Set(creds.map((c) => c.provider));
    res.json({
      success: true,
      connected: existing.filter((p) => p === "spaces" || held.has(p)),
      existing,
      unknown,
      known: true,
    });
  } catch (err) {
    log.warn(
      `[providers-internal] credential lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.json({ success: true, connected: [], existing, unknown, known: false });
  }
});
