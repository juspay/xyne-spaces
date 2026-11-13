/**
 * Type-safe service registry.
 *
 * TServiceMap defines the contract between the host and the engine:
 *
 * ```typescript
 * interface MyServices {
 *   conversationService: ConversationService;
 *   db: Database;
 * }
 *
 * const reg = new ServiceRegistry<MyServices>();
 * reg.register('conversationService', myConvService);  // type-checked
 * reg.get('conversationService');                        // returns ConversationService
 * ```
 *
 * The default `Record<string, unknown>` allows untyped usage for generic engine
 * code that doesn't need to know about specific services.
 */
export class ServiceRegistry<
  TServiceMap extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly providers = new Map<string, unknown>();

  /**
   * Register a service provider. Name and type are validated against TServiceMap
   * at compile time.
   */
  register<K extends keyof TServiceMap & string>(
    name: K,
    provider: TServiceMap[K],
  ): void {
    if (this.providers.has(name)) {
      throw new Error(
        `Service "${name}" is already registered. Call replace() to overwrite.`,
      );
    }
    this.providers.set(name, provider);
  }

  /**
   * Replace an existing service. Useful for testing or hot-reload scenarios.
   * Throws if the service was never registered — use register() first.
   */
  replace<K extends keyof TServiceMap & string>(
    name: K,
    provider: TServiceMap[K],
  ): void {
    if (!this.providers.has(name)) {
      throw new Error(
        `Service "${name}" is not registered. Call register() first.`,
      );
    }
    this.providers.set(name, provider);
  }

  /**
   * Retrieve a service by name. Return type is inferred from TServiceMap.
   * Throws if the service is not registered.
   */
  get<K extends keyof TServiceMap & string>(name: K): TServiceMap[K] {
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new Error(
        `Service "${name}" is not registered. Available: [${[...this.providers.keys()].join(', ')}]`,
      );
    }
    return provider as TServiceMap[K];
  }

  /** Check if a service is registered. */
  has<K extends keyof TServiceMap & string>(name: K): boolean {
    return this.providers.has(name);
  }

  /**
   * Validate that all required services are registered.
   * Call this at startup to fail fast if a step's requiredServices are missing.
   */
  assertRegistered(names: readonly string[]): void {
    const missing = names.filter((n) => !this.providers.has(n));
    if (missing.length > 0) {
      throw new Error(`Missing required services: ${missing.join(', ')}`);
    }
  }

  /** Number of registered services. */
  get size(): number {
    return this.providers.size;
  }

  /** All registered service names. */
  keys(): IterableIterator<string> {
    return this.providers.keys();
  }
}
