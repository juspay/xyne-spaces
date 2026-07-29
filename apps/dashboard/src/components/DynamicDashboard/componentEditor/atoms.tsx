import { Plus } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

export const Field = ({
  label,
  description,
  labelTone = 'normal',
  children,
}: {
  label: string;
  description?: string;
  labelTone?: 'normal' | 'strong';
  children: ReactNode;
}): ReactElement => (
  <div className='space-y-1.5'>
    <div>
      <label
        className={`block text-[14px] leading-5 text-xyne-gray-900 ${
          labelTone === 'strong' ? 'font-semibold' : 'font-medium'
        }`}
      >
        {label}
      </label>
      {description && (
        <p className='mt-0.5 text-[12px] leading-[16px] text-xyne-gray-500'>{description}</p>
      )}
    </div>
    {children}
  </div>
);

export const Section = ({
  label,
  add,
  addDisabled,
  children,
}: {
  label: string;
  add?: () => void;
  addDisabled?: boolean;
  children: ReactNode;
}): ReactElement => (
  <div className='space-y-1.5'>
    <div className='flex items-center justify-between'>
      <label className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
        {label}
      </label>
      {add && (
        <button
          type='button'
          onClick={add}
          disabled={addDisabled}
          data-track-category='COMPONENT_EDITOR'
          data-track-name='Section_Add_Click'
          className='inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40'
        >
          <Plus size={11} />
          Add
        </button>
      )}
    </div>
    <div className='space-y-1.5'>{children}</div>
  </div>
);

export const IconBtn = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='COMPONENT_EDITOR'
    data-track-name='Icon_Btn_Click'
    className='p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0'
  >
    {children}
  </button>
);
