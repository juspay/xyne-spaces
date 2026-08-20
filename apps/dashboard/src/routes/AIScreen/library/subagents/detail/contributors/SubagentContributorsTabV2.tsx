import { useMemo, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { MultipleCrossCancelDefault, SearchDefault } from '@xyne/icons';
import { useClawSubagentShares } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { ClawUser } from '@/services/claw/clawAuthAgentTypes';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { Pill } from '../../../shared/primitives/Pill';
import {
  DetailCard,
  DetailEmpty,
  DetailLockedNote,
  DetailSection,
  DetailStack,
  ManageButton,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import { PersonRow } from '../../../agents/detail/people/PersonRow';
import { AddContributorDialog } from './AddContributorDialog';

const LOCK_NOTE =
  'Only the person who created this subagent, an editor, or an admin can change who contributes.';
const BUILT_IN_NOTE =
  'This is a built-in subagent. It ships with the platform, so it has no contributors to manage.';

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

export function SubagentContributorsTabV2({
  subagent,
  canShare,
  isBuiltIn,
}: {
  subagent: SubagentDef;
  canShare: boolean;
  isBuiltIn: boolean;
}): ReactElement {
  const shares = useClawSubagentShares(subagent.name);

  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const entries = (subagent.shares ?? []).map(share => ({
      key: share.userId,
      userId: share.userId,
      name: share.name || share.email,
      detail: share.email,
      creator: false,
    }));

    if (subagent.createdByUserId) {
      entries.unshift({
        key: `creator-${subagent.createdByUserId}`,
        userId: subagent.createdByUserId,
        name: subagent.createdByName || subagent.createdByEmail || 'Creator',
        detail: subagent.createdByEmail ?? 'Subagent creator',
        creator: true,
      });
    }

    const q = query.trim().toLowerCase();
    return q
      ? entries.filter(
          entry => entry.name.toLowerCase().includes(q) || entry.detail.toLowerCase().includes(q),
        )
      : entries;
  }, [
    subagent.shares,
    subagent.createdByUserId,
    subagent.createdByName,
    subagent.createdByEmail,
    query,
  ]);

  const existingUserIds = useMemo(
    () =>
      new Set([
        ...(subagent.createdByUserId ? [subagent.createdByUserId] : []),
        ...(subagent.shares ?? []).map(share => share.userId),
      ]),
    [subagent.createdByUserId, subagent.shares],
  );

  const addContributor = async (target: ClawUser): Promise<void> => {
    if (busyUserId) return;
    setBusyUserId(target.id);
    try {
      await shares.add.mutateAsync(target.id);
      toast.success(`${target.name || target.email} added`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not add that person'));
    } finally {
      setBusyUserId(null);
    }
  };

  const removeContributor = async (userId: string, name: string): Promise<void> => {
    if (busyUserId) return;
    setBusyUserId(userId);
    try {
      await shares.remove.mutateAsync(userId);
      toast.success(`${name} removed`);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not remove that person'));
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleSearch = (): void => {
    setSearchOpen(open => {
      if (open) {
        setQuery('');
        return false;
      }
      setTimeout(() => searchRef.current?.focus(), 0);
      return true;
    });
  };

  return (
    <DetailStack>
      <DetailSection
        heading='section'
        label='Contributors'
        info='People who can edit this subagent'
        trailing={
          <span className='flex items-center gap-1'>
            <button
              type='button'
              onClick={toggleSearch}
              aria-label={searchOpen ? 'Hide search' : 'Search contributors'}
              aria-expanded={searchOpen}
              data-track-category='Claw Agents'
              data-track-name='Subagent detail v2: toggle contributor search'
              className={ICON_BUTTON}
            >
              <SearchDefault className='size-4' aria-hidden />
            </button>
            {canShare ? (
              <ManageButton
                label='Add contributors'
                onClick={() => setAddOpen(true)}
                trackName='Subagent detail v2: open add contributor'
              />
            ) : (
              <ReadOnlyBadge />
            )}
          </span>
        }
        trailingAlign='end'
      >
        <DetailCard>
          {!canShare && (
            <DetailLockedNote>{isBuiltIn ? BUILT_IN_NOTE : LOCK_NOTE}</DetailLockedNote>
          )}

          {searchOpen && (
            <div className='border-b border-border p-3'>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder='Filter contributors'
                aria-label='Filter contributors'
                data-track-category='Claw Agents'
                data-track-name='Subagent detail v2: filter contributors'
                className='h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          )}

          {rows.length === 0 ? (
            <DetailEmpty>
              {query.trim() ? 'No contributors matched that search.' : 'No contributors yet.'}
            </DetailEmpty>
          ) : (
            rows.map(row => (
              <PersonRow
                key={row.key}
                userId={row.userId}
                name={row.name}
                detail={row.detail}
                trailing={
                  row.creator ? (
                    <Pill tone='neutral'>Subagent Creator</Pill>
                  ) : (
                    <>
                      {busyUserId === row.userId && (
                        <Loader2
                          className='size-3.5 animate-spin text-muted-foreground'
                          aria-hidden
                        />
                      )}
                      {canShare && (
                        <button
                          type='button'
                          onClick={() => void removeContributor(row.userId, row.name)}
                          disabled={busyUserId !== null}
                          aria-label={`Remove ${row.name}`}
                          title={`Remove ${row.name}`}
                          data-track-category='Claw Agents'
                          data-track-name='Subagent detail v2: remove contributor'
                          className={ICON_BUTTON}
                        >
                          <MultipleCrossCancelDefault className='size-4' aria-hidden />
                        </button>
                      )}
                    </>
                  )
                }
              />
            ))
          )}
        </DetailCard>
      </DetailSection>

      <AddContributorDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingUserIds={existingUserIds}
        saving={busyUserId !== null}
        onAdd={target => void addContributor(target)}
      />
    </DetailStack>
  );
}
