// ── shared color utilities ───────────────────────────────────────────
export const ICON_COLORS: Record<string, string> = {
  spaces: "#e44d26",
  bitbucket: "#0052cc",
  github: "#24292e",
  gitlab: "#fc6d26",
  google: "#4285f4",
  microsoft: "#00a4ef",
  grafana: "#f46800",
  deepwiki: "#7c3aed",
  context7: "#059669",
  sandbox: "#6366f1",
  pgm: "#db2777",
};

export function toolColor(name: string): string {
  return ICON_COLORS[name.toLowerCase()] ?? "#71717a";
}

// ── time helpers ─────────────────────────────────────────────────────
export function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function dur(start: string, end: string | null): string {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
