import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { PikaIconProps } from '@xyne/icons';
import { cn } from '@/utils/classNames';

export type CardHeaderIcon = ComponentType<PikaIconProps>;

export const SettingCardHeader = ({
  icon,
  title,
  description,
  trailing,
  divided = true,
}: {
  icon: CardHeaderIcon;
  title: string;
  description: string;
  trailing?: ReactNode;
  divided?: boolean;
}): ReactElement => {
  const IconComponent = icon;
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', divided && 'border-b border-border')}>
      <span className='flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground'>
        <IconComponent className='size-4' aria-hidden />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium leading-5 text-foreground'>{title}</p>
        <p className='text-xs leading-relaxed text-muted-foreground'>{description}</p>
      </div>
      {trailing}
    </div>
  );
};
