import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

export function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolvePromise(false));
    probe.listen({ port, host: "127.0.0.1" }, () => {
      probe.close(() => resolvePromise(true));
    });
  });
}

export function describePortOwner(port) {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fcp"],
      { encoding: "utf8", timeout: 3000 },
    );
    if (result.status !== 0 || !result.stdout) return null;
    let pid = null;
    let command = null;
    for (const line of result.stdout.split("\n")) {
      if (!pid && line.startsWith("p")) pid = line.slice(1);
      if (!command && line.startsWith("c")) command = line.slice(1);
      if (pid && command) break;
    }
    if (!pid) return null;
    return { pid: Number(pid), command: command ?? "unknown" };
  } catch {
    return null;
  }
}

export async function findBusyPorts(entries) {
  const seen = new Set();
  const unique = entries.filter((entry) => {
    if (seen.has(entry.port)) return false;
    seen.add(entry.port);
    return true;
  });
  const results = await Promise.all(
    unique.map(async (entry) => ({
      entry,
      free: await isPortFree(entry.port),
    })),
  );
  return results
    .filter((result) => !result.free)
    .map(({ entry }) => ({ ...entry, owner: describePortOwner(entry.port) }));
}

export const formatBusyPort = (busy) =>
  `port ${busy.port} (${busy.label})` +
  (busy.owner ? ` — held by ${busy.owner.command}, pid ${busy.owner.pid}` : "");

export async function killPortOwner(busy) {
  if (!busy.owner?.pid) return false;
  try {
    process.kill(busy.owner.pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    if (await isPortFree(busy.port)) return true;
  }
  try {
    process.kill(busy.owner.pid, "SIGKILL");
  } catch {
    return false;
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  return isPortFree(busy.port);
}
