import { ReactElement, ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, LucideIcon, SparklesIcon } from 'lucide-react';
import { cn } from '@/utils/classNames';
import TeamIntelligenceSidebarHeader from './TeamIntelligenceSidebarHeader';
import { useTeamGoalGroups } from '@/hooks/useTeamIntelligence';
import { getTeamColor } from '@/utils/teamIntelligenceUtils';
import {
  TeamGoalGroupKey,
  TeamGoalGroupTeam,
} from '@/services/TeamIntelligence/teamIntelligenceService';

// ---------------------------------------------------------------------------
// SidebarItems
// ---------------------------------------------------------------------------

interface SidebarItemsProps {
  /** Icon rendered before the label. Ignored when `children` is provided — a caret is shown instead. */
  prefixIcon?: LucideIcon;
  /** Display text (or rich node) for the item */
  label: string | ReactNode;
  /** Router path for leaf items — renders as <Link> when provided */
  to?: string;
  /** Additional click handler (e.g. to close a mobile drawer) */
  onClick?: () => void;
  /** Whether this item is currently active / selected */
  isActive?: boolean;
  /** If provided the item becomes a collapsible group that is open by default */
  defaultExpanded?: boolean;
  /** Nested items rendered inside the collapsible section */
  children?: ReactNode;
}

const SidebarItems = ({
  prefixIcon: PrefixIcon,
  label,
  to,
  onClick,
  isActive = false,
  defaultExpanded = false,
  children,
}: SidebarItemsProps): ReactElement => {
  const hasChildren = Boolean(children);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleClick = (): void => {
    if (hasChildren) {
      setIsExpanded(prev => !prev);
    }
    onClick?.();
  };

  const baseClasses = cn(
    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors group',
    'hover:bg-muted',
    isActive ? 'bg-sidebar-item-active' : 'bg-transparent',
  );

  const labelClasses = cn(
    'text-sm flex-1 text-left truncate',
    isActive
      ? 'text-sidebar-accent-foreground font-semibold'
      : 'text-foreground group-hover:text-foreground',
  );

  // Determine leading icon
  const renderPrefix = (): ReactElement => {
    if (hasChildren) {
      return (
        <ChevronRight
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            isExpanded ? 'rotate-90' : 'rotate-0',
          )}
        />
      );
    }
    if (PrefixIcon) {
      return <PrefixIcon className='size-4 text-muted-foreground' />;
    }
    return <span className='size-4' />;
  };

  const content = (
    <>
      {renderPrefix()}
      <span className={labelClasses}>{label}</span>
    </>
  );

  return (
    <div>
      {to ? (
        /* Leaf item — render as Link for native browser behavior */
        <Link
          to={to}
          onClick={onClick}
          className={baseClasses}
          data-track-category='team-intelligence'
          data-track-name='select-sidebar-item'
          data-track-metadata={JSON.stringify({
            label: typeof label === 'string' ? label : 'rich-label',
            isActive,
          })}
        >
          {content}
        </Link>
      ) : (
        /* Parent item — button for expand/collapse */
        <button
          onClick={handleClick}
          className={baseClasses}
          data-track-category='team-intelligence'
          data-track-name='select-sidebar-item'
          data-track-metadata={JSON.stringify({
            label: typeof label === 'string' ? label : 'rich-label',
            isActive,
          })}
        >
          {content}
        </button>
      )}

      {/* Collapsible children */}
      {hasChildren && isExpanded && <div className='mt-0.5 flex flex-col pl-3'>{children}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TeamIntelligenceSidebar
// ---------------------------------------------------------------------------

const TeamIntelligenceSidebar = ({
  isSidebarOpen,
  setIsSidebarOpen,
  showCollapseButton = true,
  closeOnNavigate = false,
}: {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showCollapseButton?: boolean;
  closeOnNavigate?: boolean;
}): ReactElement => {
  const { teamId } = useParams<{ teamId?: string }>();
  const { memberEmail } = useParams<{ memberEmail?: string }>();

  const { data, isLoading, isError } = useTeamGoalGroups();

  const isOrgView = !teamId && !memberEmail;

  const handleNav = (): void => {
    if (closeOnNavigate) {
      setIsSidebarOpen(false);
    }
  };

  const groupConfig: Array<{
    key: TeamGoalGroupKey;
    label: string;
    description: string;
  }> = [
    { key: '10X', label: '10X Goals', description: 'Teams aligned to a 10X goal.' },
    { key: '5X', label: '5X Goals', description: 'Teams aligned to a 5X goal.' },
    { key: '2X', label: '2X Goals', description: 'Teams aligned to a 2X goal.' },
    {
      key: 'READY_TO_ACCELERATE',
      label: 'Ready to Accelerate',
      description: 'Teams with active goals that are ready for stronger evidence of progress.',
    },
    {
      key: 'NO_GOAL_DATA',
      label: 'No Goal Data',
      description: 'Teams without an active goal track.',
    },
  ];

  const renderTeam = (team: TeamGoalGroupTeam): ReactElement => {
    const teamColorHex = getTeamColor(team.name).primary;
    return (
      <SidebarItems
        key={team.id}
        label={
          <span className='flex min-w-0 items-center gap-2'>
            <span
              className='inline-block size-1 shrink-0 rounded-full'
              style={{ backgroundColor: teamColorHex }}
            />
            <span className='truncate'>{team.name}</span>
          </span>
        }
        to={`/team-intelligence/team/${encodeURIComponent(team.id)}`}
        isActive={teamId === team.id}
        onClick={handleNav}
      />
    );
  };

  return (
    <div className='flex flex-col w-full h-full flex-1 bg-background divide-y divide-sidebar-divider'>
      <TeamIntelligenceSidebarHeader
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        showCollapseButton={showCollapseButton}
      />

      <div className='flex-1 overflow-auto flex flex-col p-3 gap-1'>
        {/* Organization leadership — top-level leaf item */}
        <SidebarItems
          label='Founder Brief'
          to='/team-intelligence'
          isActive={isOrgView}
          onClick={handleNav}
          prefixIcon={SparklesIcon}
        />

        <p className='px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
          Manager Briefs
        </p>
        {isLoading ? (
          <p className='px-2 py-3 text-xs text-muted-foreground'>Grouping teams by goals…</p>
        ) : isError || !data ? (
          <p className='px-2 py-3 text-xs text-muted-foreground'>Goal grouping is unavailable.</p>
        ) : data.totalTeams === 0 ? (
          <p className='px-2 py-3 text-xs text-muted-foreground'>
            No teams were returned by Mettle.
          </p>
        ) : (
          groupConfig.map(group => {
            const teams = data.groups[group.key];
            return (
              <SidebarItems
                key={group.key}
                defaultExpanded
                label={
                  <span
                    className='flex min-w-0 items-center justify-between gap-2'
                    title={group.description}
                  >
                    <span className='truncate'>{group.label}</span>
                    <span className='rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'>
                      {teams.length}
                    </span>
                  </span>
                }
              >
                {teams.length > 0 ? (
                  teams.map(renderTeam)
                ) : (
                  <p className='px-8 py-1.5 text-xs text-muted-foreground'>No teams</p>
                )}
              </SidebarItems>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TeamIntelligenceSidebar;
