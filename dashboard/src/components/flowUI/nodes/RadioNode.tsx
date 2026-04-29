import React from 'react';
import { useFlow } from '../FlowContext';
import type { FlowComponent } from '@xyne/shared';

interface RadioNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const RadioNode: React.FC<RadioNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        name: string;
        label?: string;
        options: Array<{ label: string; value: string }>;
        orientation?: 'horizontal' | 'vertical';
      }
    | undefined;

  const { state, updateFieldValue } = useFlow();

  if (!props?.name) return null;

  const selectedValue = (state.values[props.name] as string) || '';

  return (
    <div className='space-y-2' style={node.style}>
      {props.label && (
        <label className='block text-sm font-medium text-gray-700'>{props.label}</label>
      )}
      <div className={props.orientation === 'horizontal' ? 'flex space-x-4' : 'space-y-2'}>
        {props.options?.map(opt => (
          <label key={opt.value} className='flex items-center space-x-2 cursor-pointer'>
            <input
              type='radio'
              name={props.name}
              value={opt.value}
              checked={selectedValue === opt.value}
              disabled={state.submitting}
              onChange={e => updateFieldValue(props.name, e.target.value)}
              data-track-category='flowUI'
              data-track-name={`${props.name}-${opt.value}`}
              className='w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500'
            />
            <span className='text-sm text-gray-700'>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};
