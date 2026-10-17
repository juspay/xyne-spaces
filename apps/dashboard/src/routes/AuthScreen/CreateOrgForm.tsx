import { FormEvent, ReactElement, RefObject, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { validateCoupon } from '../../hooks/useOrgCoupon';

type CouponState = 'idle' | 'applied' | 'invalid';

interface CreateOrgFormProps {
  isLoading: boolean;
  isOrganizationNameTaken: boolean;
  signedInEmail?: string | undefined;
  orgNameInputRef: RefObject<HTMLInputElement | null>;
  onClearError: () => void;
  onSubmit: (orgName: string, workspaceName: string, couponCode?: string) => void;
  onUseDifferentAccount: () => void;
  onBackToWorkspaces?: (() => void) | undefined;
}

const INPUT_CLASS =
  'h-11 w-full rounded-[10px] border bg-background px-3.5 text-[15px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-[#E8574A] focus:shadow-[0_0_0_3px_rgba(232,87,74,0.16)]';

const CreateOrgForm = ({
  isLoading,
  isOrganizationNameTaken,
  signedInEmail,
  orgNameInputRef,
  onClearError,
  onSubmit,
  onUseDifferentAccount,
  onBackToWorkspaces,
}: CreateOrgFormProps): ReactElement => {
  const [orgName, setOrgName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [coupon, setCoupon] = useState('');
  const [couponState, setCouponState] = useState<CouponState>('idle');
  const [couponAmount, setCouponAmount] = useState<number | null>(null);
  const [isCheckingCoupon, setIsCheckingCoupon] = useState(false);

  const canSubmit = !isLoading && !!orgName.trim() && !!workspaceName.trim();

  // The server decides whether the code is valid; it re-validates on submit.
  const checkCoupon = async (): Promise<CouponState> => {
    setIsCheckingCoupon(true);
    try {
      const amount = await validateCoupon(coupon.trim());
      const next: CouponState = amount === null ? 'invalid' : 'applied';
      setCouponAmount(amount);
      setCouponState(next);
      return next;
    } catch {
      setCouponState('invalid');
      return 'invalid';
    } finally {
      setIsCheckingCoupon(false);
    }
  };

  const handleApply = (): void => {
    if (coupon.trim()) void checkCoupon();
  };

  const handleRemove = (): void => {
    setCoupon('');
    setCouponAmount(null);
    setCouponState('idle');
  };

  // Only a code applied with the Apply button counts; text left in the box is ignored.
  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canSubmit || isCheckingCoupon) return;
    onSubmit(
      orgName.trim(),
      workspaceName.trim(),
      couponState === 'applied' ? coupon.trim() : undefined,
    );
  };

  return (
    <div className='flex flex-col items-center gap-5'>
      <div className='w-full max-w-[460px] rounded-2xl border border-border bg-background p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.12)]'>
        <h1 className='mb-1.5 text-2xl font-bold leading-tight tracking-tight text-foreground'>
          Set up your organization
        </h1>
        <p className='mb-6 text-sm leading-normal text-muted-foreground'>
          Name your organization and its first workspace.
        </p>

        <form onSubmit={handleSubmit} className='flex flex-col gap-[18px]'>
          {isOrganizationNameTaken && (
            <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
              <p className='text-sm text-amber-700'>
                <span className='font-medium'>Organization name taken.</span> Please choose a
                different name.
              </p>
            </div>
          )}

          <div className='flex flex-col gap-1.5'>
            <label htmlFor='orgName' className='text-sm font-semibold text-foreground'>
              Organization name
            </label>
            <input
              id='orgName'
              type='text'
              autoComplete='organization'
              value={orgName}
              ref={orgNameInputRef}
              onChange={e => {
                setOrgName(e.target.value);
                if (isOrganizationNameTaken) onClearError();
              }}
              placeholder='e.g. Juspay Inc'
              className={`${INPUT_CLASS} ${isOrganizationNameTaken ? 'border-amber-400' : 'border-border'}`}
              required
              data-track-category='Auth'
              data-track-name='OrgNameInput'
            />
            {isOrganizationNameTaken && (
              <span className='text-[13px] text-amber-600'>
                Try adding your team name or a unique identifier
              </span>
            )}
          </div>

          <div className='flex flex-col gap-1.5'>
            <label htmlFor='workspaceName' className='text-sm font-semibold text-foreground'>
              Workspace name
            </label>
            <input
              id='workspaceName'
              type='text'
              value={workspaceName}
              onChange={e => setWorkspaceName(e.target.value)}
              placeholder='e.g. Engineering'
              className={`${INPUT_CLASS} border-border`}
              required
              data-track-category='Auth'
              data-track-name='WorkspaceNameInput'
            />
            <span className='text-[13px] text-muted-foreground'>
              A workspace groups the tickets and people for one team.
            </span>
          </div>

          {couponState !== 'applied' && (
            <div className='flex flex-col gap-1.5 rounded-[10px] border border-border bg-muted/40 p-3.5'>
              <label htmlFor='couponCode' className='text-sm font-semibold text-foreground'>
                Coupon code <span className='font-normal'>(optional)</span>
              </label>
              <div className='flex gap-2'>
                <input
                  id='couponCode'
                  type='text'
                  value={coupon}
                  onChange={e => {
                    setCoupon(e.target.value);
                    setCouponState('idle');
                  }}
                  placeholder='Enter coupon code'
                  className={`${INPUT_CLASS} min-w-0 flex-1 border-border tracking-[0.04em]`}
                  data-track-category='Auth'
                  data-track-name='CouponCodeInput'
                />
                <button
                  type='button'
                  onClick={handleApply}
                  disabled={!coupon.trim() || isCheckingCoupon}
                  className='h-11 cursor-pointer rounded-[10px] border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
                  data-track-category='Auth'
                  data-track-name='ApplyCoupon'
                >
                  {isCheckingCoupon ? 'Checking…' : 'Apply'}
                </button>
              </div>
              {couponState === 'invalid' && (
                <span role='alert' className='text-[13px] text-[#B42318]'>
                  That code isn&apos;t valid.
                </span>
              )}
            </div>
          )}

          {couponState === 'applied' && couponAmount !== null && (
            <div className='flex items-center justify-between gap-2 rounded-[10px] bg-[#ECFAF1] px-3 py-2.5'>
              <span className='flex items-center gap-2 text-[13px] font-medium text-[#16663A]'>
                <CheckCircle2 size={16} aria-hidden='true' />${couponAmount} AI credits will be
                added
              </span>
              <button
                type='button'
                onClick={handleRemove}
                className='cursor-pointer border-0 bg-transparent p-1 text-[13px] font-medium text-[#3F3F46] underline'
                data-track-category='Auth'
                data-track-name='RemoveCoupon'
              >
                Remove
              </button>
            </div>
          )}

          <button
            type='submit'
            disabled={!canSubmit}
            className='mt-1 h-12 cursor-pointer rounded-[10px] bg-[#D23F33] text-[15px] font-semibold text-white transition-colors hover:bg-[#B8352A] disabled:cursor-not-allowed disabled:bg-[#F1F1F3] disabled:text-[#71717A] disabled:hover:bg-[#F1F1F3]'
            data-track-category='Auth'
            data-track-name='CreateOrganization'
          >
            {isLoading ? 'Creating…' : 'Create organization'}
          </button>

          {onBackToWorkspaces && (
            <button
              type='button'
              onClick={onBackToWorkspaces}
              className='cursor-pointer text-sm text-muted-foreground hover:text-foreground'
              data-track-category='Auth'
              data-track-name='BackToWorkspaceSelection'
            >
              Back to workspace selection
            </button>
          )}
        </form>
      </div>

      <div className='text-[13px] text-muted-foreground'>
        {signedInEmail ? `Signed in as ${signedInEmail} · ` : ''}
        <button
          type='button'
          onClick={onUseDifferentAccount}
          className='cursor-pointer font-medium text-[#B8352A] hover:text-[#8F281F]'
          data-track-category='Auth'
          data-track-name='UseDifferentAccount'
        >
          Use a different account
        </button>
      </div>
    </div>
  );
};

export default CreateOrgForm;
