import type { ComponentType, ReactElement } from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import {
  CheckTickCircle,
  CircleDashed,
  CircleDot,
  MultipleCrossCancelCircle,
  PauseCircle,
} from '@xyne/icons';
import { StatusIndicator } from '../../components/Board/StatusIndicator';

interface StageStatusMeta {
  label: string;
  Icon: ComponentType<{ strokeWidth?: number; className?: string; style?: React.CSSProperties }>;
  cssVar: string;
  bgColor: string;
  textColor: string;
}

export const STAGE_STATUS_META: Record<TicketStatusV2, StageStatusMeta> = {
  [TicketStatusV2.TODO]: {
    label: 'Todo',
    Icon: CircleDashed,
    cssVar: 'var(--status-new)',
    bgColor: 'bg-orange-500/15',
    textColor: 'text-orange-600',
  },
  [TicketStatusV2.STARTED]: {
    label: 'Started',
    Icon: CircleDot,
    cssVar: 'var(--status-scheduled)',
    bgColor: 'bg-blue-500/15',
    textColor: 'text-blue-600',
  },
  [TicketStatusV2.PAUSED]: {
    label: 'Paused',
    Icon: PauseCircle,
    cssVar: 'var(--status-paused)',
    bgColor: 'bg-teal-500/15',
    textColor: 'text-teal-600',
  },
  [TicketStatusV2.CANCELLED]: {
    label: 'Cancelled',
    Icon: MultipleCrossCancelCircle,
    cssVar: 'var(--status-failure)',
    bgColor: 'bg-red-500/15',
    textColor: 'text-red-600',
  },
  [TicketStatusV2.COMPLETED]: {
    label: 'Completed',
    Icon: CheckTickCircle,
    cssVar: 'var(--status-success)',
    bgColor: 'bg-green-500/15',
    textColor: 'text-green-600',
  },
};

export const getStageStatusMeta = (status: string | null | undefined): StageStatusMeta =>
  STAGE_STATUS_META[status as TicketStatusV2] ?? STAGE_STATUS_META[TicketStatusV2.TODO];

export const StageStatusIcon = ({
  status,
}: {
  status: string | null | undefined;
}): ReactElement => {
  const { Icon, cssVar } = getStageStatusMeta(status);
  return <Icon strokeWidth={2.5} className='w-3.5 h-3.5 shrink-0' style={{ color: cssVar }} />;
};

const resolveStageStatus = (
  stages: readonly StageIndicatorStage[] | null | undefined,
  stageName: string | null | undefined,
  fallbackStatus?: string | null,
): string | null | undefined =>
  stages?.find(s => s.name === stageName)?.defaultTicketStatusV2 ?? fallbackStatus;

export interface StageIndicatorStage {
  name: string;
  defaultTicketStatusV2?: string | null;
}

// Mirrors LinearStageCard in BoardStageConfigScreen: on a linear board the fill
// comes from the stage's position among the stages that carry progress. A
// non-linear board has no such order, and its editor shows the flat status-only
// fill, so position is withheld there to match.
export const StageIndicator = ({
  stages,
  stageName,
  fallbackStatus,
  isNonLinearBoard = false,
  size = 14,
}: {
  stages: readonly StageIndicatorStage[] | null | undefined;
  stageName: string | null | undefined;
  fallbackStatus?: string | null | undefined;
  isNonLinearBoard?: boolean;
  size?: number;
}): ReactElement => {
  const activeStages = isNonLinearBoard
    ? []
    : (stages ?? []).filter(
        s =>
          s.defaultTicketStatusV2 !== TicketStatusV2.TODO &&
          s.defaultTicketStatusV2 !== TicketStatusV2.CANCELLED,
      );
  const stageIndexInActive = activeStages.findIndex(s => s.name === stageName);
  const status = resolveStageStatus(stages, stageName, fallbackStatus);

  return (
    <StatusIndicator
      status={(status as TicketStatusV2) ?? TicketStatusV2.TODO}
      size={size}
      stageIndex={stageIndexInActive >= 0 ? stageIndexInActive : undefined}
      totalNonCancelledStages={activeStages.length > 0 ? activeStages.length : undefined}
    />
  );
};
