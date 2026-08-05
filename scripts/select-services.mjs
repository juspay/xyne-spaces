import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findBusyPorts, formatBusyPort } from "./port-check.mjs";
import { printXyneBanner } from "./xyne-banner.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = join(repoRoot, ".xyne");
const featuresFile = join(stateDirectory, "features.json");

export const FEATURES = [
  { id: "claw", number: 2, label: "Xyne-Claw", hint: "AI agents — no extra container" },
  { id: "canvas", number: 3, label: "Canvas", hint: "y-sweet collaborative editing" },
  { id: "calls", number: 4, label: "Calls", hint: "livekit" },
  { id: "transcription", number: 5, label: "Transcription", hint: "transcription-agent" },
  { id: "recording", number: 6, label: "Call Recording", hint: "livekit-egress" },
  { id: "search", number: 7, label: "Search", hint: "vespa full-text search" },
  { id: "observability", number: 8, label: "Observability", hint: "otel-collector, victoriametrics, grafana" },
  { id: "flags", number: 9, label: "Feature Flags", hint: "superposition" },
];

const featureIds = FEATURES.map((feature) => feature.id);

export function featuresToNumbers(ids) {
  const numbers = FEATURES.filter((feature) => ids.includes(feature.id)).map(
    (feature) => feature.number,
  );
  return ["1", ...numbers].join(",");
}

export const parseFeatureNumbers = (value) =>
  (value ?? "")
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter(Number.isFinite);

const envPort = (name, fallback) => Number(process.env[name] ?? fallback);

export function servicePortEntries(numbers) {
  const has = (n) => numbers.includes(n);
  const entries = [
    { port: envPort("POSTGRES_BIND_PORT", 5433), label: "postgres" },
    { port: envPort("REDIS_BIND_PORT", 6379), label: "redis" },
    { port: envPort("ZERO_BIND_PORT_1", 4848), label: "zero-cache" },
    { port: envPort("ZERO_BIND_PORT_2", 4849), label: "zero-cache" },
    { port: envPort("FAKE_GCS_BIND_PORT", 4443), label: "fake-gcs" },
    { port: envPort("MINIO_API_BIND_PORT", 9000), label: "minio" },
    { port: envPort("MINIO_CONSOLE_BIND_PORT", 9001), label: "minio console" },
  ];
  if (has(3)) {
    entries.push({ port: envPort("YSWEET_BIND_PORT", 8080), label: "y-sweet" });
  }
  if (has(4) || has(6)) {
    entries.push(
      { port: envPort("LIVEKIT_HTTP_BIND_PORT", 7880), label: "livekit" },
      { port: envPort("LIVEKIT_HTTPS_BIND_PORT", 7881), label: "livekit" },
    );
  }
  if (has(5)) {
    entries.push({
      port: envPort("TRANSCRIPTION_AGENT_BIND_PORT", 8001),
      label: "transcription-agent",
    });
  }
  if (has(7)) {
    entries.push({ port: envPort("VESPA_FEED_PORT", 8083), label: "vespa" });
  }
  if (has(8)) {
    entries.push(
      { port: envPort("OTEL_HTTP_BIND_PORT", 4318), label: "otel-collector" },
      { port: envPort("OTEL_GRPC_BIND_PORT", 4317), label: "otel-collector" },
      { port: envPort("VICTORIAMETRICS_BIND_PORT", 8428), label: "victoriametrics" },
      { port: envPort("GRAFANA_BIND_PORT", 3333), label: "grafana" },
    );
  }
  if (has(9)) {
    entries.push({
      port: envPort("SUPERPOSITION_BIND_PORT", 9999),
      label: "superposition",
    });
  }
  return entries;
}

function stackAlreadyRunning() {
  const runners = [
    ["docker", "compose"],
    ["podman", "compose"],
    ["podman-compose"],
  ];
  for (const runner of runners) {
    try {
      const result = spawnSync(
        runner[0],
        [...runner.slice(1), "-f", "docker-compose.dev.yml", "ps", "-q"],
        { cwd: repoRoot, encoding: "utf8", timeout: 10000 },
      );
      if (result.status === 0) return result.stdout.trim().length > 0;
    } catch {}
  }
  return false;
}

async function checkServicePorts(numbers, interactive) {
  if (stackAlreadyRunning()) return true;
  const busy = await findBusyPorts(servicePortEntries(numbers));
  if (busy.length === 0) return true;

  const hint =
    "If these belong to another Xyne checkout or a local postgres/redis, stop " +
    "them first, or point the container at a free port with the *_BIND_PORT " +
    "variables from docker-compose.dev.yml.";

  if (!interactive || !canUseModule("@clack/prompts")) {
    for (const conflict of busy) console.warn(`⚠️  ${formatBusyPort(conflict)}`);
    console.warn(`   ${hint}`);
    return true;
  }

  const clack = await import("@clack/prompts");
  for (const conflict of busy) clack.log.warn(formatBusyPort(conflict));
  clack.log.info(hint);
  const choice = await clack.select({
    message: `${busy.length} port${busy.length === 1 ? " is" : "s are"} already in use. What now?`,
    options: [
      {
        value: "continue",
        label: "Continue anyway",
        hint: "conflicting containers will fail to start",
      },
      { value: "abort", label: "Abort", hint: "no services started" },
    ],
  });
  if (clack.isCancel(choice) || choice === "abort") {
    clack.cancel("Aborted — no services started.");
    return false;
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

function runStartServices(environment) {
  return new Promise((resolvePromise) => {
    const child = spawn("bash", [join("scripts", "start-services.sh")], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...environment },
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
      console.error(`Unable to start start-services.sh: ${error.message}`);
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

async function promptForFeatures() {
  const clack = await import("@clack/prompts");
  await printXyneBanner("infrastructure");
  clack.intro("Xyne Spaces — infrastructure");
  clack.log.info("Chat & Tickets always runs: postgres, redis, zero-cache, fake-gcs, minio.");

  const saved = readJson(featuresFile)?.features;
  const initial = Array.isArray(saved)
    ? featureIds.filter((id) => saved.includes(id))
    : [];

  const presetOptions = [];
  if (initial.length > 0) {
    presetOptions.push({
      value: "last",
      label: "Same as last time",
      hint: initial.join(", "),
    });
  }
  presetOptions.push(
    { value: "all", label: "Everything", hint: "all features and containers" },
    { value: "core", label: "Core", hint: "Chat & Tickets only" },
    { value: "custom", label: "Pick features", hint: "choose what to start" },
  );

  const preset = await clack.select({
    message: "Which features do you need?",
    options: presetOptions,
  });
  if (clack.isCancel(preset)) {
    clack.cancel("Cancelled — no services started.");
    return null;
  }
  if (preset === "last") return initial;
  if (preset === "all") return [...featureIds];
  if (preset === "core") return [];

  const picked = await clack.multiselect({
    message: "Select features (space to toggle, enter to confirm)",
    options: [
      { value: "__all__", label: "All features", hint: "select everything below" },
      ...FEATURES.map((feature) => ({
        value: feature.id,
        label: feature.label,
        hint: feature.hint,
      })),
    ],
    initialValues: initial,
    required: false,
  });
  if (clack.isCancel(picked)) {
    clack.cancel("Cancelled — no services started.");
    return null;
  }
  const chosen = picked.includes("__all__")
    ? [...featureIds]
    : featureIds.filter((id) => picked.includes(id));
  clack.outro(
    chosen.length > 0
      ? `Starting Chat & Tickets + ${chosen.join(", ")}`
      : "Starting Chat & Tickets only",
  );
  return chosen;
}

async function main() {
  if (process.env.XYNE_FEATURES || process.stdin.isTTY !== true || process.env.CI) {
    const numbers = process.env.XYNE_FEATURES
      ? parseFeatureNumbers(process.env.XYNE_FEATURES)
      : [1];
    await checkServicePorts(numbers, false);
    return runStartServices({});
  }
  if (!canUseModule("@clack/prompts")) {
    return runStartServices({});
  }

  const selection = await promptForFeatures();
  if (selection === null) return 130;
  writeJson(featuresFile, { features: selection });
  const numbersValue = featuresToNumbers(selection);
  const portsOk = await checkServicePorts(
    parseFeatureNumbers(numbersValue),
    true,
  );
  if (!portsOk) return 130;
  return runStartServices({ XYNE_FEATURES: numbersValue });
}

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  process.exitCode = await main();
}
