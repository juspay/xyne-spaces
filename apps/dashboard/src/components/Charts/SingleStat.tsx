import React from 'react';
import { formatLatency } from './chartUtils';

interface SingleStatProps {
  metric: string;
  value: string | number;
  className?: string;
  style?: React.CSSProperties;
}

function formatMetricName(metric: string): string {
  return metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(metric: string, value: string | number): string {
  if (value === null || value === undefined || value === '') return 'N/A';

  let numValue: number;
  if (typeof value === 'string') {
    const clean = value.replace(/[^0-9.-]/g, '');
    numValue = parseFloat(clean);
  } else {
    numValue = value;
  }

  if (isNaN(numValue)) return String(value);

  const m = metric.toLowerCase();
  if (m.includes('rate') || m.includes('percentage') || m.includes('percent')) {
    return `${numValue}%`;
  }
  if (m.includes('latency') || m.includes('time') || m.includes('duration')) {
    return formatLatency(numValue);
  }
  if (
    m.includes('volume') ||
    m.includes('count') ||
    m.includes('amount') ||
    m.includes('total') ||
    m.includes('transaction') ||
    m.includes('order') ||
    m.includes('number') ||
    m.includes('quantity')
  ) {
    if (numValue >= 10000000) return `${(numValue / 10000000).toFixed(1)} Cr`;
    if (numValue >= 100000) return `${(numValue / 100000).toFixed(1)} L`;
    if (numValue >= 1000) return `${(numValue / 1000).toFixed(1)} K`;
    if (numValue % 1 !== 0) return numValue.toFixed(2);
    return numValue.toLocaleString('en-IN');
  }
  return String(numValue);
}

const SingleStat: React.FC<SingleStatProps> = ({ metric, value, className, style }) => {
  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 shadow-sm${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className='text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1'>
        {formatMetricName(metric)}
      </div>
      <div className='text-2xl font-normal text-foreground'>{formatValue(metric, value)}</div>
    </div>
  );
};

export default SingleStat;
