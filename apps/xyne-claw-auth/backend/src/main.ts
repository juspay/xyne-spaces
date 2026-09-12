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

const app = express();
installParsers(app);
mountRoutes(app);

initializeOpenTelemetry();
registerDailyBriefGauges();

const server = app.
listen(CONFIG.port, () => {
  log.info(`[xyne-claw-auth] Server listening on port ${CONFIG.port}`);

  bootWorkers();
});

async function shutdown(signal: string): Promise<void> {
  log.info(`[xyne-claw-auth] ${signal}. Shutting down.`);
  await shutdownWorkers();
  await redisService.disconnect().catch(() => {});
  await shutdownOpenTelemetry().catch(() => {});
  server.close(() => process.exit(0));
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
