import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LocalHarnessDevice, LocalHarnessRun, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const LOCAL_HARNESS_ONLINE_WINDOW_MS = 90_000;

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

export const localHarnessRepository = {
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
    return devices.filter((device) => {
      if (!isDeviceOnline(device, now)) return false;
      const installations = Array.isArray(device.installations) ? device.installations : [];
      return installations.some((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const record = entry as Record<string, unknown>;
        return record["provider"] === provider && record["authenticated"] === true;
      });
    });
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

  claimNextRun: async (device: LocalHarnessDevice, providers: string[]): Promise<LocalHarnessRun | null> => {
    if (providers.length === 0) return null;
    const candidates = await prisma.localHarnessRun.findMany({
      where: {
        userId: device.userId,
        status: "queued",
        provider: { in: providers },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    for (const candidate of candidates) {
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

  findOwnedRun: async (runId: string, device: LocalHarnessDevice): Promise<LocalHarnessRun | null> => {
    const run = await prisma.localHarnessRun.findUnique({ where: { id: runId } });
    if (!run) return null;
    if (run.userId !== device.userId || run.deviceId !== device.id) return null;
    return run;
  },

  markRunning: (runId: string): Promise<unknown> =>
    prisma.localHarnessRun.updateMany({ where: { id: runId, status: "claimed" }, data: { status: "running" } }),

  finishRun: (runId: string, status: "done" | "failed" | "cancelled", error?: string): Promise<unknown> =>
    prisma.localHarnessRun.updateMany({
      where: { id: runId, status: { in: ["queued", "claimed", "running"] } },
      data: { status, finishedAt: new Date(), ...(error ? { error } : {}) },
    }),

  findBySessionId: (sessionId: string): Promise<LocalHarnessRun | null> =>
    prisma.localHarnessRun.findUnique({ where: { sessionId } }),

  expireStaleRuns: async (limit = 50): Promise<LocalHarnessRun[]> => {
    const stale = await prisma.localHarnessRun.findMany({
      where: { status: { in: ["queued", "claimed", "running"] }, expiresAt: { lt: new Date() } },
      take: limit,
    });
    const expired: LocalHarnessRun[] = [];
    for (const run of stale) {
      const updated = await prisma.localHarnessRun.updateMany({
        where: { id: run.id, status: { in: ["queued", "claimed", "running"] } },
        data: { status: "failed", finishedAt: new Date(), error: "Local harness did not report a result in time" },
      });
      if (updated.count > 0) expired.push(run);
    }
    return expired;
  },
};
