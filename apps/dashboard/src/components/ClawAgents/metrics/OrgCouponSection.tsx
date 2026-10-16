import { ReactElement, useState } from 'react';
import { Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button/Button';
import { useOrgCoupon } from '@/hooks/useOrgCoupon';
import { getApiErrorMessage } from '@/utils/apiError';

interface OrgCouponSectionProps {
  orgId: string;
}

export const OrgCouponSection = ({ orgId }: OrgCouponSectionProps): ReactElement | null => {
  const { state, apply, isApplying } = useOrgCoupon(orgId);
  const [code, setCode] = useState('');

  const handleApply = async (): Promise<void> => {
    try {
      await apply(code.trim());
      setCode('');
      toast.success('Coupon applied. Your AI credits will update shortly.');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to apply coupon'));
    }
  };

  if (state?.applied) return null;

  return (
    <div className='mb-5 rounded-lg border border-border bg-card px-4 py-3'>
      <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
        <Ticket className='w-4 h-4 text-primary' />
        AI credits
      </div>
      <div className='flex gap-2 mt-2'>
        <input
          type='text'
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder='Coupon code'
          aria-label='Coupon code'
          data-track-category='Organisations'
          data-track-name='OrgCouponInput'
          className='flex-1 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground'
        />
        <Button
          size='sm'
          onClick={(): void => void handleApply()}
          disabled={isApplying || !code.trim()}
          data-track-category='Organisations'
          data-track-name='ApplyOrgCoupon'
        >
          {isApplying ? 'Applying...' : 'Apply'}
        </Button>
      </div>
    </div>
  );
};
