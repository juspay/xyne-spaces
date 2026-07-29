import { BarChart3, ChevronDown } from 'lucide-react';
import { QueryVisualizationType } from '@xyne/shared';
import type { ReactElement } from 'react';
import { ALL_TYPES } from './types';
import { chartTypeUnsupportedReason } from './validation';

export const ChartTypeSelect = ({
  value,
  onChange,
  inScopeColumns,
}: {
  value: QueryVisualizationType;
  onChange: (next: QueryVisualizationType) => void;
  inScopeColumns: ReadonlyArray<{ dataTypeCanonical: string }>;
}): ReactElement => (
  <div className='relative inline-flex items-center gap-1.5 h-8 pl-2.5 pr-7 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 hover:bg-xyne-gray-50 transition-colors'>
    <BarChart3 size={14} className='text-xyne-gray-600 shrink-0' />
    <select
      value={value}
      onChange={e => onChange(e.target.value as QueryVisualizationType)}
      className='appearance-none bg-transparent outline-none pr-1 cursor-pointer'
      data-track-category='COMPONENT_EDITOR'
      data-track-name='Chart_Type_Change'
    >
      {ALL_TYPES.map(t => {
        const reason = chartTypeUnsupportedReason(t.value, inScopeColumns);
        return (
          <option key={t.value} value={t.value} disabled={reason !== null && t.value !== value}>
            {t.label}
            {reason ? ` — ${reason}` : ''}
          </option>
        );
      })}
    </select>
    <ChevronDown
      size={14}
      className='absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-xyne-gray-400'
    />
  </div>
);
