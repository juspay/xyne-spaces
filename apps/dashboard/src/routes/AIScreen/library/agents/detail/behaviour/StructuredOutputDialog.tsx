import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button/index';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import { validateBehaviour, type BehaviourDraft } from '@/services/claw/behaviourConfig';
import { TitledDialogV2 } from '../../../shared/primitives/TitledDialogV2';

const LABEL = 'text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground';
const FIELD =
  'w-full rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

const TYPE_OPTIONS = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
] as const;

interface StructuredOutputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  behaviour: BehaviourDraft;
  saving: boolean;
  onSave: (next: BehaviourDraft) => void;
}

export function StructuredOutputDialog({
  open,
  onOpenChange,
  behaviour,
  saving,
  onSave,
}: StructuredOutputDialogProps): ReactElement {
  const [draft, setDraft] = useState<BehaviourDraft>(behaviour);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({ ...behaviour, outputFormatEnabled: true });
      setError(null);
    }
  }, [open, behaviour]);

  const patch = (next: Partial<BehaviourDraft>): void => {
    setDraft(current => ({ ...current, ...next }));
    setError(null);
  };

  const submit = (): void => {
    const message = validateBehaviour(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
  };

  return (
    <TitledDialogV2
      open={open}
      onOpenChange={onOpenChange}
      title='Structured output'
      description='Constrain the final answer to a fixed shape.'
      testId='structured-output-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: cancel structured output'
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: save structured output'
          >
            Save
          </Button>
        </>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        The agent still works normally — only its final answer is constrained.
      </p>

      <section className='flex w-full flex-col gap-3'>
        <span className={LABEL}>Format</span>
        <Select
          value={draft.outputType}
          onValueChange={next => patch({ outputType: next === 'markdown' ? 'markdown' : 'json' })}
        >
          <SelectTrigger
            size='sm'
            aria-label='Output format'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: set output format'
            className='h-9 w-full gap-2 rounded-[10px]'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {draft.outputType === 'json' && (
        <section className='flex w-full flex-col gap-3'>
          <label htmlFor='behaviour-output-schema' className={LABEL}>
            JSON Schema
          </label>
          <textarea
            id='behaviour-output-schema'
            value={draft.outputSchema}
            onChange={e => patch({ outputSchema: e.target.value })}
            spellCheck={false}
            placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: output schema'
            className={`${FIELD} h-[180px] resize-y font-mono text-xs leading-5`}
          />
        </section>
      )}

      <section className='flex w-full flex-col gap-3'>
        <label htmlFor='behaviour-output-template' className={LABEL}>
          Template
        </label>
        <textarea
          id='behaviour-output-template'
          value={draft.outputTemplate}
          onChange={e => patch({ outputTemplate: e.target.value })}
          placeholder='Optional outline the answer should follow'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: output template'
          className={`${FIELD} h-[86px] resize-y`}
        />
      </section>

      <section className='flex w-full flex-col gap-3'>
        <label htmlFor='behaviour-output-require-tools' className={LABEL}>
          Required tools
        </label>
        <input
          id='behaviour-output-require-tools'
          value={draft.outputRequireTools}
          onChange={e => patch({ outputRequireTools: e.target.value })}
          placeholder='search, read-file'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: output required tools'
          className={`${FIELD} h-11 py-0`}
        />
        <span className='text-xs font-normal leading-4 tracking-[-0.24px] text-muted-foreground'>
          Comma separated. The agent can&apos;t submit an answer until it has called a tool whose
          name contains each of these.
        </span>
      </section>

      {error && (
        <p className='text-xs font-normal leading-4 tracking-[-0.24px] text-destructive'>{error}</p>
      )}
    </TitledDialogV2>
  );
}
