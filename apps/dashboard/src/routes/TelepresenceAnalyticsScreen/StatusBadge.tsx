import { ReactElement } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/classNames';
import type { TelepresenceHealthStatus } from '../../types/telepresence';
import { STATUS_META } from './TelepresenceAnalyticsScreen.utils';

// Status is always conveyed by icon + text label, never color alone.
const StatusBadge = ({
  status,
  className,
}: {
  status: TelepresenceHealthStatus;
  className?: string;
}): ReactElement => {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant='outline' className={cn(meta.badgeClassName, className)}>
      <Icon aria-hidden='true' />
      {meta.label}
    </Badge>
  );
};

export default StatusBadge;
