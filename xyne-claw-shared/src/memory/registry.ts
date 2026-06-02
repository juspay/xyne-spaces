/**
 * Memory-provider registry + factory.
 *
 * Default provider is selected via the MEMORY_PROVIDER env var, defaulting
 * to "hindsight". Per-agent overrides go through getMemoryProvider(name).
 *
 * Providers register themselves at module load time. Custom backends can
 * register at app startup before any memory operations run.
 */

import type { MemoryProvider } from "./types.js";
import { HindsightProvider } from "./providers/hindsight.js";
import { StubMemoryProvider } from "./providers/stub.js";

type ProviderFactory = () => MemoryProvider;

const factories = new Map<string, ProviderFactory>();
const instances = new Map<string, MemoryProvider>();

/** Register a provider factory. Called at module init for built-ins. */
export function registerMemoryProvider(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
  // If we already instantiated this name, drop the cached instance so the
  // re-registration takes effect on the next get.
  instances.delete(name);
}

/** List all registered provider names. */
export function listMemoryProviders(): string[] {
  return Array.from(factories.keys());
}

/**
 * Get a provider instance. Caches one instance per provider name.
 *
 * @param name  Provider name. Defaults to MEMORY_PROVIDER env var, then "hindsight".
 */
export function getMemoryProvider(name?: string): MemoryProvider {
  const providerName = name ?? process.env["MEMORY_PROVIDER"] ?? "hindsight";

  const cached = instances.get(providerName);
  if (cached) return cached;

  const factory = factories.get(providerName);
  if (!factory) {
    throw new Error(
      `Unknown memory provider "${providerName}". Registered: ${listMemoryProviders().join(", ") || "(none)"}`,
    );
  }
  const instance = factory();
  instances.set(providerName, instance);
  return instance;
}

/** Test helper: clear instance cache so factories run again. */
export function resetMemoryProviderCache(): void {
  instances.clear();
}

// ── Built-in registrations ─────────────────────────────────────────────────

registerMemoryProvider("hindsight", () =>
  new HindsightProvider({
    url: process.env["HINDSIGHT_URL"] ?? "",
    tenant: process.env["HINDSIGHT_TENANT"] ?? "default",
    apiKey: process.env["HINDSIGHT_API_KEY"] ?? "",
  }),
);

registerMemoryProvider("stub", () => new StubMemoryProvider());
