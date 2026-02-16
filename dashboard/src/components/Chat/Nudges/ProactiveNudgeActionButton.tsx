import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { mutators } from '../../../zero/mutators';

interface ProactiveNudgeActionButtonProps {
  nudgeId: string;
  actionIndex: number;
  label: string;
  onActionResult: (result: Record<string, unknown>) => void;
  icon?: LucideIcon;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  className?: string;
}

export const ProactiveNudgeActionButton: React.FC<ProactiveNudgeActionButtonProps> = ({
  nudgeId,
  actionIndex,
  label,
  onActionResult,
  icon,
  variant = 'outline',
  className,
}) => {
  const zero = useZero();
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = (): void => {
    if (isLoading) return;
    setIsLoading(true);

    void zero.mutate(
      mutators.nudges.act({
        nudgeId,
        actionResult: {
          actionIndex,
        },
      }),
    );

    onActionResult({
      actionIndex,
    });

    toast.success('Action marked complete');
    setIsLoading(false);
  };

  return (
    <Button
      size='sm'
      variant={variant}
      loading={isLoading}
      onClick={handleClick}
      className={className ?? 'h-8'}
    >
      {icon ? React.createElement(icon, { className: 'h-4 w-4' }) : null}
      {label}
    </Button>
  );
};
