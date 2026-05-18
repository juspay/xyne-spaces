import React from 'react';
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Funnel,
  Donut,
  Zap,
  Table,
  Hash,
} from 'lucide-react';
import { cn } from '../../utils/classNames';
import { QueryVisualizationType } from '../../components/QueryVisualizations/types';

interface VisualizationTypeOption {
  type: QueryVisualizationType;
  label: string;
  description: string;
  icon: React.ReactNode;
  requiresAggregation: boolean;
  allowsGroupBy: boolean;
  allowsOrderBy: boolean;
  allowsSelectFields: boolean;
}

export const VISUALIZATION_OPTIONS: VisualizationTypeOption[] = [
  {
    type: QueryVisualizationType.KPI,
    label: 'KPI Card',
    description: 'Single value metric with trend',
    icon: <Hash className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: false,
    allowsOrderBy: false,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.BAR_CHART,
    label: 'Bar Chart',
    description: 'Categorical data comparison',
    icon: <BarChart3 className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: true,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.PIE_CHART,
    label: 'Pie Chart',
    description: 'Proportional data distribution',
    icon: <PieChartIcon className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: false,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.DONUT_CHART,
    label: 'Donut Chart',
    description: 'Distribution with center value',
    icon: <Donut className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: false,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.LINE_CHART,
    label: 'Line Chart',
    description: 'Trend over time',
    icon: <TrendingUp className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: true,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.FUNNEL,
    label: 'Funnel',
    description: 'Sequential drop-off stages',
    icon: <Funnel className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: true,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.HEATMAP,
    label: 'Heatmap',
    description: '2D intensity visualization',
    icon: <Zap className='w-5 h-5' />,
    requiresAggregation: true,
    allowsGroupBy: true,
    allowsOrderBy: false,
    allowsSelectFields: true,
  },
  {
    type: QueryVisualizationType.DATA_TABLE,
    label: 'Data Table',
    description: 'Detailed raw data view',
    icon: <Table className='w-5 h-5' />,
    requiresAggregation: false,
    allowsGroupBy: false,
    allowsOrderBy: true,
    allowsSelectFields: true,
  },
];

interface VisualizationSelectorProps {
  selected: QueryVisualizationType | null;
  onChange: (type: QueryVisualizationType) => void;
  className?: string;
}

export const VisualizationSelector: React.FC<VisualizationSelectorProps> = ({
  selected,
  onChange,
  className,
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor='visualization-type' className='block text-sm font-medium text-foreground'>
        Visualization Type
      </label>
      <div id='visualization-type' className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'>
        {VISUALIZATION_OPTIONS.map(option => (
          <button
            key={option.type}
            type='button'
            onClick={() => onChange(option.type)}
            data-track-category='QueryBuilder'
            data-track-name='SelectVisualizationType'
            data-track-metadata={JSON.stringify({ visualizationType: option.type })}
            className={cn(
              'p-2 rounded-lg border-2 transition-all flex flex-col items-center gap-1 hover:border-primary/50',
              selected === option.type
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-accent',
            )}
          >
            <div className='flex items-center justify-center w-6 h-6'>{option.icon}</div>
            <span className='text-xs font-semibold text-center leading-tight'>{option.label}</span>
            <span className='text-xs text-gray-500 text-center line-clamp-1'>
              {option.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Helper to get visualization constraints
 */
export function getVisualizationConstraints(type: QueryVisualizationType | null) {
  if (!type) {
    return {
      requiresAggregation: false,
      allowsGroupBy: false,
      allowsOrderBy: true,
      allowsSelectFields: true,
    };
  }

  const option = VISUALIZATION_OPTIONS.find(o => o.type === type);
  return {
    requiresAggregation: option?.requiresAggregation ?? false,
    allowsGroupBy: option?.allowsGroupBy ?? false,
    allowsOrderBy: option?.allowsOrderBy ?? true,
    allowsSelectFields: option?.allowsSelectFields ?? true,
  };
}

export default VisualizationSelector;
