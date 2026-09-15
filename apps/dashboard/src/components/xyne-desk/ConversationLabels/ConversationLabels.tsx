import { JSX, useMemo, useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Check, Plus, Tag as TagIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { Popover } from '../../ui/Popover/Popover';

import { cn } from '../../../utils/classNames';

export type ConversationLabelSlot = 'chips' | 'picker' | 'inline-picker';

interface ConversationLabelsProps {
  conversationId: string;
  channelId: string;
  isMember: boolean;
  slot: ConversationLabelSlot;
  appliedMappings: ReadonlyArray<{
    id: string;
    labelId: string;
    labelName: string;
  }>;
}

// Fallback palette used when a label has no stored color. Deterministic per name
// so the same label always renders the same color (Gmail-style colored chips).
const LABEL_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

const colorForName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length] ?? '#6b7280';
};

/**
 * Gmail-style label chips + add/remove picker for a desk email conversation.
 * Labels are private per user: reads the current agent's own label catalog for this
 * channel and the labels they've applied to this conversation, and
 * applies/removes/creates labels via the conversationLabel mutators.
 */
export const ConversationLabels = ({
  conversationId,
  channelId,
  isMember,
  slot,
  appliedMappings,
}: ConversationLabelsProps): JSX.Element | null => {
  const zero = useZero();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [catalog] = useCachedQuery(
    queries.conversationLabelsByChannelIdV2({ channelId, isMember }),
    { enabled: !!channelId && (pickerOpen || slot === 'inline-picker') },
  );

  const appliedNames = useMemo(
    () => new Set(appliedMappings.map(m => m.labelName.toLowerCase())),
    [appliedMappings],
  );

  useEffect(() => {
    if (pickerOpen) inputRef.current?.focus();
    else setSearch('');
  }, [pickerOpen]);

  const filtered = useMemo(() => {
    const lower = search.toLowerCase().trim();
    const list = catalog ?? [];
    return lower ? list.filter(l => l.name.toLowerCase().includes(lower)) : list;
  }, [catalog, search]);

  const canCreate = useMemo(() => {
    const trimmed = search.trim();
    return !!trimmed && !(catalog ?? []).some(l => l.name.toLowerCase() === trimmed.toLowerCase());
  }, [search, catalog]);

  const applyLabel = async (labelName: string, color: string, labelId?: string): Promise<void> => {
    try {
      const result = await zero.mutate(
        mutators.conversationLabel.applyLabel({
          labelId: labelId ?? uuidv4(),
          labelName,
          color,
          conversationId,
          channelId,
          mappingId: uuidv4(),
          timestamp: Date.now(),
        }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to apply label');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply label');
    }
  };

  const removeLabel = async (labelId: string): Promise<void> => {
    try {
      const result = await zero.mutate(
        mutators.conversationLabel.removeLabel({ conversationId, labelId }),
      ).server;
      if (result.type === 'error') {
        throw new Error(result.error.message || 'Failed to remove label');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove label');
    }
  };

  const toggleByName = (labelId: string, name: string, color: string): void => {
    if (appliedNames.has(name.toLowerCase())) {
      const mapping = appliedMappings.find(m => m.labelName.toLowerCase() === name.toLowerCase());
      if (mapping) void removeLabel(mapping.labelId);
    } else {
      void applyLabel(name, color, labelId);
    }
    setSearch('');
  };

  const createAndApply = (): void => {
    const trimmed = search.trim();
    if (!canCreate) return;
    void applyLabel(trimmed, colorForName(trimmed));
    setSearch('');
  };

  const picker = (
    <div className='w-64 max-h-[280px] overflow-y-auto p-1'>
      <input
        ref={inputRef}
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const only = filtered.length === 1 ? filtered[0] : undefined;
            if (only) {
              toggleByName(only.id, only.name, only.color ?? colorForName(only.name));
            } else if (canCreate) {
              createAndApply();
            }
          } else if (e.key === 'Escape') {
            setPickerOpen(false);
          }
        }}
        placeholder='Search or create label…'
        className='w-full bg-transparent border-b border-border text-sm px-2 py-1.5 outline-none mb-1'
        data-track-category='Support'
        data-track-name='LabelSearchInput'
      />
      {filtered.map(label => {
        const selected = appliedNames.has(label.name.toLowerCase());
        const color = label.color ?? colorForName(label.name);
        return (
          <button
            key={label.id}
            type='button'
            onClick={() => toggleByName(label.id, label.name, color)}
            data-ph-capture-attribute-track-id='toggle_conversation_label'
            className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded text-left hover:bg-muted text-foreground'
            data-track-category='Support'
            data-track-name='ToggleConversationLabel'
          >
            <span className='flex items-center gap-2 min-w-0'>
              <span className='size-2.5 rounded-full shrink-0' style={{ backgroundColor: color }} />
              <span className='truncate'>{label.name}</span>
            </span>
            {selected && <Check className='size-4 text-foreground shrink-0' />}
          </button>
        );
      })}
      {filtered.length === 0 && !canCreate && (
        <div className='p-3 text-center text-sm text-muted-foreground'>No labels</div>
      )}
      {canCreate && (
        <div className='border-t border-border mt-1 pt-1'>
          <button
            type='button'
            onClick={createAndApply}
            data-ph-capture-attribute-track-id='create_conversation_label'
            className='flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded font-medium text-foreground hover:bg-muted'
            data-track-category='Support'
            data-track-name='CreateConversationLabel'
          >
            <Plus className='size-4' />
            Create &ldquo;{search.trim()}&rdquo;
          </button>
        </div>
      )}
    </div>
  );

  if (slot === 'inline-picker') {
    return <>{picker}</>;
  }

  if (slot === 'chips') {
    if (appliedMappings.length === 0) return null;
    return (
      <div className='flex items-center gap-1.5 flex-wrap min-w-0'>
        {appliedMappings.map(mapping => {
          const color = colorForName(mapping.labelName);
          return (
            <span
              key={mapping.id}
              className='inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md text-xs font-medium border border-border bg-card text-foreground'
            >
              <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: color }} />
              <span className='truncate max-w-[140px]'>{mapping.labelName}</span>
              <button
                type='button'
                aria-label={`Remove ${mapping.labelName}`}
                onClick={() => void removeLabel(mapping.labelId)}
                data-ph-capture-attribute-track-id='remove_conversation_label'
                className='hover:bg-muted rounded-full p-0.5'
                data-track-category='Support'
                data-track-name='RemoveConversationLabel'
              >
                <X className='size-2.5' />
              </button>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <Popover
      trigger={
        <button
          type='button'
          className={cn(
            'p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
          )}
          aria-label='Add label'
          title='Label'
          data-track-category='Support'
          data-track-name='OpenLabelPicker'
        >
          <TagIcon size={16} />
        </button>
      }
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      side='bottom'
      align='start'
      sideOffset={6}
      className='p-0'
    >
      {picker}
    </Popover>
  );
};
