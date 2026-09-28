import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { LocalHarnessDevice, LocalHarnessRun } from "@prisma/client";
import { prisma } from "../db.js";

export const LOCAL_HARNESS_ONLINE_WINDOW_MS = 90_000;

const LIVE_RUN_STATUSES: string[] = ["queued", "claimed", "running"];

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deviceTokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function isDeviceOnline(device: Pick<LocalHarnessDevice, "lastSeenAt">, now = Date.now()): boolean {
  return !!device.lastSeenAt && now - device.lastSeenAt.getTime() < LOCAL_HARNESS_ONLINE_WINDOW_MS;
}

// Providers this device can actually run right now: the CLI is signed in AND the
// user has connected that harness here. `enabled === undefined` means the device
// was registered before per-harness pairing shipped, when connecting paired every
// signed-in CLI at once — keep those working instead of silently going dark.
export function authenticatedProviders(device: Pick<LocalHarnessDevice, "installations">): string[] {
  const installations = Array.isArray(device.installations) ? device.installations : [];
  return installations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (record["authenticated"] !== true || record["enabled"] === false) return [];
    return typeof record["provider"] === "string" ? [record["provider"]] : [];
  });
}

function runConversationId(run: Pick<LocalHarnessRun, "envelope">): string | null {
  const envelope = run.envelope as unknown as { conversationId?: unknown } | null;
  const id = envelope && typeof envelope === "object" ? (envelope as { conversationId?: unknown }).conversationId : null;
  return typeof id === "string" && id ? id : null;
}

export const localHarnessRepository = {
  // Per-user default harness. Set in onboarding / Claw Settings; consulted for
  // every agent this user runs that has no per-agent override of its own.
  getUserDefaultProvider: async (userId: string): Promise<string | null> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { localHarnessDefaultProvider: true },
    });
    return user?.localHarnessDefaultProvider ?? null;
  },

  setUserDefaultProvider: async (userId: string, provider: string | null): Promise<void> => {
    await prisma.user.update({ where: { id: userId }, data: { localHarnessDefaultProvider: provider } });
  },

  // Workspace all/selected policy. Stored on Organization.metadata.localHarness
  // .mode so no dedicated table/migration is needed. 'all' = every mention-driven
  // run may route to an online device; 'selected' = only agents that explicitly
  // opt in (via providerOrder) or a per-user personal provider route locally.
  getOrgHarnessMode: async (orgId: string): Promise<"all" | "selected" | null> => {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { metadata: true } });
    const meta = org?.metadata && typeof org.metadata === "object" && !Array.isArray(org.metadata)
      ? (org.metadata as Record<string, unknown>)
      : null;
    const lh = meta && typeof meta["localHarness"] === "object" && meta["localHarness"]
      ? (meta["localHarness"] as Record<string, unknown>)
      : null;
    const mode = lh?.["mode"];
    return mode === "all" || mode === "selected" ? mode : null;
  },

  setOrgHarnessMode: async (orgId: string, mode: "all" | "selected"): Promise<void> => {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { metadata: true } });
    const meta = org?.metadata && typeof org.metadata === "object" && !Array.isArray(org.metadata)
      ? { ...(org.metadata as Record<string, unknown>) }
      : {};
    const lh = typeof meta["localHarness"] === "object" && meta["localHarness"]
      ? (meta["localHarness"] as Record<string, unknown>)
      : {};
    meta["localHarness"] = { ...lh, mode };
    await prisma.organization.update({ where: { id: orgId }, data: { metadata: meta as Prisma.InputJsonValue } });
  },

  registerDevice: async (args: {
    userId: string;
    orgId: string;
    deviceName: string;
    platform: string;
    installations: Prisma.InputJsonValue;
  }): Promise<{ device: LocalHarnessDevice; token: string }> => {
    const token = generateDeviceToken();
    const tokenHash = hashDeviceToken(token);

    const existing = await prisma.localHarnessDevice.findFirst({
      where: { userId: args.userId, deviceName: args.deviceName },
    });

    const device = existing
      ? await prisma.localHarnessDevice.update({
          where: { id: existing.id },
          data: {
            orgId: args.orgId,
            platform: args.platform,
            installations: args.installations,
            tokenHash,
            revokedAt: null,
            lastSeenAt: new Date(),
          },
        })
      : await prisma.localHarnessDevice.create({
          data: {
            userId: args.userId,
            orgId: args.orgId,
            deviceName: args.deviceName,
            platform: args.platform,
            installations: args.installations,
            tokenHash,
            lastSeenAt: new Date(),
          },
        });

    return { device, token };
  },

  findDeviceByToken: async (token: string): Promise<LocalHarnessDevice | null> => {
    const device = await prisma.localHarnessDevice.findUnique({ where: { tokenHash: hashDeviceToken(token) } });
    if (!device || device.revokedAt) return null;
    if (!deviceTokenHashEquals(device.tokenHash, hashDeviceToken(token))) return null;
    return device;
  },

  listDevices: (userId: string): Promise<LocalHarnessDevice[]> =>
    prisma.localHarnessDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),

  listOnlineDevicesForProvider: async (userId: string, provider: string): Promise<LocalHarnessDevice[]> => {
    const devices = await prisma.localHarnessDevice.findMany({ where: { userId, revokedAt: null } });
    const now = Date.now();
    return devices.filter((device) => isDeviceOnline(device, now) && authenticatedProviders(device).includes(provider));
  },

  listOnlineDevices: async (userId: string): Promise<LocalHarnessDevice[]> => {
    const devices = await prisma.localHarnessDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
    });
    const now = Date.now();
    return devices.filter((device) => isDeviceOnline(device, now));
  },

  revokeDevice: async (userId: string, deviceId: string): Promise<boolean> => {
    const result = await prisma.localHarnessDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  },

  touchDevice: (deviceId: string): Promise<unknown> =>
    prisma.localHarnessDevice.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }),

  setDeviceFocus: (deviceId: string, focused: boolean, route: string | null): Promise<unknown> =>
    prisma.localHarnessDevice.update({
      where: { id: deviceId },
      data: {
        lastSeenAt: new Date(),
        ...(focused ? { focusedAt: new Date() } : {}),
        ...(route === null ? {} : { appRoute: route }),
      },
    }),

  // Per-harness connect/disconnect. Authed by the device token the app already
  // holds, so toggling one harness does NOT rotate the pairing token the way a
  // re-registration would (that would 401 the in-flight long-poll).
  updateInstallations: (deviceId: string, installations: Prisma.InputJsonValue): Promise<unknown> =>
    prisma.localHarnessDevice.update({
      where: { id: deviceId },
      data: { installations, lastSeenAt: new Date() },
    }),

  enqueueRun: (args: {
    sessionId: string;
    userId: string;
    orgId: string;
    agentSlug: string;
    provider: string;
    model: string | null;
    envelope: Prisma.InputJsonValue;
    progressUrl: string;
    callbackUrl: string;
    expiresAt: Date;
  }): Promise<LocalHarnessRun> =>
    prisma.localHarnessRun.create({
      data: {
        sessionId: args.sessionId,
        userId: args.userId,
        orgId: args.orgId,
        agentSlug: args.agentSlug,
        provider: args.provider,
        model: args.model,
        envelope: args.envelope,
        progressUrl: args.progressUrl,
        callbackUrl: args.callbackUrl,
        expiresAt: args.expiresAt,
      },
    }),

  findById: (runId: string): Promise<LocalHarnessRun | null> =>
    prisma.localHarnessRun.findUnique({ where: { id: runId } }),

  findActiveByConversation: async (conversationId: string): Promise<LocalHarnessRun | null> => {
    const runs = await prisma.localHarnessRun.findMany({
      where: {
        status: { in: ["claimed", "running"] },
        envelope: { path: ["conversationId"], equals: conversationId },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return runs.find((run) => runConversationId(run) === conversationId) ?? null;
  },

  claimNextRun: async (device: LocalHarnessDevice, providers: string[]): Promise<LocalHarnessRun | null> => {
    if (providers.length === 0) return null;
    const activeOnDevice = await prisma.localHarnessRun.findMany({
      where: { deviceId: device.id, status: { in: ["claimed", "running"] } },
      take: 100,
    });
    const busyConversations = new Set(
      activeOnDevice.map(runConversationId).filter((id): id is string => !!id),
    );
    const candidates = await prisma.localHarnessRun.findMany({
      where: {
        userId: device.userId,
        // Defence in depth: a run is only ever claimable by a device in the
        // SAME org as the run. userId already implies the org, but asserting
        // orgId makes cross-org leakage impossible even if a user's org moves.
        orgId: device.orgId,
        status: "queued",
        provider: { in: providers },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    for (const candidate of candidates) {
      const conversationId = runConversationId(candidate);
      if (conversationId && busyConversations.has(conversationId)) continue;
      const claimed = await prisma.localHarnessRun.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: { status: "claimed", deviceId: device.id, claimedAt: new Date() },
      });
      if (claimed.count > 0) {
        return prisma.localHarnessRun.findUnique({ where: { id: candidate.id } });
      }
    }
    return null;
  },

  releaseRun: (runId: string): Promise<unknown> =>
    prisma.localHarnessRun.updateMany({
      where: { id: runId, status: "claimed" },
      data: { status: "queued", deviceId: null, claimedAt: null },
    }),

  findOwnedRun: async (runId: string, device: LocalHarnessDevice): Promise<LocalHarnessRun | null> => {
    const run = await prisma.localHarnessRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    if (run.userId !== device.userId || run.orgId !== device.orgId || run.deviceId !== device.id) return null;
    return run;
  },

  cancelRun: async (runId: string): Promise<boolean> => {
    const result = await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: { in: ["queued", "claimed", "running", "awaiting_approval"] } },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    return result.count > 0;
  },

  markRunning: (runId: string): Promise<unknown> =>
    prisma.localHarnessRun.updateMany({ where: { id: runId, status: "claimed" }, data: { status: "running" } }),

  finishRun: async (runId: string, status: "done" | "failed" | "cancelled", error?: string): Promise<boolean> => {
    const result = await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: { in: ["queued", "claimed", "running"] } },
      data: { status, finishedAt: new Date(), ...(error ? { error } : {}) },
    });
    return result.count > 0;
  },

  setPendingAction: async (runId: string, pendingActionId: string, action: Prisma.InputJsonValue): Promise<boolean> => {
    const result = await prisma.localHarnessRun.updateMany({
      where: { id: runId, pendingActionId: null, status: { in: ["claimed", "running"] } },
      data: { pendingActionId, pendingAction: action },
    });
    return result.count > 0;
  },

  clearPendingAction: async (runId: string): Promise<void> => {
    await prisma.localHarnessRun.updateMany({
      where: { id: runId },
      data: { pendingAction: Prisma.DbNull, pendingActionId: null },
    });
  },

  markAwaitingApproval: async (runId: string): Promise<boolean> => {
    const result = await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: { in: LIVE_RUN_STATUSES } },
      data: { status: "awaiting_approval" },
    });
    return result.count > 0;
  },

  setCliSessionId: async (runId: string, cliSessionId: string): Promise<void> => {
    await prisma.localHarnessRun.updateMany({ where: { id: runId }, data: { cliSessionId } });
  },

  findRunByPendingActionId: (pendingActionId: string, userId: string): Promise<LocalHarnessRun | null> =>
    prisma.localHarnessRun.findFirst({
      where: { pendingActionId, userId, status: "awaiting_approval" },
      orderBy: { createdAt: "desc" },
    }),

  finishAwaitingApproval: async (runId: string): Promise<void> => {
    await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: "awaiting_approval" },
      data: { status: "done", finishedAt: new Date(), pendingAction: Prisma.DbNull, pendingActionId: null },
    });
  },

  findBySessionId: (sessionId: string): Promise<LocalHarnessRun | null> =>
    prisma.localHarnessRun.findUnique({ where: { sessionId } }),

  findAbandonedRuns: async (args: {
    claimTimeoutMs: number;
    limit?: number;
  }): Promise<Array<{ run: LocalHarnessRun; reason: string }>> => {
    const now = Date.now();
    const limit = args.limit ?? 50;

    const [stalled, inFlight] = await Promise.all([
      prisma.localHarnessRun.findMany({
        where: {
          status: { in: LIVE_RUN_STATUSES },
          OR: [
            { expiresAt: { lt: new Date(now) } },
            { status: "queued", createdAt: { lt: new Date(now - args.claimTimeoutMs) } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
      prisma.localHarnessRun.findMany({
        where: { status: { in: ["claimed", "running"] } },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    ]);

    const abandoned: Array<{ run: LocalHarnessRun; reason: string }> = stalled.map((run) => ({
      run,
      reason:
        run.expiresAt.getTime() < now
          ? "the local harness never reported a result"
          : "no local device picked the run up",
    }));

    const seen = new Set(abandoned.map(({ run }) => run.id));
    const candidates = inFlight.filter((run) => !seen.has(run.id) && run.deviceId);
    if (candidates.length > 0) {
      const devices = await prisma.localHarnessDevice.findMany({
        where: { id: { in: [...new Set(candidates.map((run) => run.deviceId as string))] } },
        select: { id: true, lastSeenAt: true, revokedAt: true },
      });
      const deviceById = new Map(devices.map((device) => [device.id, device]));
      for (const run of candidates) {
        const device = deviceById.get(run.deviceId as string);
        if (device && (device.revokedAt || !isDeviceOnline(device, now))) {
          abandoned.push({ run, reason: "the local device went offline mid-run" });
        }
      }
    }

    return abandoned;
  },

  beginFallback: async (runId: string): Promise<boolean> => {
    const result = await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: { in: LIVE_RUN_STATUSES } },
      data: { status: "failing_over" },
    });
    return result.count > 0;
  },

  settleFallback: async (runId: string, ok: boolean, error?: string): Promise<void> => {
    await prisma.localHarnessRun.updateMany({
      where: { id: runId, status: "failing_over" },
      data: {
        status: ok ? "failed_over" : "failed",
        finishedAt: new Date(),
        ...(error ? { error } : {}),
      },
    });
  },
};
