import { useMemo, useState, type ReactElement } from 'react';
import { InformationCircle, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import { BrowseKnowledgeDialog } from './BrowseKnowledgeDialog';
import { buildKbIndex, describeGrants, removeGrant, type KbScope } from './knowledgeCatalog';

const CAPTION = 'Give your agent trusted information to reference.';

interface KnowledgeCapabilityRowProps {
  scope: KbScope;
  onScopeChange: (next: KbScope) => void;
  grants: KbSelection[];
  onGrantsChange: (next: KbSelection[]) => void;
}

export function KnowledgeCapabilityRow({
  scope,
  onScopeChange,
  grants,
  onGrantsChange,
}: KnowledgeCapabilityRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const tree = useClawKnowledgeBaseTree();

  const labels = useMemo(() => {
    const index = buildKbIndex(tree.data?.collections ?? []);
    return describeGrants(grants, index);
  }, [tree.data?.collections, grants]);

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-xyne-fg-primary'>
              Knowledge
            </span>
            <Tooltip side='top' content={CAPTION}>
              <span className='inline-flex'>
                <InformationCircle className='size-4 text-xyne-fg-muted' aria-hidden />
              </span>
            </Tooltip>
          </div>
          <span className='truncate text-xs leading-5 tracking-[-0.24px] text-xyne-fg-muted'>
            {scope === 'USER'
              ? 'Matches the running user’s access'
              : grants.length > 0
                ? `${grants.length} grant${grants.length === 1 ? '' : 's'} attached`
                : 'No collections attached'}
          </span>
        </div>

        <button
          type='button'
          onClick={() => setBrowseOpen(true)}
          aria-label='Browse knowledge'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: browse knowledge'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-xyne-fg-muted transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-xyne-fg-muted'>{CAPTION}</p>

      {scope === 'COLLECTIONS' && labels.length > 0 && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {labels.map(grant => (
            <button
              key={grant.key}
              type='button'
              onClick={() => onGrantsChange(removeGrant(grants, grant.selection))}
              title={grant.detail ? `${grant.label} · ${grant.detail}` : grant.label}
              aria-label={`Remove ${grant.label}`}
              data-track-category='Claw Agents'
              data-track-name='Create agent v2: remove KB grant'
              className='flex shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-solid border-xyne-border bg-xyne-surface-sunken py-1 pl-2.5 pr-2 transition-colors hover:bg-xyne-surface-subtle'
            >
              <span className='flex min-w-0 flex-col items-start'>
                <span className='max-w-[220px] truncate text-sm font-medium leading-5 text-xyne-fg-primary'>
                  {grant.label}
                </span>
                {grant.detail && (
                  <span className='max-w-[220px] truncate text-xs leading-4 text-xyne-fg-muted'>
                    {grant.detail}
                  </span>
                )}
              </span>
              <MultipleCrossCancelDefault
                className='size-3 shrink-0 text-xyne-fg-muted'
                aria-hidden
              />
            </button>
          ))}
        </div>
      )}

      <BrowseKnowledgeDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        scope={scope}
        onScopeChange={onScopeChange}
        grants={grants}
        onGrantsChange={onGrantsChange}
      />
    </div>
  );
}
