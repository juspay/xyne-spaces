import { ComponentType, ReactElement, SVGProps } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarchartDefault,
  Bot,
  PluginAddonPuzzle,
  UserAi,
  BuildingApartmentTwo,
  Share01,
  Settings01,
  SparkleAi01,
} from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { usePlatform } from '@/hooks/usePlatform';
import AppNavigator from '@/components/AppNavigator/AppNavigator';

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface ClawAgentsNavItem {
  to: string;
  label: string;
  icon: NavIcon;
}

const NAV_ITEMS: ClawAgentsNavItem[] = [
  { to: '/claw-agents', label: 'Agents', icon: Bot as NavIcon },
  { to: '/claw-agents/mcp', label: 'MCP', icon: PluginAddonPuzzle as NavIcon },
  { to: '/claw-agents/skills', label: 'Skills', icon: SparkleAi01 as NavIcon },
  { to: '/claw-agents/subagents', label: 'Subagents', icon: Share01 as NavIcon },
  { to: '/claw-agents/digital-twin', label: 'Digital Twin', icon: UserAi as NavIcon },
  { to: '/claw-agents/organization', label: 'Organization', icon: BuildingApartmentTwo as NavIcon },
  { to: '/claw-agents/metrics', label: 'Metrics', icon: BarchartDefault as NavIcon },
  { to: '/claw-agents/settings', label: 'Settings', icon: Settings01 as NavIcon },
];

const isItemActive = (pathname: string, to: string): boolean => {
  if (pathname === to) return true;
  if (to === '/claw-agents') {
    return pathname === '/claw-agents/create' || pathname.includes('/claw-agents/agents/');
  }
  return pathname.startsWith(`${to}/`);
};

const ClawAgentsSidebar = (): ReactElement => {
  const { pathname } = useLocation();
  const { isMobile } = usePlatform();

  return (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-border'>
        <div className='hidden sm:flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2'>
          <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
            Agent Hub
          </h2>
        </div>

        <div className='flex-1 min-h-0 overflow-y-auto no-scrollbar px-0.5 pt-1'>
          {NAV_ITEMS.map(({ to, label, icon: IconComponent }) => {
            const isActive = isItemActive(pathname, to);

            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`claw-agents-nav-${label.toLowerCase()}`}
                className={cn(
                  'flex items-center justify-start gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent hover:border-sidebar-border',
                  isActive
                    ? 'text-sidebar-accent-foreground font-medium bg-sidebar-accent'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
                )}
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <IconComponent className='size-4' />
                </span>
                <span className='flex-1 min-w-0 text-left truncate block'>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ClawAgentsSidebar;
