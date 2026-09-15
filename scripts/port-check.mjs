import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";

function lsofListening(port) {
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", timeout: 3000 },
    );
    if (result.error) return null;
    if (result.status === 0) return result.stdout.trim().length > 0;
    return false;
  } catch {
    return null;
  }
}

const connectAccepted = (port) =>
  new Promise((resolvePromise) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(700);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once("error", () => resolvePromise(false));
  });

export async function isPortFree(port) {
  const listening = lsofListening(port);
  if (listening !== null) return !listening;
  return !(await connectAccepted(port));
}

function ownerFromLsof(port) {
  try {
    const result = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fcp"],
      { encoding: "utf8", timeout: 3000 },
    );
    if (result.error || result.status !== 0 || !result.stdout) return null;
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

function ownerFromSs(port) {
  try {
    const result = spawnSync("ss", ["-ltnpH", `sport = :${port}`], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (result.error || result.status !== 0 || !result.stdout) return null;
    const match = result.stdout.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!match) return null;
    return { pid: Number(match[2]), command: match[1] };
  } catch {
    return null;
  }
}

function ownerFromNetstat(port) {
  try {
    const result = spawnSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.error || result.status !== 0 || !result.stdout) return null;
    const line = result.stdout
      .split(/\r?\n/)
      .find(
        (entry) =>
          /LISTENING/i.test(entry) &&
          new RegExp(`[:.]${port}\\s`).test(entry.trim().split(/\s+/)[1] + " "),
      );
    if (!line) return null;
    const pid = Number(line.trim().split(/\s+/).pop());
    if (!Number.isFinite(pid) || pid <= 0) return null;

    let command = "unknown";
    const tasklist = spawnSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", timeout: 5000 },
    );
    if (!tasklist.error && tasklist.status === 0 && tasklist.stdout) {
      const name = tasklist.stdout.match(/^"([^"]+)"/);
      if (name) command = name[1];
    }
    return { pid, command };
  } catch {
    return null;
  }
}

export function describePortOwner(port) {
  if (process.platform === "win32") return ownerFromNetstat(port);
  return ownerFromLsof(port) ?? ownerFromSs(port);
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
