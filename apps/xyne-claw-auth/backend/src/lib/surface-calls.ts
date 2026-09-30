import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("surface-calls");

export const SURFACE_TOOLS = new Set([
  "app-navigate",
  "app-describe",
  "app-snapshot",
  "app-click",
  "app-type",
  "app-screenshot",
]);

export const PAGE_SURFACE_TOOLS = new Set([
  "page-read",
  "page-snapshot",
  "page-navigate",
  "page-click",
  "page-type",
  "page-press",
  "page-screenshot",
]);

const PAGE_SURFACE_TRIGGER_SOURCES = new Set(["chat"]);

const READ_DEADLINE_MS = 6000;
const ACT_DEADLINE_MS = 12000;
const DEVICE_ONLINE_MS = 90_000;
const FOCUS_WINDOW_MS = 5 * 60 * 1000;
const RESULT_POLL_MS = 250;
const MAX_ARG_CHARS = 4000;

export interface SurfaceCallResult {
  ok: boolean;
  content: string;
  image?: { data: string; mimeType: string };
  unavailable?: boolean;
}

export function isSurfaceTool(toolName: string): boolean {
  return SURFACE_TOOLS.has(toolName) || PAGE_SURFACE_TOOLS.has(toolName);
}

export function isPageSurfaceTool(toolName: string): boolean {
  return PAGE_SURFACE_TOOLS.has(toolName);
}

const PAGE_DEADLINES_MS: Record<string, number> = {
  "page-navigate": 18_000,
  "page-click": 12_000,
  "page-type": 12_000,
  "page-press": 12_000,
  "page-screenshot": 10_000,
};
const PAGE_READ_DEADLINE_MS = 8_000;

function deadlineFor(toolName: string): number {
  if (isPageSurfaceTool(toolName)) return PAGE_DEADLINES_MS[toolName] ?? PAGE_READ_DEADLINE_MS;
  return toolName === "app-click" || toolName === "app-type" ? ACT_DEADLINE_MS : READ_DEADLINE_MS;
}

function unavailable(content: string): SurfaceCallResult {
  return { ok: false, content, unavailable: true };
}

export function pageSurfaceAllowedForTrigger(triggerSource: string | null | undefined): boolean {
  return !!triggerSource && PAGE_SURFACE_TRIGGER_SOURCES.has(triggerSource);
}

async function pageSurfaceBlockedReason(sessionId: string | null | undefined, userId: string): Promise<string | null> {
  if (!sessionId) return "Browser panel tools need a run started from the Xyne AI screen.";
  const run = await prisma.agentRun.findUnique({
    where: { sessionId },
    select: { userId: true, triggerSource: true },
  });
  if (!run || run.userId !== userId) return "Browser panel tools need a run started from the Xyne AI screen.";
  if (!pageSurfaceAllowedForTrigger(run.triggerSource)) {
    return "Browser panel tools only work for runs started from the Xyne AI screen.";
  }
  return null;
}

function isDeclinedByOldApp(toolName: string, content: string): boolean {
  return isPageSurfaceTool(toolName) && content.startsWith("Unknown app tool");
}

interface DeviceRow {
  id: string;
  orgId: string;
  deviceName: string;
  lastSeenAt: Date | null;
  focusedAt: Date | null;
}

export function pickDevice(devices: DeviceRow[], now = Date.now()): {
  device: DeviceRow | null;
  reason: "focused" | "only" | "ambiguous" | "offline";
  online: DeviceRow[];
} {
  const online = devices.filter(
    (d) => d.lastSeenAt !== null && now - d.lastSeenAt.getTime() < DEVICE_ONLINE_MS,
  );
  if (online.length === 0) return { device: null, reason: "offline", online };

  const focused = online
    .filter((d) => d.focusedAt !== null && now - d.focusedAt.getTime() < FOCUS_WINDOW_MS)
    .sort((a, b) => (b.focusedAt as Date).getTime() - (a.focusedAt as Date).getTime());
  if (focused.length > 0) return { device: focused[0] as DeviceRow, reason: "focused", online };

  if (online.length === 1) return { device: online[0] as DeviceRow, reason: "only", online };
  return { device: null, reason: "ambiguous", online };
}

function tooBig(args: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(args).length > MAX_ARG_CHARS;
  } catch {
    return true;
  }
}

export async function callSurfaceTool(input: {
  userId: string;
  sessionId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<SurfaceCallResult> {
  const { userId, toolName, args } = input;

  if (!isSurfaceTool(toolName)) {
    return { ok: false, content: `Unknown app tool: ${toolName}` };
  }
  if (tooBig(args)) {
    return { ok: false, content: "Arguments are too large for an app tool." };
  }
  const pageTool = isPageSurfaceTool(toolName);
  if (pageTool) {
    const blocked = await pageSurfaceBlockedReason(input.sessionId, userId);
    if (blocked) return unavailable(blocked);
  }

  const devices = await prisma.localHarnessDevice.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, orgId: true, deviceName: true, lastSeenAt: true, focusedAt: true },
  });

  const picked = pickDevice(devices);
  if (!picked.device) {
    if (pageTool) return unavailable("The Xyne desktop app is not open, so there is no browser panel to use.");
    if (picked.reason === "ambiguous") {
      const names = picked.online.map((d) => d.deviceName).join(", ");
      return {
        ok: false,
        content:
          `Several Xyne apps are open (${names}) and none is in front. Ask the user which one to use, ` +
          `or ask them to click the window they mean.`,
      };
    }
    return {
      ok: false,
      content: "The Xyne desktop app is not open, so there is no window to read or drive.",
    };
  }

  const deadlineMs = deadlineFor(toolName);
  const call = await prisma.surfaceCall.create({
    data: {
      userId,
      orgId: picked.device.orgId,
      deviceId: picked.device.id,
      sessionId: input.sessionId ?? null,
      toolName,
      args: args as object,
      expiresAt: new Date(Date.now() + deadlineMs),
    },
    select: { id: true },
  });

  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, RESULT_POLL_MS));
    const row = await prisma.surfaceCall.findUnique({
      where: { id: call.id },
      select: { status: true, ok: true, content: true, image: true },
    });
    if (!row) break;
    if (row.status === "DONE") {
      await prisma.surfaceCall.delete({ where: { id: call.id } }).catch(() => undefined);
      const image = row.image as { data?: unknown; mimeType?: unknown } | null;
      const valid =
        image && typeof image.data === "string" && typeof image.mimeType === "string"
          ? { data: image.data, mimeType: image.mimeType }
          : undefined;
      const content = typeof row.content === "string" ? row.content : "";
      if (row.ok !== true && isDeclinedByOldApp(toolName, content)) {
        return unavailable(`The Xyne app on ${picked.device.deviceName} is too old to use its browser panel.`);
      }
      if (pageTool) log.info(`[surface-calls] ${toolName} ok=${row.ok === true} device=${picked.device.id} session=${input.sessionId ?? "-"}`);
      return {
        ok: row.ok === true,
        content,
        ...(valid ? { image: valid } : {}),
      };
    }
  }

  await prisma.surfaceCall
    .update({ where: { id: call.id }, data: { status: "EXPIRED" } })
    .catch(() => undefined);
  log.warn(`[surface-calls] ${toolName} expired device=${picked.device.id}`);
  return {
    ok: false,
    content: `The Xyne app on ${picked.device.deviceName} did not answer ${toolName} in time.`,
  };
}

export async function nextSurfaceCall(deviceId: string): Promise<{
  id: string;
  toolName: string;
  args: Record<string, unknown>;
} | null> {
  const now = new Date();
  const row = await prisma.surfaceCall.findFirst({
    where: { deviceId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    select: { id: true, toolName: true, args: true },
  });
  if (!row) return null;

  const claimed = await prisma.surfaceCall.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "CLAIMED", claimedAt: now },
  });
  if (claimed.count === 0) return null;

  return {
    id: row.id,
    toolName: row.toolName,
    args: (row.args ?? {}) as Record<string, unknown>,
  };
}

export async function resolveSurfaceCall(
  deviceId: string,
  callId: string,
  result: SurfaceCallResult,
): Promise<boolean> {
  const updated = await prisma.surfaceCall.updateMany({
    where: { id: callId, deviceId, status: "CLAIMED" },
    data: {
      status: "DONE",
      ok: result.ok,
      content: result.content.slice(0, 200_000),
      ...(result.image ? { image: result.image as object } : {}),
    },
  });
  return updated.count > 0;
}
