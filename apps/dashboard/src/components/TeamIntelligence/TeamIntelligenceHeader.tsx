import { ReactElement, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, PanelLeftOpenIcon } from 'lucide-react';
import Button from '../ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
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
    const segs: BreadcrumbSegment[] = [{ label: 'Founder Brief', path: '/team-intelligence' }];

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
    <div className='w-full h-16 sm:h-20 p-3 sm:p-4 flex items-center shrink-0 bg-background gap-2'>
      {!isSidebarOpen && (
        <Button
          variant='ghost'
          size='iconLg'
          onClick={() => setIsSidebarOpen(true)}
          data-track-category='team-intelligence'
          data-track-name='open-team-intelligence-sidebar'
          className='rounded-md transition-colors text-muted-foreground shrink-0'
          aria-label='Open sidebar'
        >
          <PanelLeftOpenIcon className='size-5' />
        </Button>
      )}

      <nav className='flex items-center gap-1 ml-3 mr-auto min-w-0'>
        {breadcrumbs.map((seg, i) => (
          <div key={seg.label} className='flex items-center gap-1 min-w-0'>
            {i > 0 && <ChevronRight className='size-3.5 text-muted-foreground shrink-0' />}
            {seg.path ? (
              <Link
                to={seg.path}
                className='text-sm text-muted-foreground hover:text-foreground transition-colors truncate'
              >
                {seg.label}
              </Link>
            ) : (
              <span className='text-sm font-medium text-foreground truncate'>{seg.label}</span>
            )}
          </div>
        ))}
      </nav>

      {/* Time range — Select dropdown on mobile, pill buttons on sm+ */}
      <Select value={timeRange} onValueChange={(value: string) => setTimeRange(value as TimeRange)}>
        <SelectTrigger className='w-[130px] h-8 text-xs'>
          <SelectValue placeholder='Select range' />
        </SelectTrigger>
        <SelectContent>
          {timeRangeOptions.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default TeamIntelligenceHeader;
