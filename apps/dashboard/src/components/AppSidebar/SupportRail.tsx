import { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  NotificationBellOn,
  InboxDefault,
  SparkleAi01,
  BubbleChart,
  Notebook,
  PhoneDefault,
  LightningThunderElectricOn,
} from '@xyne/icons';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { ShortcutHint } from '../ui/ShortcutHint';
import { cn } from '../../utils/classNames';
import { useShortcutById } from '../../shortcuts';
import type { PikaIcon } from './navigationConfig';
import {
  RAIL_SHORTCUT_LIMIT,
  railItemIndexFromEvent,
  railShortcutsAvailable,
} from './navigationConfig';

interface RailContext {
  activeRoute: string;
}

interface SupportRailItem {
  key: string;
  label: string;
  icon: PikaIcon;
  path: string;
  gatedPath?: string;
  isActive: (ctx: RailContext) => boolean;
}

interface SupportRailProps {
  prefixWs: (path: string) => string;
  onNavigationClick: (label: string) => void;
  permittedGlobalPaths: Set<string>;
  activeRoute: string;
}

// Each item points at a real destination:
//  - Inbox       -> /support/all (ALL_CHANNELS_ID -> all conversations)
//  - Calls       -> /calls (existing Call History)
//  - AI Agent    -> /ai (existing Xyne AI)
//  - Automations -> /automations (existing Automations; gated)
//  - Dashboards  -> /analytics-dashboard (existing analytics dashboards)
//  - Help Center -> /knowledge-base (existing Knowledge Base; gated)
// Active state is derived from the live route on every render — never a toggle.
const SUPPORT_RAIL_ITEMS: SupportRailItem[] = [
  {
    key: 'inbox',
    label: 'Inbox',
    icon: InboxDefault,
    path: '/support/all',
    isActive: ctx => ctx.activeRoute === '/support',
  },
  {
    key: 'activity',
    label: 'Activity',
    icon: NotificationBellOn,
    path: '/chat/activity',
    isActive: ctx => ctx.activeRoute === '/chat/activity',
  },
  {
    key: 'calls',
    label: 'Calls',
    icon: PhoneDefault,
    path: '/calls',
    isActive: ctx => ctx.activeRoute === '/calls',
  },
  {
    key: 'ai-agent',
    label: 'AI Agent',
    icon: SparkleAi01,
    path: '/ai',
    isActive: ctx => ctx.activeRoute === '/ai',
  },
  {
    key: 'automations',
    label: 'Automations',
    icon: LightningThunderElectricOn,
    path: '/automations',
    gatedPath: '/automations',
    isActive: ctx => ctx.activeRoute === '/automations',
  },
  {
    key: 'dashboards',
    label: 'Dashboards',
    icon: BubbleChart,
    path: '/analytics-dashboard',
    gatedPath: '/analytics',
    isActive: ctx => ctx.activeRoute === '/analytics-dashboard',
  },
  {
    key: 'help-center',
    label: 'Help Center',
    icon: Notebook,
    path: '/knowledge-base',
    gatedPath: '/knowledge-base',
    isActive: ctx => ctx.activeRoute === '/knowledge-base',
  },
];

/**
 * Support context rail. Replaces the global navigation icons while inside the
 * Support experience. The back action at the top returns to the main app rail
 * on click. The active section (Inbox by default) carries the highlight.
 */
export const SupportRail = ({
  prefixWs,
  onNavigationClick,
  permittedGlobalPaths,
  activeRoute,
}: SupportRailProps): ReactElement => {
  const ctx: RailContext = { activeRoute };
  const navigate = useNavigate();

  const handleBack = (): void => onNavigationClick('Support: Back');

  const items = SUPPORT_RAIL_ITEMS.filter(
    item => !item.gatedPath || permittedGlobalPaths.has(item.gatedPath),
  );

  const railShortcuts = railShortcutsAvailable();

  useShortcutById(
    'global.goToRailItem',
    event => {
      const item = items[railItemIndexFromEvent(event)];
      if (!item) return;
      onNavigationClick(`Support: ${item.label}`);
      void navigate(prefixWs(item.path));
    },
    { enabled: railShortcuts },
  );

  return (
    <nav
      aria-label='Support'
      className='flex flex-col items-center gap-3 animate-in fade-in-0 slide-in-from-left-2 duration-300'
    >
      {/* Back to the main app rail */}
      <Tooltip content='Back to menu' side='right' delayDuration={0}>
        <Link
          to={prefixWs('/chat/dir')}
          onClick={handleBack}
          aria-label='Back to menu'
          data-testid='support-rail-home'
          data-track-category='App_Sidebar'
          data-track-name='Support_Rail_Back'
          className='size-8 flex items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        >
          <ArrowLeft size={16} />
        </Link>
      </Tooltip>

      {/* Divider between the brand and the sub-nav */}
      <span aria-hidden='true' className='my-0.5 h-px w-5 bg-sidebar-border' />

      {/* Support sub-navigation */}
      {items.map((item, index) => {
        const active = item.isActive(ctx);
        const Icon = item.icon;
        const shortcutIndex = railShortcuts && index < RAIL_SHORTCUT_LIMIT ? index + 1 : null;
        return (
          <Tooltip
            key={item.key}
            content={
              shortcutIndex ? (
                <span className='flex items-center gap-2'>
                  {item.label}
                  <ShortcutHint keys={`mod+${shortcutIndex}`} />
                </span>
              ) : (
                item.label
              )
            }
            side='right'
            delayDuration={0}
          >
            <Link
              to={prefixWs(item.path)}
              onClick={() => onNavigationClick(`Support: ${item.label}`)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              data-testid={`support-rail-${item.key}`}
              data-track-category='App_Sidebar'
              data-track-name='Support_Rail_Item'
              data-track-metadata={JSON.stringify({ path: item.path, label: item.label })}
              className={cn(
                'size-8 flex items-center justify-center rounded-lg border border-transparent transition-colors',
                active
                  ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon size={16} variant={active ? 'Solid' : 'Stroke'} />
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
};

export default SupportRail;
