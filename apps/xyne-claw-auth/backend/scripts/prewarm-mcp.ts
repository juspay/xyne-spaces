/**
 * Build-time prewarm for npx-launched MCP servers.
 *
 * Runs the SAME provisioner used at runtime (src/mcp/provision.ts) over every
 * npx-based stdio adapter, so the image ships with a fully-installed,
 * integrity-checked, immutable store. At request time these servers launch as
 * `node <entrypoint>` with zero network fetch and zero shared-cache race.
 *
 * The package list is DERIVED from the adapter registry — not hand-maintained.
 * Each adapter's `buildCommand()` is invoked with placeholder credentials (the
 * creds only affect runtime env/args, never which package gets installed), and
 * the npx package spec is pulled out of the resulting command. Add a new stdio
 * adapter and it gets prewarmed automatically.
 *
 * Prod can't install anything at runtime (read-only root filesystem, and the
 * egress proxy doesn't allow the npm registry), so the image is the only place
 * these servers come from. Servers in REQUIRED must install, or the build
 * fails; the rest are best-effort (some adapters point at packages that no
 * longer exist on npm).
 * Run with: `node --import tsx/esm scripts/prewarm-mcp.ts`
 */
import { STATIC_ADAPTERS } from "../src/mcp/static-adapters.js";
import { npxPackageSpec, prewarmSpec } from "../src/mcp/provision.js";
import type { StdioMcpAdapter } from "../src/mcp/types.js";

/** Synthesize placeholder credentials so buildCommand() doesn't choke on
 *  undefined required fields (e.g. an adapter that writes a key file). */
function placeholderCredentials(adapter: StdioMcpAdapter): Record<string, unknown> {
  const creds: Record<string, unknown> = {};
  // "{}" is both a non-empty string and valid JSON, so it satisfies adapters
  // that just embed the value AND adapters that JSON.parse a key field
  // (e.g. bigquery) — neither matters for which package gets installed.
  for (const field of adapter.credentialFields ?? []) creds[field.name] = "{}";
  return creds;
}

/** Adapter types whose server must be in the image: the build fails without them. */
const REQUIRED = new Set(["github"]);

/** Derive the unique set of npx package specs from every stdio adapter, and which are required. */
function collectNpxSpecs(): { specs: string[]; required: Set<string> } {
  const specs = new Set<string>();
  const required = new Set<string>();
  const found = new Set<string>();
  for (const [type, adapter] of Object.entries(STATIC_ADAPTERS)) {
    if (adapter.transport !== "stdio") continue; // HTTP adapters have no package
    try {
      const { cmd, args } = adapter.buildCommand(placeholderCredentials(adapter));
      const spec = npxPackageSpec(cmd, args); // null for TS-source (node) launches
      if (spec) specs.add(spec);
      if (spec && REQUIRED.has(type)) {
        required.add(spec);
        found.add(type);
      }
    } catch (err) {
      console.warn(
        `[prewarm-mcp] could not derive package for "${type}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  for (const type of REQUIRED) {
    if (!found.has(type)) throw new Error(`required adapter "${type}" has no npx package to prewarm`);
  }
  return { specs: [...specs], required };
}

async function main(): Promise<void> {
  const { specs, required } = collectNpxSpecs();
  console.log(`[prewarm-mcp] derived ${specs.length} npx package(s) from the adapter registry`);
  const results = await Promise.all(specs.map(async (spec) => ({ spec, ok: await prewarmSpec(spec) })));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => r.spec);
  console.log(`[prewarm-mcp] done: ${ok}/${specs.length} provisioned.`);
  if (failed.length) {
    console.warn(`[prewarm-mcp] not prewarmed (unavailable in prod): ${failed.join(", ")}`);
  }
  const missing = failed.filter((spec) => required.has(spec));
  if (missing.length) {
    console.error(`[prewarm-mcp] required server(s) not prewarmed: ${missing.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[prewarm-mcp] failed:", err);
  process.exit(1);
});
