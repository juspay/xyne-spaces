import { ReactElement, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import type { RoomChecklistItemDraft } from '@xyne/shared';
import {
  CHECKLIST_ITEMS_MAX,
  createEmptyChecklistItem,
  hasIncompleteChecklistRows,
  parseChecklistItems,
  serializeChecklistItems,
} from './Rooms.utils';

interface RoomChecklistTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onIncompleteChange?: (hasIncomplete: boolean) => void;
}

export function RoomChecklistTemplateEditor({
  value,
  onChange,
  disabled,
  onIncompleteChange,
}: RoomChecklistTemplateEditorProps): ReactElement {
  const [items, setItems] = useState<RoomChecklistItemDraft[]>(() => parseChecklistItems(value));
  const lastEmitted = useRef(serializeChecklistItems(items));

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setItems(parseChecklistItems(value));
    }
  }, [value]);

  const commit = (next: RoomChecklistItemDraft[]): void => {
    setItems(next);
    const md = serializeChecklistItems(next);
    lastEmitted.current = md;
    onChange(md);
  };

  const update = (id: string, field: 'point' | 'condition', v: string): void =>
    commit(items.map(item => (item.id === id ? { ...item, [field]: v } : item)));
  const remove = (id: string): void => commit(items.filter(item => item.id !== id));
  const add = (): void => commit([...items, createEmptyChecklistItem()]);

  const incomplete = hasIncompleteChecklistRows(items);
  useEffect(() => {
    onIncompleteChange?.(incomplete);
  }, [incomplete, onIncompleteChange]);

  useEffect(() => () => onIncompleteChange?.(false), [onIncompleteChange]);

  const atCap = items.length >= CHECKLIST_ITEMS_MAX;
  const nearSizeLimit = serializeChecklistItems(items).length > 4800;

  return (
    <div className='flex flex-col gap-3' data-testid='room-checklist-items-editor'>
      {items.length === 0 && (
        <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
          No checklist items yet — optional, but the agent can only tick off points you define here.
        </p>
      )}

      {items.map((item, index) => {
        const pointOnly = !!item.point.trim() && !item.condition.trim();
        const condOnly = !item.point.trim() && !!item.condition.trim();
        return (
          <div key={item.id} className='flex flex-col gap-2 rounded-xl border border-border p-3'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-muted-foreground'>Point {index + 1}</span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                aria-label='Remove item'
                disabled={disabled}
                onClick={() => remove(item.id)}
                data-testid={`checklist-remove-${index}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <Input
              value={item.point}
              disabled={disabled}
              maxLength={200}
              onChange={event => update(item.id, 'point', event.target.value)}
              placeholder='What to track — e.g. Refund latency under 200ms'
              aria-label='Checklist point'
              data-testid={`checklist-point-${index}`}
            />
            <Textarea
              value={item.condition}
              disabled={disabled}
              rows={2}
              maxLength={1000}
              onChange={event => update(item.id, 'condition', event.target.value)}
              placeholder='Done when… — e.g. p95 refund latency stays under 200ms for 24h'
              aria-label='Checklist condition'
              data-testid={`checklist-condition-${index}`}
            />
            {pointOnly && (
              <p className='text-xs text-destructive'>
                Add a condition — the agent needs it to tick this point.
              </p>
            )}
            {condOnly && (
              <p className='text-xs text-destructive'>Add the point this condition is for.</p>
            )}
          </div>
        );
      })}

      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || atCap || nearSizeLimit}
          onClick={add}
          data-testid='checklist-add-item'
        >
          <Plus size={14} />
          Add checklist item
        </Button>
        {atCap && (
          <span className='text-xs text-muted-foreground'>Max {CHECKLIST_ITEMS_MAX} items.</span>
        )}
        {!atCap && nearSizeLimit && (
          <span className='text-xs text-muted-foreground'>Checklist is near the size limit.</span>
        )}
      </div>
    </div>
  );
}
