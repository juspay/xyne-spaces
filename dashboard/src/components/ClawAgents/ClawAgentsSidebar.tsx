import { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  Blocks,
  Brain,
  Building2,
  Network,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/utils/classNames';

interface ClawAgentsNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: ClawAgentsNavItem[] = [
  { to: '/claw-agents', label: 'Agents', icon: Bot },
  { to: '/claw-agents/mcp', label: 'MCP', icon: Blocks },
  { to: '/claw-agents/skills', label: 'Skills', icon: Sparkles },
  { to: '/claw-agents/subagents', label: 'Subagents', icon: Network },
  { to: '/claw-agents/digital-twin', label: 'Digital Twin', icon: Brain },
  { to: '/claw-agents/organization', label: 'Organization', icon: Building2 },
  { to: '/claw-agents/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/claw-agents/settings', label: 'Settings', icon: Settings },
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

  return (
    <div className='flex flex-col w-full h-full flex-1 bg-background'>
      <div className='flex-1 overflow-auto flex flex-col p-3 gap-1'>
        {NAV_ITEMS.map(({ to, label, icon }) => {
          const IconComponent = icon;
          const isActive = isItemActive(pathname, to);

          return (
            <Link
              key={to}
              to={to}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`claw-agents-nav-${label.toLowerCase()}`}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors group hover:bg-muted',
                isActive ? 'bg-sidebar-item-active' : 'bg-transparent',
              )}
            >
              <IconComponent
                className={cn(
                  'size-4 shrink-0',
                  isActive ? 'text-sidebar-primary-foreground' : 'text-muted-foreground',
                )}
              />
              <span
                className={cn(
                  'text-[13px] flex-1 text-left truncate',
                  isActive
                    ? 'text-sidebar-primary-foreground font-semibold'
                    : 'text-foreground group-hover:text-foreground',
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ClawAgentsSidebar;
