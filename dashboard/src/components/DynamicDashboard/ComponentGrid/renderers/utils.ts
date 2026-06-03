export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function formatTimeTick(value: string | number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
      }).format(asDate);
    }
  }
  return String(value);
}

export function formatX(x: string | number | Date): string {
  if (x instanceof Date) return x.toISOString();
  return String(x);
}

export function defaultLegendLabel(title?: string): string {
  return title?.trim() || 'value';
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  switch (typeof v) {
    case 'string':
      return v;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(v);
    default:
      return JSON.stringify(v);
  }
}

export function humanize(key: string, label: string): string {
  const src = label && label !== key ? label : key;
  return src
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
