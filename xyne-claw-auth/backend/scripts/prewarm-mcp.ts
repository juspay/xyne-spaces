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
 * Best-effort: a failure to prewarm a single package does NOT fail the image
 * build — the runtime provisioner installs it on first use (and self-heals).
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

/** Derive the unique set of npx package specs from every stdio adapter. */
function collectNpxSpecs(): string[] {
  const specs = new Set<string>();
  for (const [type, adapter] of Object.entries(STATIC_ADAPTERS)) {
    if (adapter.transport !== "stdio") continue; // HTTP adapters have no package
    try {
      const { cmd, args } = adapter.buildCommand(placeholderCredentials(adapter));
      const spec = npxPackageSpec(cmd, args); // null for TS-source (node) launches
      if (spec) specs.add(spec);
    } catch (err) {
      console.warn(
        `[prewarm-mcp] could not derive package for "${type}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return [...specs];
}

async function main(): Promise<void> {
  const specs = collectNpxSpecs();
  console.log(`[prewarm-mcp] derived ${specs.length} npx package(s) from the adapter registry`);
  const results = await Promise.all(specs.map(async (spec) => ({ spec, ok: await prewarmSpec(spec) })));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).map((r) => r.spec);
  console.log(`[prewarm-mcp] done: ${ok}/${specs.length} provisioned.`);
  if (failed.length) {
    // Non-fatal: runtime provisioner installs these on first use.
    console.warn(`[prewarm-mcp] not prewarmed (will install at runtime): ${failed.join(", ")}`);
  }
}

// Never fail the build on a flaky registry — runtime self-heals.
main().catch((err) => {
  console.error("[prewarm-mcp] unexpected error (continuing):", err);
  process.exit(0);
});
