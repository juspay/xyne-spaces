import { createLogger } from "./logger.js";
const log = createLogger("main");

// Identify this process in structured logs (overridden by deployment env).
process.env.SERVICE_NAME ||= "xyne-claw-auth";

import express from "express";
import { CONFIG } from "./config.js";
import { installParsers } from "./http/parsers.js";
import { mountRoutes } from "./http/routes.js";
import { bootWorkers, shutdownWorkers } from "./boot/workers.js";
import { initializeOpenTelemetry, shutdownOpenTelemetry } from "./otel/telemetry.js";
import { registerDailyBriefGauges } from "./otel/daily-brief-metrics.js";
import { redisService } from "./redis.js";
import { agentRunRepository } from "./repositories/agentRunRepository.js";
import { closeMessagingAccountManager } from "./surfaces/messaging/bootstrap.js";
import { startEventLoopMonitor } from "./lib/event-loop-monitor.js";

const app = express();
// How many reverse proxies sit in front of this process. Without it Express
// reads `req.ip` from the socket, which behind a load balancer is the balancer
// for every request, so every IP-keyed limiter (sign-in especially) becomes one
// bucket shared by the whole company. A count rather than `true`: trusting the
// whole chain lets a client forge X-Forwarded-For and pick its own bucket.
app.set("trust proxy", CONFIG.trustedProxyHops);
installParsers(app);
mountRoutes(app);

initializeOpenTelemetry();
registerDailyBriefGauges();

startEventLoopMonitor();

/** How long shutdown waits on the tool-invocation flush. Each write may take
 *  up to its 30s transaction timeout, which outlasts the pod's grace period,
 *  so an unbounded wait meant nothing after it ever ran. */
const SHUTDOWN_FLUSH_MS = 5_000;

const server = app.
listen(CONFIG.port, () => {
  log.info(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);

  bootWorkers();
});

async function shutdown(signal: string): Promise<void> {
  log.info(`[xyne-claw-auth] ${signal}. Shutting down.`);
  // First, ahead of anything that can hang: until the leases are released the
  // next pod cannot take the WhatsApp sockets, and each number stays offline
  // for the full lease TTL after this process dies.
  await closeMessagingAccountManager().catch(() => {});
  const flushed = await Promise.race([
    agentRunRepository.flushAllToolInvocations().then(() => true, () => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), SHUTDOWN_FLUSH_MS).unref()),
  ]);
  if (!flushed) log.warn(`[xyne-claw-auth] tool invocation flush still running after ${SHUTDOWN_FLUSH_MS}ms; continuing shutdown`);
  await shutdownWorkers();
  await redisService.disconnect().catch(() => {});
  await shutdownOpenTelemetry().catch(() => {});
  server.close(() => {
    void agentRunRepository.flushAllToolInvocations().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err: Error) => {
  log.error("[xyne-claw-auth] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("[xyne-claw-auth] Unhandled rejection:", reason);
});

export { app };
