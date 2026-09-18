import React, { useMemo, useState } from 'react';
import { SegmentedToggle } from '../../../ui/SegmentedToggle';
import DelayedSpinner from '../../../ui/DelayedSpinner';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import type { ChannelClawAgent } from '../../../../hooks/useChannelClawAgents';
import {
  useDeskOnboardingState,
  useInvalidateDeskOnboarding,
} from '../../../../hooks/useDeskOnboarding';
import { OnboardingTakeTestView } from '../onboarding/OnboardingTakeTestView';
import { OnboardingTopicsView } from '../onboarding/OnboardingTopicsView';
import { OnboardingResultsView } from '../onboarding/OnboardingResultsView';

type OnboardingView = 'take' | 'topics' | 'results';

interface OnboardingTabProps {
  channelId: string;
  /** The desk's Claw agents, for the per-topic grading agent picker. */
  clawAgents: ChannelClawAgent[];
}

/**
 * Onboarding exams: admins build papers of past tickets, new agents answer each ticket's first
 * email, and an agent grades the replies. Saves go straight to the server — this tab never
 * touches the Desk Settings draft or its save bar.
 */
export const OnboardingTab: React.FC<OnboardingTabProps> = ({ channelId, clawAgents }) => {
  const { userID } = useAuthContextValues();
  const [view, setView] = useState<OnboardingView>('take');
  const { data: state, isLoading, isError, refetch } = useDeskOnboardingState(channelId);
  const invalidate = useInvalidateDeskOnboarding(channelId);

  const isAdmin = state?.isAdmin ?? false;
  const options = useMemo(
    () => [
      { value: 'take' as const, label: 'Take test' },
      { value: 'topics' as const, label: 'Topics' },
      ...(isAdmin ? [{ value: 'results' as const, label: 'Results' }] : []),
    ],
    [isAdmin],
  );
  const activeView = !isAdmin && view === 'results' ? 'take' : view;

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex flex-col gap-[4px]'>
          <div className='text-desk-label'>Onboarding</div>
          <div className='text-desk-helper w-full max-w-[520px]'>
            Practice exams on this desk’s past tickets. Read the customer’s first email, write the
            reply you’d send, and an agent grades it against how the desk actually handled it.
          </div>
        </div>
        {state && (
          <SegmentedToggle
            options={options}
            value={activeView}
            onChange={setView}
            trackCategory='DeskSettings'
            trackPrefix='OnboardingView'
          />
        )}
      </div>

      {isLoading ? (
        <DelayedSpinner label='Loading onboarding' />
      ) : isError || !state || !userID ? (
        <div className='flex items-center gap-3 text-desk-helper'>
          Couldn’t load onboarding for this desk.
          <button
            type='button'
            onClick={() => void refetch()}
            className='text-sm font-medium text-desk-accent hover:underline'
            data-track-category='DeskSettings'
            data-track-name='OnboardingRetryState'
          >
            Try again
          </button>
        </div>
      ) : activeView === 'take' ? (
        <OnboardingTakeTestView
          channelId={channelId}
          userId={userID}
          state={state}
          onChanged={invalidate}
        />
      ) : activeView === 'topics' ? (
        <OnboardingTopicsView
          channelId={channelId}
          state={state}
          clawAgents={clawAgents}
          onChanged={invalidate}
        />
      ) : (
        <OnboardingResultsView channelId={channelId} state={state} />
      )}
    </div>
  );
};
