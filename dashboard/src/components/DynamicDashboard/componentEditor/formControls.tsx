import type { ReactElement } from 'react';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';

interface SelectOption {
  value: string;
  label: string;
}

export const Select = ({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
  trackName,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  trackName: string;
}): ReactElement => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    disabled={disabled}
    data-track-category='COMPONENT_EDITOR'
    data-track-name={trackName}
    className={`text-sm px-2 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground disabled:opacity-60 disabled:cursor-not-allowed ${
      className ?? ''
    }`}
  >
    {placeholder && (
      <option value='' disabled>
        {placeholder}
      </option>
    )}
    {options.map(o => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

export const ColumnMultiSelect = ({
  value,
  onChange,
  columns,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  columns: DataSourceColumn[];
}): ReactElement => {
  return (
    <div className='border border-border rounded-md p-2 max-h-44 overflow-auto bg-background'>
      {columns.map(c => {
        const checked = value.includes(c.columnName);
        return (
          <label
            key={c.id}
            className='flex items-center gap-2 px-1 py-1 rounded hover:bg-accent cursor-pointer text-sm'
          >
            <input
              type='checkbox'
              checked={checked}
              onChange={() => {
                if (checked) onChange(value.filter(v => v !== c.columnName));
                else onChange([...value, c.columnName]);
              }}
              data-track-category='COMPONENT_EDITOR'
              data-track-name='Column_Toggle_Change'
              className='h-3.5 w-3.5'
            />
            <span className='truncate flex-1'>{c.columnName}</span>
            <span className='text-[10px] text-muted-foreground'>{c.dataTypeCanonical}</span>
          </label>
        );
      })}
    </div>
  );
};
