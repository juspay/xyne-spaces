import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { rotationVariantNames, type RepoConfigMap } from "xyne-claw-shared";
import { createLogger } from "../logger.js";

const log = createLogger("sandbox-templates");

// The image COPYs claw-deployments/kata-infra (private overlay in CI; 3 files in a public build).
const KATA_INFRA_DIR = fileURLToPath(new URL("../../../../../claw-deployments/kata-infra", import.meta.url));

let deployed: Promise<string[]> | null = null;

async function yamlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return yamlFiles(path);
      return Promise.resolve(/\.ya?ml$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

/** SandboxTemplate names under kata-infra, minus rotation variants (the tools pick those). */
export async function readDeployedTemplateNames(dir = KATA_INFRA_DIR): Promise<string[]> {
  const rotated = new Set(rotationVariantNames());
  const names = new Set<string>();
  for (const file of await yamlFiles(dir)) {
    for (const doc of parseAllDocuments(await readFile(file, "utf8"))) {
      const value = doc.toJS() as { kind?: unknown; metadata?: { name?: unknown } } | null;
      const name = value?.metadata?.name;
      if (value?.kind === "SandboxTemplate" && typeof name === "string" && !rotated.has(name)) names.add(name);
    }
  }
  return [...names];
}

/** Deployed templates plus any a profile already uses, so the list works without the folder. */
export async function listSandboxTemplates(configs: RepoConfigMap): Promise<string[]> {
  deployed ??= readDeployedTemplateNames().catch((err: unknown) => {
    log.warn(`[sandbox-templates] could not read ${KATA_INFRA_DIR}: ${String(err)}`);
    return [];
  });
  const names = new Set([...(await deployed), ...Object.values(configs).map((config) => config.template)]);
  return [...names].sort();
}
