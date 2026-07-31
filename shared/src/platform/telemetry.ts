/**
 * Optional telemetry/logging interface for shared hooks and providers.
 * Each app can provide its own implementation (OpenTelemetry, Mixpanel, etc.)
 * or omit it for no-op behavior.
 */
export interface TelemetryProvider {
  recordLatency(
    name: string,
    durationMs: number,
    attributes?: Record<string, string>,
  ): void;
  incrementCounter(name: string, attributes?: Record<string, string>): void;
  log(
    level: 'info' | 'warn' | 'error',
    event: string,
    data?: Record<string, unknown>,
  ): void;
}
