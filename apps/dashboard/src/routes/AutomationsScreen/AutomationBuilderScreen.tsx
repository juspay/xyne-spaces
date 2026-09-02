import { ReactElement, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { AutomationBuilder } from '../../components/Automation/AutomationBuilder/AutomationBuilder';
import { VersionHistory } from '../../components/Automation/AutomationVersions/VersionHistory/VersionHistory';
import { VersionDiffView } from '../../components/Automation/AutomationVersions/VersionDiffView/VersionDiffView';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useOverlayEffect } from '../../machines/stateMachine';
import { queries } from '../../zero/queries';
import {
  isAutomationWorkflow,
  workflowToAutomation,
} from '../../components/Automation/automation.adapter';

export default function AutomationBuilderScreen(): ReactElement {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const proposalId = searchParams.get('proposal');
  const fromApprovals = searchParams.get('from') === 'approvals' || !!proposalId;
  const forkFromId = searchParams.get('fork');
  const isClone = searchParams.get('clone') === '1';

  // Version panel state lives in the URL — `panel=versions` (+ `versionsId`,
  // the automation id it's showing) for the sidebar list, plus `cmpFrom`/
  // `cmpTo` for a specific comparison — so it survives a refresh, is
  // shareable, and the browser back button steps back through it. Opening a
  // panel pushes a history entry (so Back closes it); closing/tweaking it
  // replaces the current entry instead of piling up forward-only junk.
  const panel = searchParams.get('panel');
  const versionsId = searchParams.get('versionsId') ?? params.id ?? null;
  const cmpFrom = searchParams.get('cmpFrom');
  const cmpTo = searchParams.get('cmpTo');

  const setPanelParams = (
    next: Record<string, string | null>,
    options?: { replace?: boolean },
  ): void => {
    setSearchParams(
      prev => {
        const merged = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value === null) merged.delete(key);
          else merged.set(key, value);
        }
        return merged;
      },
      { replace: options?.replace ?? true },
    );
  };

  const isComparing = !!(cmpFrom && cmpTo);
  const versionsPanelOpen = panel === 'versions' && !isComparing;
  useOverlayEffect(versionsPanelOpen);

  const isNew = !params.id || params.id === 'new';
  const { workspaceId } = useAuthContextValues();

  const rowIdToLoad = proposalId ?? params.id ?? '';

  const [row, rowMeta] = useCachedQuery(queries.automationById({ id: rowIdToLoad, workspaceId }), {
    enabled: !isNew,
  });
  const [forkRow, forkRowMeta] = useCachedQuery(
    queries.automationById({ id: forkFromId ?? '', workspaceId }),
    { enabled: isNew && !!forkFromId },
  );
  const automation = useMemo(
    () => (row && isAutomationWorkflow(row) ? workflowToAutomation(row) : null),
    [row],
  );
  const forkSource = useMemo(
    () => (forkRow && isAutomationWorkflow(forkRow) ? workflowToAutomation(forkRow) : null),
    [forkRow],
  );

  const isLoading =
    (!isNew && (!rowMeta || rowMeta.type !== 'complete') && !automation) ||
    (isNew && !!forkFromId && (!forkRowMeta || forkRowMeta.type !== 'complete') && !forkSource);

  if (isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-muted-foreground'>
        <Loader2 className='mr-2 size-4 animate-spin' />
        Loading automation…
      </div>
    );
  }

  if (!isNew && rowMeta?.type === 'complete' && !automation) {
    return (
      <div className='flex h-full w-full items-center justify-center text-sm text-red-600'>
        Automation not found.
      </div>
    );
  }

  if (cmpFrom && cmpTo && versionsId) {
    return (
      <VersionDiffView
        automationId={versionsId}
        fromId={cmpFrom}
        toId={cmpTo}
        onFromChange={id => setPanelParams({ cmpFrom: id })}
        onToChange={id => setPanelParams({ cmpTo: id })}
        onClose={() => setPanelParams({ cmpFrom: null, cmpTo: null })}
      />
    );
  }

  return (
    <div className='flex h-full min-h-0 w-full'>
      <div className='min-w-0 flex-1'>
        {/* `key` forces a fresh mount whenever the route's automation id (or
          fork source) changes — otherwise React reuses the same component
          and useState values like editMode / name / config carry over from
          the previous automation. */}
        <AutomationBuilder
          key={isNew ? `new-${forkFromId ?? 'fresh'}` : (params.id ?? '')}
          automation={isNew ? null : automation}
          {...(forkSource && isNew
            ? {
                initialConfig: forkSource.config,
                initialName: isClone ? `${forkSource.name.slice(0, 72)} - Clone` : forkSource.name,
                ...(forkSource.description ? { initialDescription: forkSource.description } : {}),
                // Clones start an independent lineage — forks stay pinned to the source.
                ...(forkFromId && !isClone
                  ? {
                      forkFromSeriesId: forkSource.automationSeriesId ?? forkSource.id,
                      forkSourceAutomationId: forkFromId,
                    }
                  : {}),
              }
            : {})}
          approvalReviewMode={fromApprovals}
          onBack={() => void navigate(fromApprovals ? '../approvals' : '..', { relative: 'path' })}
          onSaved={result => {
            if (isNew) {
              void navigate(`../${result.automation.id}`, { replace: true, relative: 'path' });
            }
          }}
          onShowRuns={id => void navigate(`../${id}/runs`, { relative: 'path' })}
          onShowVersionHistory={id =>
            setPanelParams({ panel: 'versions', versionsId: id }, { replace: false })
          }
          onAfterApprovalDecision={() => void navigate('../approvals', { relative: 'path' })}
        />
      </div>

      {/* Rendered inline (no Portal, no `fixed`) as a flex sibling so it
          pushes/shrinks the builder pane instead of overlaying it — a real
          docked sidebar, not a modal. `modal={false}` keeps the builder pane
          interactive; outside clicks don't dismiss it, only Back/Escape do. */}
      <DialogPrimitive.Root
        open={versionsPanelOpen}
        modal={false}
        onOpenChange={open => {
          if (!open) setPanelParams({ panel: null, versionsId: null });
        }}
      >
        <DialogPrimitive.Content
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          className='flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-background outline-none'
        >
          <DialogPrimitive.Title className='hidden'>Version history</DialogPrimitive.Title>
          {versionsId && (
            <VersionHistory
              automationId={versionsId}
              onBack={() => setPanelParams({ panel: null, versionsId: null })}
              onOpenVersion={version => void navigate(`/automations/${version.id}`)}
              onCompare={(fromId, toId) =>
                setPanelParams({ cmpFrom: fromId, cmpTo: toId }, { replace: false })
              }
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
    </div>
  );
}
