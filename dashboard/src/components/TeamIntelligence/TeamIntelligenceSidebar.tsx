import { ReactElement, ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  /** Fired when the item is clicked (for leaf items this is the primary action) */
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

  // Determine leading icon
  const renderPrefix = (): ReactElement => {
    // If the item has children, always show a caret
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

    // Otherwise render the custom icon (if any)
    if (PrefixIcon) {
      return <PrefixIcon className='size-4 text-muted-foreground' />;
    }

    // Fallback: small dot to keep alignment
    return <span className='size-4' />;
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors group',
          'hover:bg-muted',
          isActive ? 'bg-sidebar-item-active' : 'bg-transparent',
        )}
        data-track-category='team-intelligence'
        data-track-name='select-sidebar-item'
        data-track-metadata={JSON.stringify({
          label: typeof label === 'string' ? label : 'rich-label',
          isActive,
        })}
      >
        {renderPrefix()}

        <span
          className={cn(
            'text-sm flex-1 text-left truncate',
            isActive
              ? 'text-sidebar-primary-foreground font-semibold'
              : 'text-foreground group-hover:text-foreground',
          )}
        >
          {label}
        </span>
      </button>

      {/* Collapsible children */}
      {hasChildren && isExpanded && <div className='ml-3 mt-0.5 flex flex-col'>{children}</div>}
    </div>
  );
};

const TeamIntelligenceSidebar = ({
  isSidebarOpen,
  setIsSidebarOpen,
}: {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): ReactElement => {
  const navigate = useNavigate();
  const { teamId } = useParams<{ teamId?: string }>();
  const { memberEmail } = useParams<{ memberEmail?: string }>();

  const { data } = useTeams();
  const teams = [...(data?.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const isOrgView = !teamId && !memberEmail;

  return (
    <div className='flex flex-col w-full h-full flex-1 bg-sidebar'>
      <TeamIntelligenceSidebarHeader
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
      />

      <div className='flex-1 overflow-auto flex flex-col p-3 gap-1'>
        {/* Org Insights — top-level leaf item */}
        <SidebarItems
          label='Org Digest'
          isActive={isOrgView}
          onClick={() => void navigate('/team-intelligence')}
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
                        className={cn('inline-block size-2 rounded-full shrink-0')}
                        style={{ backgroundColor: teamColorHex }}
                      />
                      {team.name}
                    </span>
                  }
                  isActive={teamId === team.id}
                  onClick={() =>
                    void navigate(`/team-intelligence/team/${encodeURIComponent(team.id)}`)
                  }
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
