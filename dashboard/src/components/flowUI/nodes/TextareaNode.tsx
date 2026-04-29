import React from 'react';
import { useFlow } from '../FlowContext';
import Textarea from '../../ui/Textarea/Textarea';
import { cn } from '../../../utils/classNames';
import type { FlowComponent } from '@xyne/shared';

interface TextareaNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const TextareaNode: React.FC<TextareaNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        name: string;
        label?: string;
        placeholder?: string;
        rows?: number;
        required?: boolean;
      }
    | undefined;

  const { state, updateFieldValue, validateField } = useFlow();

  if (!props?.name) return null;

  const value = (state.values[props.name] as string) || '';
  const error = state.errors[props.name];
  const isTouched = state.touched[props.name];

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateFieldValue(props.name, e.target.value);
  };

  const handleBlur = () => {
    validateField(props.name, value);
  };

  return (
    <div className='space-y-1.5' style={node.style}>
      {props.label && (
        <label className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
          {props.label}
          {props.required && <span className='text-destructive ml-0.5'>*</span>}
        </label>
      )}
      <Textarea
        value={value}
        placeholder={props.placeholder}
        disabled={state.submitting}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn(error && isTouched && 'border-destructive')}
      />
      {error && isTouched && <p className='text-xs text-destructive'>{error}</p>}
    </div>
  );
};
