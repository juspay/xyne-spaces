import { ReactElement } from 'react';
import { ChevronDown, PlusDefault, ShieldCheck, UserThree } from '@xyne/icons';
import type { Role } from '@xyne/shared';
import { cn } from '../../utils/classNames';
import { usePlatform } from '../../hooks/usePlatform';
import AppNavigator from '../AppNavigator/AppNavigator';

interface RolesSidebarProps {
  roles: Role[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLoadMore: () => void;
}

/**
 * Left rail for the roles screen. Mirrors the chat directory sidebar — app navigator
 * strip on top, transparent background so the wallpaper shows through, and rows sized
 * like channel items.
 */
const RolesSidebar = ({
  roles,
  selectedId,
  loading,
  hasMore,
  onSelect,
  onCreate,
  onLoadMore,
}: RolesSidebarProps): ReactElement => {
  const { isMobile } = usePlatform();

  return (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-border'>
        <div className='flex pt-2 pb-3 px-2 h-10 items-center justify-between mb-2'>
          <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
            Roles
          </h2>
          <button
            type='button'
            onClick={onCreate}
            aria-label='Create role'
            className='size-7 flex items-center justify-center rounded-[10px] border border-transparent text-sidebar-foreground transition-colors hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border'
            data-track-category='ROLES'
            data-track-name='OpenCreateRole'
          >
            <PlusDefault size={16} />
          </button>
        </div>

        <div className='flex-1 min-h-0 overflow-y-auto no-scrollbar px-0.5 pt-1'>
          {loading && (
            <div className='space-y-1'>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className='h-9 rounded-[10px] bg-sidebar-accent/50 animate-pulse' />
              ))}
            </div>
          )}

          {!loading && roles.length === 0 && (
            <div className='px-2 py-8 text-center'>
              <UserThree size={20} className='mx-auto text-sidebar-foreground/40 mb-2' />
              <p className='text-xs text-sidebar-foreground'>No roles yet.</p>
              <p className='text-xs text-sidebar-foreground/70 mt-0.5'>
                Create one to get started.
              </p>
            </div>
          )}

          {roles.map(role => {
            const isActive = role.id === selectedId;

            return (
              <button
                key={role.id}
                type='button'
                onClick={() => onSelect(role.id)}
                aria-current={isActive ? 'page' : undefined}
                className='w-full'
                data-track-category='ROLES'
                data-track-name='SelectRole'
              >
                <div
                  className={cn(
                    'flex items-center gap-3 h-9 group rounded-[10px] px-3 border border-transparent transition-colors',
                    isActive
                      ? 'text-sidebar-accent-foreground font-medium bg-sidebar-accent border-sidebar-border'
                      : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border',
                  )}
                >
                  <span className='flex h-4 w-4 shrink-0 items-center justify-center'>
                    <ShieldCheck size={14} />
                  </span>
                  <span className='text-sm flex-1 min-w-0 truncate text-left'>{role.name}</span>
                </div>
              </button>
            );
          })}

          {roles.length > 0 && hasMore && (
            <button
              type='button'
              onClick={onLoadMore}
              data-track-category='ROLES'
              data-track-name='LoadMoreRoles'
              className='flex items-center justify-center gap-2 h-9 w-full rounded-[10px] px-3 text-xs font-medium border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:border-sidebar-border hover:text-sidebar-accent-foreground'
            >
              <ChevronDown size={12} /> Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RolesSidebar;
