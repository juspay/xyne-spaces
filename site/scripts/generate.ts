import { OpenGraphGenerator } from "./generators/opengraph";
import { log } from "@clack/prompts";
import pc from "picocolors";

const generators = {
  opengraph: OpenGraphGenerator,
};

type GeneratorName = keyof typeof generators;

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const verbose = flags.has("--verbose") || flags.has("--debug");

  const info = (message: string) => log.info(message);
  const debug = (message: string) => {
    if (verbose) log.message(pc.dim(message));
  };

  const generatorNames = args.filter(
    (arg) => !arg.startsWith("--"),
  ) as GeneratorName[];

  debug(`argv: ${pc.dim(process.argv.join(" "))}`);
  debug(`args: ${pc.dim(args.join(" "))}`);

  if (flags.has("--help")) {
    info(
      [
        `${pc.bold("Usage")}: pnpm generate [generator...] [--verbose]`,
        "",
        `${pc.bold("Generators")}: ${Object.keys(generators).join(", ")}`,
        "",
        `${pc.bold("Examples")}:`,
        `  pnpm generate`,
        `  pnpm generate opengraph --verbose`,
      ].join("\n"),
    );
    return;
  }

  // Default to build-time generators if none specified (excluding TTS)
  const toRun =
    generatorNames.length > 0
      ? generatorNames
      : (["opengraph"] as GeneratorName[]);

  info(
    `${pc.bold("Generators")} ${pc.dim(
      `(${toRun.length})`,
    )}: ${toRun.map((n) => pc.cyan(n)).join(pc.dim(", "))}`,
  );

  // Validate generator names
  for (const name of toRun) {
    if (!generators[name]) {
      log.error(`Unknown generator: ${pc.bold(String(name))}`);
      log.info(`Available: ${Object.keys(generators).join(", ")}`);
      process.exit(1);
    }
  }

  // Run generators
  const totalStart = performance.now();
  for (const name of toRun) {
    const GeneratorClass = generators[name];
    const generator = new GeneratorClass();

    const start = performance.now();
    info(`${pc.dim("Starting")} ${pc.bold(String(name))}...`);
    await generator.run();
    const end = performance.now();
    log.success(
      `${pc.bold(String(name))} completed ${pc.dim(
        `in ${formatDuration(end - start)}`,
      )}`,
    );
  }

  log.success(
    `${pc.bold("All generators completed")} ${pc.dim(
      `in ${formatDuration(performance.now() - totalStart)}`,
    )}`,
  );
}

main().catch((error) => {
  log.error(pc.bold("Fatal error"));
  if (error instanceof Error) {
    log.message(error.stack ? error.stack : error.message);
  } else {
    log.message(String(error));
  }
  process.exit(1);
});
