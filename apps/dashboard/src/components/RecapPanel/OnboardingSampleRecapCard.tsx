import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Hash } from 'lucide-react';
import {
  ONBOARDING_SAMPLE_THREAD,
  onboardingSamplePath,
} from '../../routes/OnboardingScreen/onboardingSample';
import { ONBOARDING_SAMPLE_CHANNEL_NAME } from '../../routes/OnboardingScreen/onboardingFlow';

export const OnboardingSampleRecapCard = ({
  workspaceId,
}: {
  workspaceId: string;
}): ReactElement => {
  const sample = ONBOARDING_SAMPLE_THREAD;

  return (
    <div
      className='mb-5 rounded-xl border border-border border-l-[3px] border-l-blue-500 bg-card p-5 shadow-sm'
      data-testid='onboarding-sample-recap'
    >
      <div className='mb-4 flex items-center gap-2 font-semibold text-foreground'>
        <Link
          to={onboardingSamplePath(workspaceId)}
          className='flex items-center gap-2 rounded hover:underline'
          data-track-category='RECAP_PANEL'
          data-track-name='OPEN_ONBOARDING_SAMPLE'
        >
          <Hash size={16} className='text-muted-foreground' />
          <span>{ONBOARDING_SAMPLE_CHANNEL_NAME}</span>
        </Link>
        <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
          {sample.label}
        </span>
      </div>
      <ul className='space-y-2'>
        <li className='text-sm leading-relaxed text-foreground'>
          <span className='mr-2 text-muted-foreground'>•</span>
          {sample.recapBlurb}
        </li>
      </ul>
      <div className='mt-4 border-t border-border pt-4 text-sm text-muted-foreground'>
        1 message summarized
      </div>
    </div>
  );
};
