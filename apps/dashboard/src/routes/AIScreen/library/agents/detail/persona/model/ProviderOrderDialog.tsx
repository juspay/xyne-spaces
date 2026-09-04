import { useEffect, useState, type ReactElement } from 'react';
import { ChevronBigDown, ChevronBigUp, MultipleCrossCancelDefault, PlusDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button/index';
import { HOSTED_PROVIDERS, PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';
import { V2Dialog } from '../../../../shared/primitives/V2Dialog';

const ICON_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

interface ProviderOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: readonly string[];
  saving: boolean;
  onSave: (next: string[]) => void;
}

export function ProviderOrderDialog({
  open,
  onOpenChange,
  order,
  saving,
  onSave,
}: ProviderOrderDialogProps): ReactElement {
  const [draft, setDraft] = useState<string[]>([...order]);

  useEffect(() => {
    if (open) setDraft([...order]);
  }, [open, order]);

  const available = HOSTED_PROVIDERS.filter(provider => !draft.includes(provider));

  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setDraft(next);
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Providers'
      description='Top to bottom order. The first provider is used, the rest are fallbacks.'
      testId='provider-order-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: cancel provider order'
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(draft)}
            loading={saving}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: save provider order'
          >
            Save
          </Button>
        </>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        Runs use the first provider and fall through the rest on quota limits.
      </p>

      <section className='flex w-full flex-col gap-3'>
        <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
          Order
        </span>

        {draft.length === 0 ? (
          <p className='text-sm font-normal leading-5 text-muted-foreground'>
            No providers chosen — runs use the Spaces platform model.
          </p>
        ) : (
          <div className='flex w-full flex-col gap-2'>
            {draft.map((provider, index) => (
              <div
                key={provider}
                className='flex h-11 w-full items-center gap-2 rounded-[10px] border-[0.8px] border-border bg-muted px-3'
              >
                <span className='w-4 shrink-0 text-xs font-normal leading-4 tabular-nums text-muted-foreground'>
                  {index + 1}
                </span>
                <span className='min-w-0 flex-1 truncate text-sm font-medium leading-5 text-foreground'>
                  {PROVIDER_DISPLAY[provider] ?? provider}
                </span>
                <button
                  type='button'
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${provider} up`}
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: move provider up'
                  className={ICON_BUTTON}
                >
                  <ChevronBigUp className='size-4' aria-hidden />
                </button>
                <button
                  type='button'
                  onClick={() => move(index, 1)}
                  disabled={index === draft.length - 1}
                  aria-label={`Move ${provider} down`}
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: move provider down'
                  className={ICON_BUTTON}
                >
                  <ChevronBigDown className='size-4' aria-hidden />
                </button>
                <button
                  type='button'
                  onClick={() => setDraft(draft.filter(entry => entry !== provider))}
                  aria-label={`Remove ${provider}`}
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: remove provider'
                  className={ICON_BUTTON}
                >
                  <MultipleCrossCancelDefault className='size-4' aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {available.length > 0 && (
        <section className='flex w-full flex-col gap-3'>
          <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
            Add a provider
          </span>
          <div className='flex flex-wrap items-start gap-2'>
            {available.map(provider => (
              <button
                key={provider}
                type='button'
                onClick={() => setDraft([...draft, provider])}
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: add provider'
                className='flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-[10px] border-[0.8px] border-dashed border-border bg-card px-2 transition-colors hover:bg-muted/50'
              >
                <span className='max-w-[200px] truncate text-sm font-medium leading-5 text-foreground/80'>
                  {PROVIDER_DISPLAY[provider] ?? provider}
                </span>
                <PlusDefault className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}
    </V2Dialog>
  );
}
