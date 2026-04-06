import express from "express";
import { SERVER } from "./config.js";
import { initStore } from "./store.js";
import { runRouter } from "./routes/run.js";

initStore();

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "xyne-claw", uptime: process.uptime() });
});

app.use(runRouter);

const server = app.listen(SERVER.port, () => {
  console.log(`[xyne-claw] Server listening on port ${SERVER.port}`);
});

function shutdown(signal: string): void {
  console.log(`[xyne-claw] ${signal}. Shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err: Error) => {
  console.error("[xyne-claw] Uncaught exception — draining connections:", err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[xyne-claw] Unhandled rejection:", reason);
});

export { app };
