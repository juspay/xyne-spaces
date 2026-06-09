import { ReactElement, ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, LucideIcon, SparklesIcon } from 'lucide-react';
import { cn } from '@/utils/classNames';
import TeamIntelligenceSidebarHeader from './TeamIntelligenceSidebarHeader';
import { useTeams } from '@/hooks/useTeamIntelligence';
import { getTeamColor } from '@/utils/teamIntelligenceUtils';

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
      ? 'text-sidebar-primary-foreground font-semibold'
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
      {hasChildren && isExpanded && <div className='mt-0.5 flex flex-col'>{children}</div>}
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

  const { data } = useTeams();
  const teams = [...(data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const isOrgView = !teamId && !memberEmail;

  const handleNav = (): void => {
    if (closeOnNavigate) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className='flex flex-col w-full h-full flex-1 bg-background divide-y divide-sidebar-divider'>
      <TeamIntelligenceSidebarHeader
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        showCollapseButton={showCollapseButton}
      />

      <div className='flex-1 overflow-auto flex flex-col p-3 gap-1'>
        {/* Org Insights — top-level leaf item */}
        <SidebarItems
          label='Org Digest'
          to='/team-intelligence'
          isActive={isOrgView}
          onClick={handleNav}
          prefixIcon={SparklesIcon}
        />

        {/* Team Insights — collapsible with all teams */}
        {teams.length > 0 ? (
          <SidebarItems label='Team Insights' defaultExpanded>
            {teams?.map(team => {
              const teamColorHex = getTeamColor(team.name).primary;

              return (
                <SidebarItems
                  key={team.id}
                  label={
                    <span className='flex items-center gap-2'>
                      <span
                        className={cn('inline-block size-1 rounded-full shrink-0')}
                        style={{ backgroundColor: teamColorHex }}
                      />
                      {team.name}
                    </span>
                  }
                  to={`/team-intelligence/team/${encodeURIComponent(team.id)}`}
                  isActive={teamId === team.id}
                  onClick={handleNav}
                />
              );
            })}
          </SidebarItems>
        ) : null}
      </div>
    </div>
  );
};

export default TeamIntelligenceSidebar;
