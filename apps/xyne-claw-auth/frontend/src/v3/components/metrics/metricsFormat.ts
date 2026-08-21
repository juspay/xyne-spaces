/**
 * Number formatting shared by the metrics panels.
 *
 * Split out of MetricsPageV3 so the deep panels format identically to the
 * original cards — a duration rendered "1.2s" in one card and "1200ms" in the
 * next reads as two different measurements.
 *
 * `formatOptionalPct` exists for the one rule these panels cannot break:
 * a null rate means UNKNOWN and must never render as 0%.
 */

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A rate that may legitimately be unknown.
 *
 * Renders null as "n/a", never "0.0%". For cite rate a null denominator means
 * "nothing was citeable" — not "nothing was cited" — and must not read as a
 * failure for tools that can never be cited in the first place.
 */
export function formatOptionalPct(value: number | null | undefined): string {
  return value == null ? "n/a" : formatPct(value);
}

/** Whole counts with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

/** Compact magnitudes — 12.4k, 3.1M. Keeps wide numeric columns narrow. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 1000) return String(Math.round(value));
  if (Math.abs(value) < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Bytes as KB/MB — tool result payload sizes. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
