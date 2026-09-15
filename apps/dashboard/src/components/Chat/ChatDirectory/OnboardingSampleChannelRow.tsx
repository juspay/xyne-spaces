import { type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Hashtag } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import {
  ONBOARDING_SAMPLE_CHANNEL_NAME,
  ONBOARDING_SAMPLE_SLUG,
} from '../../../routes/OnboardingScreen/onboardingFlow';

const OnboardingSampleChannelRow = (): ReactElement => {
  const { workspaceId, channelId } = useParams<{ workspaceId?: string; channelId?: string }>();
  const isActive = channelId === ONBOARDING_SAMPLE_SLUG;
  const to = workspaceId
    ? `/${workspaceId}/chat/dir/${ONBOARDING_SAMPLE_SLUG}`
    : `/chat/dir/${ONBOARDING_SAMPLE_SLUG}`;

  return (
    <Link
      to={to}
      className='block'
      data-testid='onboarding-sample-channel'
      data-track-category='CHAT_SIDEBAR'
      data-track-name='OPEN_ONBOARDING_SAMPLE'
    >
      <div
        className={cn(
          'mt-px flex h-9 items-center gap-3 rounded-[10px] border border-transparent px-3 text-sm',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground border-sidebar-border'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <span className='flex h-4 w-4 shrink-0 items-center justify-center'>
          <Hashtag size={12} />
        </span>
        <span className='min-w-0 flex-1 truncate'>{ONBOARDING_SAMPLE_CHANNEL_NAME}</span>
        <span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
          Sample
        </span>
      </div>
    </Link>
  );
};

export default OnboardingSampleChannelRow;
