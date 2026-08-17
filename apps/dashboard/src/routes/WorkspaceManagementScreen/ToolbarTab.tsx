import { ReactElement, useEffect, useState } from 'react';
import { Save, Search, Shield } from 'lucide-react';
import { Switch } from '../../components/ui/Switch';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { cn } from '../../utils/classNames';
import { WorkspaceRole } from '@xyne/shared';
import { NAVIGATION_ITEMS } from '../../components/AppSidebar/navigationConfig';
import { PATH_TO_RESOURCE } from '../../components/AppSidebar/utils/resourceMapping';
import { toast } from 'sonner';

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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string');

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every(v => b.has(v));

interface ToolbarTabProps {
  isActive?: boolean;
}

export const ToolbarTab = ({ isActive: _isActive = false }: ToolbarTabProps): ReactElement => {
  const self = useSelf();
  const z = useZero();
  const workspaceId = self?.workspaceId;
  const isAdmin = self?.role === WorkspaceRole.ADMIN || self?.role === WorkspaceRole.OWNER;

  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId: workspaceId || '' }), {
    enabled: !!workspaceId,
  });

  const workspaceMetadata =
    workspace?.metadata && typeof workspace.metadata === 'object' && !Array.isArray(workspace.metadata)
      ? (workspace.metadata as Record<string, unknown>)
      : undefined;
  const savedDisabledPaths = new Set(
    isStringArray(workspaceMetadata?.disabledToolbarPaths) ? workspaceMetadata.disabledToolbarPaths : [],
  );

  const [draftDisabledPaths, setDraftDisabledPaths] = useState<Set<string>>(savedDisabledPaths);

  // Sync draft from server state when it changes (e.g. on load, or another admin's edit).
  useEffect(() => {
    setDraftDisabledPaths(savedDisabledPaths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.metadata]);

  const hasChanges = !sameSet(draftDisabledPaths, savedDisabledPaths);

  // Permission-gated items (e.g. Roles, Workspace Management) are already restricted by the
  // user/role permission system — a regular member can never see them regardless of this
  // workspace-wide toggle, so surfacing them here would be misleading.
  const manageableItems = NAVIGATION_ITEMS.filter(item => !(item.path in PATH_TO_RESOURCE));

  const [searchQuery, setSearchQuery] = useState('');
  const visibleItems = manageableItems.filter(item =>
    item.label.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const handleToggleItem = (path: string, enabled: boolean): void => {
    setDraftDisabledPaths(prev => {
      const next = new Set(prev);
      if (enabled) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSave = (): void => {
    if (!workspaceId) return;
    z.mutate(
      mutators.workspace.update({
        workspaceId,
        timestamp: Date.now(),
        updates: { disabledToolbarPaths: [...draftDisabledPaths] },
      }),
    );
    toast.success('Toolbar settings saved');
  };

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
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>Toolbar items</h2>
            <p className='text-sm text-muted-foreground'>
              Control which sidebar items are available to members of this workspace. Members can
              still choose to hide enabled items for themselves under Preferences → Toolbar, but
              items disabled here are unavailable to everyone.
            </p>
          </div>
          <div className='flex items-center gap-3 shrink-0'>
            {hasChanges && (
              <span className='text-sm text-amber-600 whitespace-nowrap'>Unsaved changes</span>
            )}
            <Button onClick={handleSave} disabled={!hasChanges} className='gap-2'>
              <Save className='w-4 h-4' />
              Save Changes
            </Button>
          </div>
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
              const enabled = !draftDisabledPaths.has(item.path);
              return (
                <div
                  key={item.path}
                  className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'
                >
                  <div className='flex items-center gap-3 min-w-0'>
                    <div className='flex items-center justify-center size-8 rounded-md bg-muted border border-border shrink-0 text-muted-foreground'>
                      <Icon className='size-4' />
                    </div>
                    <p className='text-sm font-medium text-foreground truncate'>{item.label}</p>
                  </div>
                  <Switch
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${item.label} for this workspace`}
                    checked={enabled}
                    onCheckedChange={value => handleToggleItem(item.path, value)}
                  />
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
