import { describe, it, expect, vi, afterEach } from "vitest";

async function stderrLevelsWith(flag: string | undefined): Promise<Record<string, boolean>> {
  vi.resetModules();
  if (flag === undefined) delete process.env.LOG_TO_STDERR;
  else process.env.LOG_TO_STDERR = flag;
  const { logger } = await import("./logger.js");
  return (logger.transports[0] as unknown as { stderrLevels: Record<string, boolean> }).stderrLevels;
}

describe("logger output stream", () => {
  afterEach(() => {
    delete process.env.LOG_TO_STDERR;
  });

  it("writes to stdout by default", async () => {
    expect(await stderrLevelsWith(undefined)).toEqual({});
  });

  it("routes every level to stderr under LOG_TO_STDERR=1 (stdio MCP children)", async () => {
    const levels = await stderrLevelsWith("1");
    for (const l of ["error", "warn", "info", "http", "verbose", "debug", "silly"]) {
      expect(levels[l]).toBe(true);
    }
  });
});
