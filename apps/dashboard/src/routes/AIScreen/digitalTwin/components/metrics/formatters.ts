export const formatMs = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
};

export const formatPct = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

export interface MetricDelta {
  label: string;
  tone: 'good' | 'bad' | 'flat';
}

export const formatSignedMs = (ms: number | null | undefined): MetricDelta => {
  if (ms === null || ms === undefined) return { label: '—', tone: 'flat' };
  if (Math.abs(ms) < 50) return { label: '≈0', tone: 'flat' };
  return {
    label: `${ms > 0 ? '+' : ''}${formatMs(Math.abs(ms))} ${ms > 0 ? 'slower' : 'faster'}`,
    tone: ms > 0 ? 'bad' : 'good',
  };
};

export const formatSignedPct = (value: number | null | undefined): MetricDelta => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { label: '—', tone: 'flat' };
  }
  if (Math.abs(value) < 0.001) return { label: '≈0', tone: 'flat' };
  return {
    label: `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}pp`,
    tone: value > 0 ? 'bad' : 'good',
  };
};
