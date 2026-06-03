import { ReactElement, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, PanelLeftOpenIcon } from 'lucide-react';
import Button from '../ui/Button';
import { cn } from '@/utils/classNames';
import { TimeRange } from '@/utils/teamIntelligenceUtils';
import { useMemberDetails, useTeams } from '@/hooks/useTeamIntelligence';

interface BreadcrumbSegment {
  label: string;
  path?: string;
}

const TeamIntelligenceHeader = ({
  isSidebarOpen,
  setIsSidebarOpen,
  timeRange,
  setTimeRange,
}: {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  timeRange: TimeRange;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
}): ReactElement => {
  const { teamId, memberEmail } = useParams<{ teamId?: string; memberEmail?: string }>();

  const { data: teams } = useTeams();

  const { data: memberData } = useMemberDetails(memberEmail!);

  const breadcrumbs = useMemo<BreadcrumbSegment[]>(() => {
    const segs: BreadcrumbSegment[] = [{ label: 'Org Digest', path: '/team-intelligence' }];

    if (teamId) {
      const team = teams?.data?.find(t => t.id === teamId);
      const teamName = team?.name;
      if (!teamName) return segs; // If team not found, just return org digest breadcrumb
      segs.push({
        label: teamName,
        path: `/team-intelligence/team/${encodeURIComponent(teamId)}`,
      });
    }

    if (memberEmail) {
      const memberName = memberData?.name;
      // For member page, also show the team segment if not already present
      if (!teamId) {
        const memberTeamId = memberData?.team?.id;
        const memberTeam = memberData?.team?.name;
        if (memberTeam) {
          segs.push({
            label: memberTeam,
            path: `/team-intelligence/team/${encodeURIComponent(memberTeamId!)}`,
          });
        }
      }
      segs.push({ label: memberName || memberEmail });
    }

    return segs;
  }, [teamId, memberEmail, memberData, teams]);

  const timeRangeOptions: { value: TimeRange; label: string }[] = [
    { value: TimeRange.YESTERDAY, label: 'Yesterday' },
    { value: TimeRange.THIS_WEEK, label: 'This Week' },
    { value: TimeRange.LAST_WEEK, label: 'Last Week' },
    { value: TimeRange.THIS_MONTH, label: 'This Month' },
  ];

  return (
    <div className='w-full h-20 border-b p-4 flex items-center shrink-0 bg-background/70 backdrop-filter backdrop-blur-sm'>
      {!isSidebarOpen ? (
        <Button
          variant={'ghost'}
          size={'iconLg'}
          onClick={() => setIsSidebarOpen(true)}
          data-track-category='team-intelligence'
          data-track-name='expand-team-intelligence-sidebar'
          className='rounded-md transition-colors text-muted-foreground'
          aria-label='Open sidebar'
        >
          <PanelLeftOpenIcon className='size-5' />
        </Button>
      ) : null}

      <nav className='flex items-center gap-1 ml-3 mr-auto'>
        {breadcrumbs.map((seg, i) => (
          <div key={seg.label} className='flex items-center gap-1'>
            {i > 0 && <ChevronRight className='size-3.5 text-muted-foreground shrink-0' />}
            {seg.path ? (
              <Link
                to={seg.path}
                className='text-sm text-muted-foreground hover:text-foreground transition-colors'
              >
                {seg.label}
              </Link>
            ) : (
              <span className='text-sm font-medium text-foreground'>{seg.label}</span>
            )}
          </div>
        ))}
      </nav>

      <div
        className='flex items-center gap-1 rounded-lg bg-muted p-1'
        role='radiogroup'
        aria-label='Select time range'
      >
        {timeRangeOptions.map(option => (
          <Button
            key={option.value}
            onClick={() => setTimeRange(option.value)}
            role='radio'
            aria-checked={timeRange === option.value}
            className={cn(
              'transition-all',
              timeRange === option.value
                ? 'bg-action-accent text-action-primary-foreground hover:bg-action-accent shadow-sm'
                : 'bg-muted hover:bg-muted text-muted-foreground hover:text-foreground',
            )}
            data-track-category='team-intelligence'
            data-track-name='time-range-select'
            data-track-value={option.value}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default TeamIntelligenceHeader;
