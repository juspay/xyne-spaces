import { ReactElement, useMemo, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  LinkChainHorizontal as Link,
  MultipleCrossCancelDefault as Cross,
  SearchDefault as Search,
  Share02 as Share,
} from '@xyne/icons';
import { ViewAccessEntityType } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import Avatar from '../../ui/Avatar/Avatar';
import { Tooltip } from '../../ui/Tooltip';

interface ShareViewPopoverProps {
  viewId: string;
  viewName: string;
}

interface AccessRow {
  id: string;
  entityType: string;
  entityId: string;
}

const actionLabelClass =
  'col-start-1 row-start-1 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]';

const easeOut = [0.23, 1, 0.32, 1] as const;

export const ShareViewPopover = ({ viewId, viewName }: ShareViewPopoverProps): ReactElement => {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [justShared, setJustShared] = useState<string[]>([]);
  const reduceMotion = useReducedMotion();
  const tickHidden = { opacity: 0, scale: reduceMotion ? 1 : 0.25, filter: 'blur(4px)' };

  const [configs] = useCachedQuery(queries.savedConfigsByUser({ userId: user?.id ?? '' }), {
    enabled: open && !!user?.id,
  });
  const access = useMemo((): AccessRow[] => {
    const view = configs?.find(c => c.id === viewId);
    const rows = (view as { viewAccess?: readonly AccessRow[] } | undefined)?.viewAccess ?? [];
    const userType: string = ViewAccessEntityType.USER;
    return rows.filter(row => row.entityType === userType);
  }, [configs, viewId]);
  const sharedIds = useMemo(() => new Set(access.map(row => row.entityId)), [access]);

  const people = useMemo(
    () =>
      (allUsers ?? [])
        .filter(u => u.id !== user?.id)
        .map(u => ({ id: u.id, name: getUserDisplayName(u), sub: u.email ?? '' })),
    [allUsers, user?.id],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? people
            .filter(p => p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q))
            .slice(0, 30)
        : [],
    [people, q],
  );
  const shared = useMemo(
    () => access.map(row => ({ row, person: people.find(p => p.id === row.entityId) })),
    [access, people],
  );

  const grant = async (personId: string): Promise<void> => {
    setPendingId(personId);
    setJustShared(ids => [...ids, personId]);
    setTimeout(() => setJustShared(ids => ids.filter(id => id !== personId)), 900);
    try {
      const res = await zero.mutate(
        mutators.viewAccess.grant({
          id: uuidv4(),
          viewId,
          entityType: ViewAccessEntityType.USER,
          entityId: personId,
          timestamp: Date.now(),
        }),
      ).server;
      if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to share view');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share view');
    } finally {
      setPendingId(null);
    }
  };

  const revoke = async (row: AccessRow): Promise<void> => {
    setPendingId(row.entityId);
    try {
      const res = await zero.mutate(mutators.viewAccess.revoke({ id: row.id })).server;
      if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to remove access');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove access');
    } finally {
      setPendingId(null);
    }
  };

  const copyLink = (): void => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast.success('Link copied'),
      () => toast.error('Failed to copy link'),
    );
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Tooltip content='Share this view' side='bottom'>
        <PopoverPrimitive.Trigger asChild>
          <button
            type='button'
            aria-label='Share view'
            title='Share this view'
            className={cn(
              'flex size-[30px] shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground',
              open ? 'bg-muted text-foreground' : 'text-foreground/80',
            )}
            data-track-category='Projects'
            data-track-name='ShareView'
          >
            <Share className='size-[17px]' />
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side='bottom'
          align='end'
          sideOffset={4}
          className='z-[60] w-[312px] overflow-hidden rounded-[12px] border border-border bg-background shadow-[0_16px_44px_rgba(20,22,26,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1'
        >
          <div className='flex h-10 items-center gap-2 border-b border-border/60 px-3 text-muted-foreground/80'>
            <Search className='size-[14px] shrink-0' />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Add people by name…'
              className='min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/60'
              data-track-category='Projects'
              data-track-name='SearchShareViewUsers'
            />
            {query && (
              <button
                type='button'
                onClick={() => setQuery('')}
                className='text-[13px] leading-none text-muted-foreground/60 hover:text-foreground'
                aria-label='Clear search'
                data-track-category='Projects'
                data-track-name='ClearShareViewSearch'
              >
                ×
              </button>
            )}
          </div>

          {q ? (
            <div className='flex max-h-[212px] flex-col overflow-y-auto p-[5px]'>
              {matches.length === 0 ? (
                <div className='px-[9px] py-3 text-[12px] text-muted-foreground/80'>
                  Nobody matches “{query}”
                </div>
              ) : (
                matches.map(person => {
                  const already = sharedIds.has(person.id);
                  const celebrate = already && justShared.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      type='button'
                      disabled={already || pendingId === person.id}
                      onClick={() => void grant(person.id)}
                      className='flex min-h-[38px] items-center gap-[9px] rounded-lg px-[7px] py-1 text-left transition-colors hover:bg-muted disabled:cursor-default'
                      data-track-category='Projects'
                      data-track-name='ShareViewWithUser'
                    >
                      <span className='relative flex shrink-0'>
                        <Avatar
                          userId={person.id}
                          size='sm'
                          showActiveStatus={false}
                          className='shrink-0'
                        />
                        <AnimatePresence>
                          {celebrate && !reduceMotion && (
                            <motion.span
                              key='ping'
                              initial={{ opacity: 0, scale: 1 }}
                              animate={{ opacity: [0.6, 0], scale: [1, 1.8] }}
                              transition={{ duration: 0.6, delay: 0.2, ease: easeOut }}
                              className='pointer-events-none absolute -inset-px rounded-[5px] border border-status-success'
                            />
                          )}
                          {celebrate && (
                            <motion.span
                              key='tick'
                              initial={tickHidden}
                              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                              exit={tickHidden}
                              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                              className='absolute -inset-px flex items-center justify-center rounded-[5px] bg-status-success text-background'
                            >
                              <svg
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth={3}
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                className='size-3.5'
                                aria-hidden
                              >
                                <motion.path
                                  d='M5.5 12.5L10.0168 17.7247L10.4177 17.0238C12.5668 13.2658 15.541 10.0448 19.1161 7.60354L20 7'
                                  initial={{ pathLength: 0, opacity: 0 }}
                                  animate={{ pathLength: 1, opacity: 1 }}
                                  transition={{ duration: 0.3, delay: 0.1, ease: easeOut }}
                                />
                              </svg>
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[12.5px] font-medium text-foreground'>
                          {person.name}
                        </span>
                        <span className='block truncate text-[11px] text-muted-foreground/60'>
                          {person.sub}
                        </span>
                      </span>
                      <span className='grid shrink-0 justify-items-end text-[11.5px] font-medium'>
                        <span
                          aria-hidden={already}
                          className={cn(
                            actionLabelClass,
                            'text-primary',
                            already &&
                              'opacity-0 motion-safe:-translate-y-1 motion-safe:blur-[2px]',
                          )}
                        >
                          Add
                        </span>
                        <span
                          aria-hidden={!already}
                          className={cn(
                            actionLabelClass,
                            'text-muted-foreground/60',
                            !already &&
                              'opacity-0 motion-safe:translate-y-1.5 motion-safe:blur-[2px]',
                          )}
                        >
                          Shared
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div>
              <div className='flex items-center justify-between px-3 pb-1.5 pt-2.5'>
                <span className='text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-foreground/80'>
                  Shared with
                </span>
                <span className='font-mono text-[11px] text-muted-foreground/60'>
                  {shared.length}
                </span>
              </div>
              <div className='max-h-[212px] overflow-y-auto px-1.5 pb-1.5'>
                <AnimatePresence initial={false}>
                  {shared.map(({ row, person }) => {
                    const name = person?.name ?? 'Unknown user';
                    return (
                      <motion.div
                        key={row.id}
                        exit={{
                          height: 0,
                          opacity: 0,
                          filter: 'blur(4px)',
                          transition: {
                            default: { duration: 0.15, ease: easeOut },
                            height: { duration: 0.22, delay: 0.06, ease: easeOut },
                          },
                        }}
                        className='overflow-hidden'
                      >
                        <div className='flex min-h-[36px] items-center gap-[9px] rounded-lg px-1.5 py-1 hover:bg-muted'>
                          <Avatar
                            userId={row.entityId}
                            size='sm'
                            showActiveStatus={false}
                            className='shrink-0'
                          />
                          <span className='min-w-0 flex-1'>
                            <span className='block truncate text-[12.5px] font-medium text-foreground'>
                              {name}
                            </span>
                            {person?.sub && (
                              <span className='block truncate text-[11px] text-muted-foreground/60'>
                                {person.sub}
                              </span>
                            )}
                          </span>
                          <button
                            type='button'
                            title='Remove access'
                            disabled={pendingId === row.entityId}
                            onClick={() => void revoke(row)}
                            className='flex size-[22px] shrink-0 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-foreground/10 hover:text-foreground'
                            data-track-category='Projects'
                            data-track-name='RevokeViewAccess'
                          >
                            <Cross className='size-3' />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                  {shared.length === 0 && (
                    <motion.div
                      key='empty'
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      transition={{
                        height: { duration: 0.22, delay: 0.06, ease: easeOut },
                        opacity: { duration: 0.2, delay: 0.15 },
                      }}
                      className='overflow-hidden'
                    >
                      <div className='flex items-center gap-[9px] px-1.5 pb-2.5 pt-1.5'>
                        <span className='flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground/60'>
                          <Share className='size-3' />
                        </span>
                        <span className='min-w-0 flex-1 text-[12px] leading-[1.45] text-muted-foreground/80'>
                          Not shared with anyone yet. Add people above to give them access.
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <button
            type='button'
            onClick={copyLink}
            className='flex w-full items-center gap-2 border-t border-border/60 px-3 py-[9px] text-left text-foreground/80 transition-colors hover:bg-muted hover:text-foreground'
            data-track-category='Projects'
            data-track-name='CopyViewLink'
            data-track-metadata={JSON.stringify({ viewName })}
          >
            <Link className='size-[13px] shrink-0' />
            <span className='text-[12.5px] font-medium'>Copy link</span>
            <span className='flex-1' />
            <span className='text-[11px] text-muted-foreground/60'>
              Only people with access can view
            </span>
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};
