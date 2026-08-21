import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useClawDigitalTwinStatus } from '@/hooks/useClawDigitalTwin';
import { Button } from '../ui/Button';

export const XyneAITwinDisabledBanner = (): ReactElement | null => {
  const { data: status, isLoading } = useClawDigitalTwinStatus();

  if (isLoading || status?.enabled) return null;

  return (
    <div className='border-b border-primary/20 bg-primary/5 px-4 py-3'>
      <div className='mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-sm font-medium text-foreground'>Turn on learning from your history</p>
          <p className='text-xs text-muted-foreground'>
            Chat works now. Enable learning in settings for memories, review, and mention replies.
          </p>
        </div>
        <Button size='sm' variant='outline' asChild>
          <Link to='../settings/overview'>Open settings</Link>
        </Button>
      </div>
    </div>
  );
};
