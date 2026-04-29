import React from 'react';
import { useFlow } from '../FlowContext';
import type { FlowComponent, SelectOption } from '@xyne/shared';

interface CheckboxNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const CheckboxNode: React.FC<CheckboxNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        name: string;
        label?: string;
        options: SelectOption[] | string;
        required?: boolean;
        defaultValue?: string[];
        orientation?: 'horizontal' | 'vertical';
      }
    | undefined;

  const { state, data, updateFieldValue } = useFlow();

  if (!props?.name) return null;

  // Resolve options: static array or "$<key>" dynamic reference
  const resolvedOptions: SelectOption[] = (() => {
    if (Array.isArray(props.options)) return props.options;
    if (typeof props.options === 'string' && props.options.startsWith('$')) {
      const key = props.options.slice(1);
      const dataValue = data[key];
      if (Array.isArray(dataValue)) return dataValue as SelectOption[];
    }
    return [];
  })();

  const selectedValues: string[] = Array.isArray(state.values[props.name])
    ? (state.values[props.name] as string[])
    : [];

  const handleChange = (value: string, checked: boolean) => {
    const next = checked ? [...selectedValues, value] : selectedValues.filter(v => v !== value);
    updateFieldValue(props.name, next);
  };

  return (
    <div className='space-y-2' style={node.style}>
      {props.label && (
        <label className='block text-sm font-medium text-gray-700'>
          {props.label}
          {props.required && <span className='text-destructive ml-0.5'>*</span>}
        </label>
      )}
      <div className={props.orientation === 'horizontal' ? 'flex flex-wrap gap-4' : 'space-y-2'}>
        {resolvedOptions.map(opt => (
          <label key={opt.value} className='flex items-center space-x-2 cursor-pointer'>
            <input
              type='checkbox'
              value={opt.value}
              checked={selectedValues.includes(opt.value)}
              disabled={state.submitting || opt.disabled === true}
              onChange={e => handleChange(opt.value, e.target.checked)}
              data-track-category='flowUI'
              data-track-name={`${props.name}-${opt.value}`}
              className='w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500'
            />
            <span className='text-sm text-gray-700'>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};
