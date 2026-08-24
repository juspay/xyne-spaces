#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  findBusyPorts,
  formatBusyPort,
  killPortOwner,
} from "./port-check.mjs";
import { printXyneBanner, releaseXyneBanner } from "./xyne-banner.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = join(repoRoot, ".xyne");
const selectionFile = join(stateDirectory, "dev-apps.json");
const featuresFile = join(stateDirectory, "features.json");
const mprocsConfigFile = join(stateDirectory, "mprocs.yaml");

export const APPS = [
  {
    id: "dashboard",
    filter: "xyne-spaces-dashboard",
    script: "dev",
    hint: "web UI · http://localhost:5173",
    color: "green",
    core: true,
    port: 5173,
  },
  {
    id: "backend",
    filter: "xyne-spaces-backend",
    script: "dev",
    hint: "API server · http://localhost:3001",
    color: "blue",
    core: true,
    port: 3001,
  },
  {
    id: "worker",
    filter: "xyne-spaces-backend",
    script: "dev:worker",
    hint: "background jobs",
    color: "cyan",
    core: true,
  },
  {
    id: "claw",
    filter: "xyne-claw",
    script: "dev",
    hint: "AI agents",
    color: "yellow",
    feature: "claw",
    port: 3002,
  },
  {
    id: "auth",
    filter: "xyne-claw-auth",
    script: "dev",
    hint: "claw auth backend",
    color: "magenta",
    feature: "claw",
    port: 3003,
  },
  {
    id: "auth-ui",
    filter: "xyne-claw-auth-ui",
    script: "dev",
    hint: "claw auth frontend",
    color: "red",
    feature: "claw",
    port: 5174,
  },
  // Reached through the main dashboard on 5173, which proxies /sdlc-app,
  // /sdlc-api and /sdlc-zero to them.
  {
    id: "sdlc-backend",
    filter: "xyne-spaces-backend",
    script: "dev:sdlc",
    hint: "SDLC API server · http://localhost:3011",
    color: "yellow",
    feature: "sdlc",
    port: 3011,
  },
  {
    id: "sdlc-dashboard",
    filter: "xyne-spaces-dashboard",
    script: "dev:sdlc",
    hint: "SDLC web UI · http://localhost:5173/sdlc-app/",
    color: "magenta",
    feature: "sdlc",
    port: 5175,
  },
];

const appIds = APPS.map((app) => app.id);
const coreIds = APPS.filter((app) => app.core).map((app) => app.id);
// The SDLC lane. Not in the infra feature picker — that one chooses docker
// containers and this lane needs none. See docs/sdlc-fast-lane.md.
const sdlcIds = APPS.filter((app) => app.feature === "sdlc").map((app) => app.id);

const commandFor = (app) => `pnpm --filter ${app.filter} ${app.script}`;

export function parseAppSpec(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "all") return [...appIds];
  const requested = trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unknown = requested.filter((entry) => !appIds.includes(entry));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown app${unknown.length === 1 ? "" : "s"} in XYNE_DEV_APPS: ` +
        `${unknown.join(", ")} (valid: all, ${appIds.join(", ")})`,
    );
  }
  return appIds.filter((id) => requested.includes(id));
}

export function initialSelection(saved, features) {
  const validSaved = Array.isArray(saved)
    ? appIds.filter((id) => saved.includes(id))
    : [];
  if (validSaved.length > 0) return validSaved;
  const enabledFeatures = Array.isArray(features) ? features : [];
  return APPS.filter(
    (app) => app.core || (app.feature && enabledFeatures.includes(app.feature)),
  ).map((app) => app.id);
}

export function buildMprocsYaml(ids) {
  const lines = ["procs:"];
  for (const app of APPS) {
    if (!ids.includes(app.id)) continue;
    lines.push(`  ${app.id}:`);
    lines.push(`    shell: "${commandFor(app)}"`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildConcurrentlyArgs(ids) {
  const selected = APPS.filter((app) => ids.includes(app.id));
  return [
    "exec",
    "concurrently",
    "--names",
    selected.map((app) => app.id).join(","),
    "--prefix-colors",
    selected.map((app) => app.color).join(","),
    "--kill-others",
    "--kill-signal",
    "SIGTERM",
    "--kill-timeout",
    "5000",
    ...selected.map((app) => commandFor(app)),
  ];
}

export function devPortEntries(ids) {
  return APPS.filter((app) => ids.includes(app.id) && app.port).map((app) => ({
    port: app.port,
    label: app.id,
  }));
}

async function resolvePortConflicts(selection, interactive) {
  let busy = await findBusyPorts(devPortEntries(selection));
  if (busy.length === 0) return true;

  if (!interactive || !canUseModule("@clack/prompts")) {
    for (const conflict of busy) {
      console.warn(`⚠️  ${formatBusyPort(conflict)} — that app will fail to bind.`);
    }
    return true;
  }

  const clack = await import("@clack/prompts");
  while (busy.length > 0) {
    for (const conflict of busy) clack.log.warn(formatBusyPort(conflict));
    const choice = await clack.select({
      message: `${busy.length} port${busy.length === 1 ? " is" : "s are"} already in use. What now?`,
      options: [
        {
          value: "kill",
          label: "Stop those processes and continue",
          hint: "SIGTERM, then SIGKILL if needed",
        },
        {
          value: "continue",
          label: "Continue anyway",
          hint: "the affected apps will fail to bind",
        },
        { value: "abort", label: "Abort", hint: "nothing started" },
      ],
    });
    if (clack.isCancel(choice) || choice === "abort") {
      clack.cancel("Aborted — nothing started.");
      return false;
    }
    if (choice === "continue") return true;

    for (const conflict of busy) {
      if (!conflict.owner) {
        clack.log.error(
          `Cannot stop the holder of port ${conflict.port} — owner unknown. Free it manually.`,
        );
        continue;
      }
      const freed = await killPortOwner(conflict);
      clack.log[freed ? "success" : "error"](
        freed
          ? `Freed port ${conflict.port} (stopped ${conflict.owner.command})`
          : `Port ${conflict.port} is still busy — stop pid ${conflict.owner.pid} manually.`,
      );
    }
    busy = await findBusyPorts(devPortEntries(selection));
  }
  return true;
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch {}
}

const quoteForShell = (argument) =>
  process.platform === "win32" && /\s/.test(argument)
    ? `"${argument}"`
    : argument;

function runPnpm(args) {
  return new Promise((resolvePromise) => {
    const child = spawn("pnpm", args.map(quoteForShell), {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    const forward = (signal) => () => {
      try {
        child.kill(signal);
      } catch {}
    };
    const handlers = [
      ["SIGINT", forward("SIGINT")],
      ["SIGTERM", forward("SIGTERM")],
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);
    child.on("close", (code, signal) => {
      for (const [name, handler] of handlers) process.off(name, handler);
      resolvePromise(signal ? 130 : (code ?? 1));
    });
    child.on("error", (error) => {
      for (const [name, handler] of handlers) process.off(name, handler);
      console.error(`Unable to start pnpm: ${error.message}`);
      resolvePromise(127);
    });
  });
}

const canUseModule = (specifier) => {
  try {
    return import.meta.resolve(specifier) !== undefined;
  } catch {
    return false;
  }
};

async function promptForApps(initial) {
  const clack = await import("@clack/prompts");
  await printXyneBanner("dev processes");
  clack.intro("Xyne Spaces — dev processes");

  const saved = readJson(selectionFile)?.apps;
  const hasSaved = Array.isArray(saved) && saved.length > 0;
  const presetOptions = [];
  if (hasSaved) {
    presetOptions.push({
      value: "last",
      label: "Same as last time",
      hint: initial.join(", "),
    });
  }
  presetOptions.push(
    { value: "all", label: "Everything", hint: appIds.join(", ") },
    { value: "core", label: "Core", hint: coreIds.join(", ") },
    {
      value: "core+sdlc",
      label: "Core + SDLC lane",
      hint: [...coreIds, ...sdlcIds].join(", "),
    },
    { value: "custom", label: "Pick apps", hint: "choose exactly what runs" },
  );

  const preset = await clack.select({
    message: "Which apps do you want to run?",
    options: presetOptions,
  });
  if (clack.isCancel(preset)) {
    clack.cancel("Cancelled — nothing started.");
    return null;
  }
  if (preset === "last") return initial;
  if (preset === "all") return [...appIds];
  if (preset === "core") return [...coreIds];
  if (preset === "core+sdlc") return appIds.filter((id) => [...coreIds, ...sdlcIds].includes(id));

  const picked = await clack.multiselect({
    message: "Select apps (space to toggle, enter to confirm)",
    options: [
      { value: "__all__", label: "All apps", hint: "select everything below" },
      ...APPS.map((app) => ({
        value: app.id,
        label: app.id,
        hint: app.hint,
      })),
    ],
    initialValues: initial,
    required: true,
  });
  if (clack.isCancel(picked)) {
    clack.cancel("Cancelled — nothing started.");
    return null;
  }
  const chosen = picked.includes("__all__")
    ? [...appIds]
    : appIds.filter((id) => picked.includes(id));
  clack.outro(`Starting: ${chosen.join(", ")}`);
  return chosen;
}

async function main() {
  const argv = process.argv.slice(2);
  const wantsAll = argv.includes("--all");
  const wantsPlain = argv.includes("--plain");

  let selection = null;
  try {
    selection = parseAppSpec(process.env.XYNE_DEV_APPS);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (!selection && wantsAll) selection = [...appIds];

  const interactive =
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI;

  if (!selection) {
    const initial = initialSelection(
      readJson(selectionFile)?.apps,
      readJson(featuresFile)?.features,
    );
    if (interactive && canUseModule("@clack/prompts")) {
      selection = await promptForApps(initial);
      if (selection === null) return 130;
      writeJson(selectionFile, { apps: selection });
    } else {
      if (interactive) {
        console.warn(
          "@clack/prompts is not installed — run `pnpm install`, starting all apps.",
        );
      }
      selection = [...appIds];
    }
  }

  const proceed = await resolvePortConflicts(selection, interactive);
  if (!proceed) return 130;

  const useTui =
    interactive && !wantsPlain && canUseModule("mprocs/package.json");
  if (!useTui) {
    if (interactive && !wantsPlain) {
      console.warn("mprocs is not installed — run `pnpm install`. Falling back to concurrently.");
    }
    releaseXyneBanner();
    return runPnpm(buildConcurrentlyArgs(selection));
  }

  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(mprocsConfigFile, buildMprocsYaml(selection));
  console.log(
    "Opening the process TUI — ↑/↓ switch, r restart, x stop, s start, z zoom, Ctrl-a type into a process, q quit all.",
  );
  releaseXyneBanner();
  return runPnpm(["exec", "mprocs", "--config", join(".xyne", "mprocs.yaml")]);
}

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  process.exitCode = await main();
}
