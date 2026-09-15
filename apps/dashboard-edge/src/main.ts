import { loadConfig } from './config.js';
import { createEdgeServer } from './http/server.js';
import { log, setLogLevel } from './log.js';
import { startSyslogListener } from './metrics.js';
import { createOrigin } from './origin/index.js';
import { RulesStore } from './rules/store.js';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from './telemetry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  initializeOpenTelemetry(config.otel);

  const origin = createOrigin(config.storage);
  log.info('storage origin ready', origin.describe());

  const store = new RulesStore({
    file: config.rulesFile,
    reloadIntervalMs: config.reloadIntervalMs,
    healthIntervalMs: config.healthIntervalMs,
    origin,
  });

  const server = createEdgeServer(store, origin, config);
  await new Promise<void>((resolveListen) => {
    server.listen(config.listen.port, config.listen.addr, () => resolveListen());
  });
  log.info('edge app listening', config.listen);

  const syslog = startSyslogListener(config.syslogPort, config.listen.addr);

  // Rules load after the server is up so /_edge/healthz answers immediately;
  // /_edge/ready stays 503 until the first load has published a rule set.
  await store.start();

  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    store.stop();
    syslog.close();
    server.close(() => {
      void shutdownOpenTelemetry().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.error('fatal', { err });
  process.exit(1);
});
