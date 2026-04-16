import React from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import HuddleIcon from '../../icons/HuddleIcon';

interface ActionButton {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  className?: string;
  testId?: string;
}

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  description?: string | undefined;
  showIcon?: boolean;
  iconColor?: string;
  buttons: ActionButton[];
  testId?: string;
}

/**
 * ActionModal Component
 *
 * A reusable confirmation/action modal with flexible button configuration.
 * Used for call confirmations, end call dialogs, and other user actions.
 */
export const ActionModal: React.FC<ActionModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  description,
  showIcon = true,
  iconColor = 'var(--action-primary)',
  buttons,
  testId,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <div className='p-6 flex flex-col max-w-[460px]' data-testid={testId}>
        {/* Icon */}
        {showIcon && (
          <div className='w-10 h-10 rounded-xl bg-muted border border-border flex items-center justify-center mb-5'>
            <div className='scale-[1.25]'>
              <HuddleIcon color={iconColor} />
            </div>
          </div>
        )}

        {/* Title */}
        <h2 className='text-[15px] font-semibold text-foreground mb-1'>{title}</h2>

        {/* Subtitle */}
        {subtitle && (
          <p className='text-[13px] text-muted-foreground leading-relaxed mb-5 break-words'>
            {subtitle}
          </p>
        )}

        {/* Optional Description */}
        {description && (
          <p className='text-xs text-muted-foreground mb-4 break-words'>{description}</p>
        )}

        {/* Buttons */}
        <div className='flex items-center justify-between gap-3'>
          {buttons.map((button, index) => (
            <Button
              key={index}
              onClick={button.onClick}
              variant={button.variant || 'default'}
              size='sm'
              className={button.className}
              data-testid={button.testId}
              data-track-category='Calls'
              data-track-name='Action_Modal_Button'
              data-track-metadata={JSON.stringify({ buttonLabel: button.label, modalTitle: title })}
            >
              {button.label}
            </Button>
          ))}
        </div>
      </div>
    </Dialog>
  );
};
