import { ReactElement, useState } from 'react';
import { Search, Shield } from 'lucide-react';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { useDisabledToolbarPaths } from '../../hooks/useDisabledToolbarPaths';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { cn } from '../../utils/classNames';
import { WorkspaceRole } from '@xyne/shared';
import {
  NAVIGATION_ITEMS,
  TOOLBAR_ITEM_DESCRIPTIONS,
} from '../../components/AppSidebar/navigationConfig';
import { PATH_TO_RESOURCE } from '../../components/AppSidebar/utils/resourceMapping';

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement => (
  <div className={cn('rounded-xl border border-border bg-card shadow-sm', className)}>
    {children}
  </div>
);

interface ToolbarTabProps {
  isActive?: boolean;
}

export const ToolbarTab = ({ isActive: _isActive = false }: ToolbarTabProps): ReactElement => {
  const self = useSelf();
  const isAdmin = self?.role === WorkspaceRole.ADMIN || self?.role === WorkspaceRole.OWNER;
  const disabledPaths = useDisabledToolbarPaths();
  const [workspace] = useCachedQuery(
    queries.getWorkspaceById({ workspaceId: self?.workspaceId ?? '' }),
    { enabled: !!self?.workspaceId },
  );

  // Permission-gated items (e.g. Roles, Workspace Management) are already restricted by the
  // user/role permission system — a regular member can never see them regardless of this
  // workspace-wide toggle, so surfacing them here would be misleading.
  const manageableItems = NAVIGATION_ITEMS.filter(item => !(item.path in PATH_TO_RESOURCE));

  const [searchQuery, setSearchQuery] = useState('');
  const visibleItems = manageableItems.filter(item =>
    item.label.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  if (!isAdmin) {
    return (
      <div className='flex flex-col items-center justify-center h-full gap-2 text-center px-6'>
        <Shield className='w-8 h-8 text-muted-foreground' />
        <p className='text-sm font-medium text-foreground'>Admin access required</p>
        <p className='text-sm text-muted-foreground max-w-sm'>
          Only workspace admins and owners can manage which toolbar items are available.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='space-y-4'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Toolbar items</h2>
          <p className='text-sm text-muted-foreground'>
            Which sidebar items are available to members of this workspace. Members can still choose
            to hide enabled items for themselves under Preferences → Toolbar, but items disabled
            here are unavailable to everyone. Managed centrally via Superposition — contact your ops
            team to change the list for {workspace?.name ?? 'this workspace'}, under the key{' '}
            <code className='rounded bg-muted px-1 py-0.5 text-xs'>disabled_toolbar_paths</code>,
            entry{' '}
            <code className='rounded bg-muted px-1 py-0.5 text-xs'>
              {self?.workspaceId ?? '<workspaceId>'}
            </code>
            .
          </p>
        </div>
        <Card className='p-4'>
          <div className='relative mb-3'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <Input
              type='text'
              placeholder='Search toolbar items...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='pl-10'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            {visibleItems.length === 0 && (
              <p className='text-sm text-muted-foreground text-center py-6'>
                No toolbar items match “{searchQuery}”
              </p>
            )}
            {visibleItems.map(item => {
              const Icon = item.icon;
              const enabled = !disabledPaths.has(item.path);
              return (
                <div
                  key={item.path}
                  className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'
                >
                  <div className='flex items-center gap-3 min-w-0'>
                    <div className='flex items-center justify-center size-8 rounded-md bg-muted border border-border shrink-0 text-muted-foreground'>
                      <Icon className='size-4' />
                    </div>
                    <div className='min-w-0'>
                      <p className='text-sm font-medium text-foreground truncate'>{item.label}</p>
                      {TOOLBAR_ITEM_DESCRIPTIONS[item.path] && (
                        <p className='text-xs text-muted-foreground truncate'>
                          {TOOLBAR_ITEM_DESCRIPTIONS[item.path]}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium px-2 py-1 rounded-full',
                      enabled
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-muted-foreground/10 text-muted-foreground',
                    )}
                  >
                    {enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ToolbarTab;
