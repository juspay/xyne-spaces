import { ReactElement } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: string;
}

export const EmptyState = ({ title, description, icon = '📋' }: EmptyStateProps): ReactElement => {
  return (
    <div className='text-center py-16'>
      <div className='text-muted-foreground text-5xl mb-4'>{icon}</div>
      <h3 className='text-xl font-semibold text-foreground mb-2'>{title}</h3>
      <p className='text-muted-foreground'>{description}</p>
    </div>
  );
};
