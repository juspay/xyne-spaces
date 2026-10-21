import { EventEmitter } from "node:events";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("device-push");

const CHANNEL_PREFIX = "claw:device-push:";
const CAPABILITY_PREFIX = "claw:device-capabilities:";
export const DEVICE_CAPABILITY_TTL_SECONDS = 45;

export const DEVICE_CAPABILITIES = ["page-tools", "open-url"] as const;
export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

const channelFor = (deviceId: string): string => CHANNEL_PREFIX + deviceId;
const capabilityKey = (deviceId: string): string => CAPABILITY_PREFIX + deviceId;

const local = new EventEmitter();
local.setMaxListeners(0);

let subscriberReady = false;

function ensureSubscriber(): void {
  if (subscriberReady) return;
  subscriberReady = true;
  const sub = redisService.getConnection().duplicate();
  sub
    .psubscribe(`${CHANNEL_PREFIX}*`)
    .then(() => log.info(`[device-push] subscribed to ${CHANNEL_PREFIX}*`))
    .catch((err) => {
      subscriberReady = false;
      log.error(`[device-push] psubscribe failed: ${errMsg(err)}`);
    });
  sub.on("pmessage", (_pattern: string, channel: string, raw: string) => {
    local.emit(channel.slice(CHANNEL_PREFIX.length), raw);
  });
  sub.on("error", (err: Error) => log.error(`[device-push] subscriber error: ${err.message}`));
}

export function parseDeviceCapabilities(raw: unknown): DeviceCapability[] {
  const values = typeof raw === "string" ? raw.split(",") : [];
  const known = new Set<string>(DEVICE_CAPABILITIES);
  return [...new Set(values.map((v) => v.trim()).filter((v): v is DeviceCapability => known.has(v)))];
}

export async function markDeviceConnected(deviceId: string, capabilities: DeviceCapability[]): Promise<void> {
  await redisService
    .getConnection()
    .set(capabilityKey(deviceId), JSON.stringify(capabilities), "EX", DEVICE_CAPABILITY_TTL_SECONDS)
    .catch((err) => log.warn(`[device-push] capability write failed device=${deviceId}: ${errMsg(err)}`));
}

export async function markDeviceDisconnected(deviceId: string): Promise<void> {
  await redisService.getConnection().del(capabilityKey(deviceId)).catch(() => undefined);
}

export async function deviceCapabilities(deviceId: string): Promise<Set<DeviceCapability>> {
  const raw = await redisService.getConnection().get(capabilityKey(deviceId)).catch(() => null);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parseDeviceCapabilities(parsed.join(",")) : []);
  } catch {
    return new Set();
  }
}

export async function wakeDevice(deviceId: string): Promise<number> {
  return redisService
    .getConnection()
    .publish(channelFor(deviceId), "wake")
    .catch((err) => {
      log.warn(`[device-push] publish failed device=${deviceId}: ${errMsg(err)}`);
      return 0;
    });
}

export function onDeviceWake(deviceId: string, handler: () => void): () => void {
  ensureSubscriber();
  const listener = (): void => handler();
  local.on(deviceId, listener);
  return () => local.off(deviceId, listener);
}

export interface DeviceStreamDeps {
  deviceId: string;
  capabilities: DeviceCapability[];
  write: (chunk: string) => void;
  nextCall: () => Promise<unknown | null>;
  touch: () => void;
  heartbeatMs: number;
}

export async function serveDeviceStream(deps: DeviceStreamDeps): Promise<() => void> {
  let closed = false;
  let draining = false;
  let again = false;

  const drain = async (): Promise<void> => {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        for (;;) {
          if (closed) return;
          const call = await deps.nextCall().catch(() => null);
          if (!call) break;
          deps.write(`event: call\ndata: ${JSON.stringify(call)}\n\n`);
        }
      } while (again && !closed);
    } finally {
      draining = false;
    }
  };

  deps.write(`event: ready\ndata: ${JSON.stringify({ capabilities: deps.capabilities })}\n\n`);
  await markDeviceConnected(deps.deviceId, deps.capabilities);
  const unsubscribe = onDeviceWake(deps.deviceId, () => void drain());
  await drain();
  const heartbeat = setInterval(() => {
    if (closed) return;
    deps.write(":ka\n\n");
    void markDeviceConnected(deps.deviceId, deps.capabilities);
    deps.touch();
    void drain();
  }, deps.heartbeatMs);

  return () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
}
