import React from 'react';
import { useFlow } from '../FlowContext';
import { Button } from '../../ui/Button/Button';
import { toast } from 'sonner';
import type { FlowComponent } from '@xyne/shared';

interface ButtonNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

export const ButtonNode: React.FC<ButtonNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        label: string;
        variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
        size?: 'sm' | 'md' | 'lg';
        icon?: string;
        action?: { id: string };
      }
    | undefined;

  const { executeAction, validateAllFields, isSubmitting, state, compact } = useFlow();

  const handleClick = () => {
    void (async () => {
      const action = (node.props as { action?: Parameters<typeof executeAction>[0] }).action;
      if (!action) return;

      // For submit actions, validate all fields first
      if (action.type === 'submit') {
        const isValid = validateAllFields();
        if (!isValid) {
          toast.error('Please fill in all required fields');
          return;
        }
      }

      await executeAction(action);
    })();
  };

  // Evaluate disabled condition
  const isDisabled = (): boolean => {
    if (isSubmitting) return true;
    if (node.disabled === true) return true;
    if (typeof node.disabled === 'string') {
      const key = node.disabled.replace('values.', '');
      return !!state.values[key];
    }
    return false;
  };

  // Map flow variant/size to project Button props
  const getVariant = () => {
    switch (props?.variant) {
      case 'primary':
        return 'default';
      case 'secondary':
        return 'secondary';
      case 'destructive':
        return 'destructive';
      case 'ghost':
        return 'ghost';
      case 'outline':
        return 'outline';
      default:
        // App-originated flows use a lighter outline button by default
        return 'outline';
    }
  };

  const getSize = () => {
    if (compact) return 'sm';
    switch (props?.size) {
      case 'sm':
        return 'sm';
      case 'lg':
        return 'default';
      default:
        return 'sm';
    }
  };

  return (
    <div className='pt-2'>
      <Button
        onClick={handleClick}
        data-track-category='flowUI'
        data-track-name='CLICK_FLOW_BUTTON'
        disabled={isDisabled()}
        variant={getVariant()}
        size={getSize()}
        loading={isSubmitting}
      >
        {props?.label || 'Button'}
      </Button>
    </div>
  );
};
