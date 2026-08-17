import React from 'react';
import { Badge } from '../../ui/Badge';

type LogLevel = 'error' | 'warning' | 'info';

const VARIANT_BY_LEVEL: Record<LogLevel, 'destructive' | 'outline' | 'secondary'> = {
  error: 'destructive',
  warning: 'outline',
  info: 'secondary',
};

function detectLogLevel(text: string): LogLevel {
  const lower = text.toLowerCase();
  if (/\berrors?\b/.test(lower)) return 'error';
  if (/\bwarn(ings?)?\b/.test(lower)) return 'warning';
  return 'info';
}

export function LogLevelBadge({
  text,
  className,
}: {
  text: string;
  className?: string;
}): React.ReactElement {
  const level = detectLogLevel(text);
  return (
    <Badge variant={VARIANT_BY_LEVEL[level]} className={className}>
      {level}
    </Badge>
  );
}
