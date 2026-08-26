import {
  ActivityIcon,
  BlocksIcon,
  BrainIcon,
  CompassIcon,
  FlameIcon,
  GaugeIcon,
  ListChecksIcon,
  ShieldAlertIcon,
  TargetIcon,
  ZapIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type { TeamLeadershipSummary } from '@/services/TeamIntelligence/teamIntelligenceService';
import type { SectionRequest } from './leadershipDashboardTypes';
import { executiveNarrative, formatLabel, momentumTone } from './leadershipDashboardUtils';
import { EmptyState, ErrorState, LoadingState, SignalStrip } from './LeadershipDashboardPrimitives';
import {
  PaginatedItemSection,
  PaginatedTextSection,
  Section,
  SnapshotShell,
  TeamMembersPanel,
} from './LeadershipDashboardSections';

export const TeamLeadershipDashboard = ({
  snapshot,
  isLoading,
  isError,
  sectionRequest,
  teamId,
}: {
  snapshot: { summary: TeamLeadershipSummary | null; completedAt?: string | null } | null;
  isLoading: boolean;
  isError: boolean;
  sectionRequest: SectionRequest;
  teamId: string;
}): ReactElement => {
  if (isLoading) return <LoadingState label='Loading manager brief...' />;
  if (isError) return <ErrorState label='Could not load the team brief.' />;
  if (!snapshot?.summary) {
    return (
      <div className='flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 space-y-6'>
        <EmptyState
          title='No team brief yet'
          text='No completed team leadership snapshot exists for this range.'
        />
        <TeamMembersPanel teamId={teamId} />
      </div>
    );
  }

  const summary = snapshot.summary;
  const operational = summary.operationalSnapshot;
  const leadership = summary.leadershipSnapshot;
  const narrative = executiveNarrative(summary.executiveSummary);

  return (
    <SnapshotShell
      scope='team'
      title={`${summary.team.name} Manager Brief`}
      eyebrow={`${summary.processingCoverage.completedUserSummaries} completed member summaries`}
      reportDate={summary.reportDate}
      confidence={summary.overallConfidence}
      momentum={summary.executiveSummary.momentum}
      narrative={narrative}
      sectionRequest={sectionRequest}
    >
      <SignalStrip
        signals={[
          {
            label: 'Momentum',
            value: formatLabel(operational.momentumAndDirection.momentum),
            description: operational.momentumAndDirection.assessment,
            tone: momentumTone(operational.momentumAndDirection.momentum),
            icon: ActivityIcon,
            targetId: 'team-goal',
          },
          {
            label: 'Leadership Mode',
            value: formatLabel(
              leadership.leadershipTouch?.recommendedMode ?? 'INSUFFICIENT_EVIDENCE',
            ),
            description:
              (leadership.leadershipTouch?.reasons ?? [])[0] ?? 'Recommended manager touch level.',
            tone: leadership.leadershipTouch?.recommendedMode === 'HIGH_TOUCH' ? 'warn' : 'info',
            icon: GaugeIcon,
            targetId: 'team-capability-and-leverage',
          },
          {
            label: 'Critical Work',
            value: `${operational.criticalAndMoving.length} high-value threads`,
            description: 'Work that deserves close managerial attention.',
            tone: operational.criticalAndMoving.length > 0 ? 'accent' : 'neutral',
            icon: FlameIcon,
            targetId: 'team-actual-work',
          },
          {
            label: 'Blockers',
            value: `${operational.needsUnblocking.length} visible blockers`,
            description: 'Items that need a decision, person, or dependency cleared.',
            tone: operational.needsUnblocking.length > 0 ? 'warn' : 'good',
            icon: ShieldAlertIcon,
            targetId: 'team-bottlenecks-and-load',
          },
        ]}
      />

      <TeamMembersPanel teamId={teamId} />

      <Section icon={ListChecksIcon} title='Manager Actions' eyebrow='Do next' tone='accent'>
        <PaginatedItemSection
          request={sectionRequest}
          section='manager-actions'
          emptyTitle='No direct manager actions'
          emptyText='The snapshot did not surface manager-level actions.'
        />
      </Section>

      <Section id='team-goal' icon={TargetIcon} title='Goal' eyebrow='Progress' tone='accent'>
        <PaginatedItemSection
          request={sectionRequest}
          section='goal'
          emptyTitle='No goal alignment found'
          emptyText='No active goal matched the team activity evidence for this summary.'
        />
      </Section>

      <Section
        id='team-actual-work'
        icon={CompassIcon}
        title='What The Team Is Actually Doing'
        eyebrow='Visible work'
        tone='info'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='actual-work'
          emptyTitle='No workstreams found'
          emptyText='The selected range did not produce visible workstream signals.'
        />
      </Section>

      <Section
        id='team-bottlenecks-and-load'
        icon={BlocksIcon}
        title='Bottlenecks And Load'
        eyebrow='Where management can help'
        tone='danger'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='bottlenecks-and-load'
          emptyTitle='No bottlenecks surfaced'
          emptyText='The snapshot did not detect active bottlenecks for this team.'
        />
      </Section>

      <Section
        id='team-capability-and-leverage'
        icon={BrainIcon}
        title='Capability And Leverage'
        eyebrow='Team shape'
        tone='good'
      >
        <PaginatedItemSection
          request={sectionRequest}
          section='capability-and-leverage'
          emptyTitle='No capability signals'
          emptyText='The snapshot did not produce capability or leverage signals.'
        />
      </Section>

      <Section icon={ZapIcon} title='Next Leap' eyebrow='Manager framing' tone='warn'>
        <PaginatedTextSection
          request={sectionRequest}
          section='next-leap'
          emptyTitle='No next leap drafted'
          emptyText='The snapshot did not produce a next-leap narrative for this team.'
        />
      </Section>
    </SnapshotShell>
  );
};
