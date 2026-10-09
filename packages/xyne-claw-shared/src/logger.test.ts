import { Writable } from "node:stream";
import winston from "winston";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every way a value can reach a log line, each carrying the same secret. The
// real claw logger (formats included) must never print it.
const SECRET = "Bearer zzPROBEzz1234567890abcdef";

type ProbeLogger = {
  info: (...args: unknown[]) => unknown;
  error: (...args: unknown[]) => unknown;
  child: (meta: Record<string, unknown>) => { info: (...args: unknown[]) => unknown };
};

function runProbes(log: ProbeLogger, inContext: (store: Record<string, unknown>, fn: () => void) => void): number {
  const deep = (): Record<string, unknown> => {
    let o: Record<string, unknown> = { detail: SECRET };
    for (let i = 0; i < 6; i++) o = { n: o };
    return o;
  };
  const probes: Array<() => unknown> = [
    () => log.info("p01", { detail: SECRET }),
    () => log.info("p02", { apiKey: "raw-value" }),
    () => log.info(`p03 ${SECRET}`),
    () => log.info("p04", { timestamp: SECRET }),
    () => log.info("p05", { level: SECRET }),
    () => log.info("p06", { a: 1 }, { detail: SECRET }),
    () => log.info("p07 %s", SECRET),
    () => log.info("p08", SECRET),
    () => log.error("p09", new Error(`boom ${SECRET}`)),
    () => log.error(`p10 ${SECRET}`),
    () => log.info("p11", { stack: SECRET }),
    () => log.info({ message: { detail: SECRET }, tag: "p12" }),
    () => log.child({ detail: SECRET }).info("p13"),
    () => log.info("p14", deep()),
    () => log.info("p15", { items: ["ok", SECRET] }),
    () => log.info("p16", { module: SECRET, service: SECRET }),
    () => log.info("p17", { message: SECRET }),
    () => inContext({ requestId: SECRET, emailId: SECRET }, () => log.info("p18")),
  ];
  for (const probe of probes) probe();
  return probes.length;
}

async function captureWith(nodeEnv: string): Promise<{ lines: string[]; probes: number }> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const { logger, loggerContext } = await import("./logger.js");
  const lines: string[] = [];
  logger.clear();
  logger.add(
    new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _enc, cb) {
          lines.push(String(chunk));
          cb();
        },
      }),
    }),
  );
  const probes = runProbes(logger as unknown as ProbeLogger, (store, fn) => loggerContext.run(store, fn));
  await new Promise((resolve) => setImmediate(resolve));
  return { lines, probes };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("claw logger never prints a secret", () => {
  for (const env of ["production", "development"]) {
    it(`${env} format`, async () => {
      const { lines, probes } = await captureWith(env);
      expect(lines.length).toBe(probes);
      for (const line of lines) expect(line).not.toContain("zzPROBEzz");
    });
  }
});
