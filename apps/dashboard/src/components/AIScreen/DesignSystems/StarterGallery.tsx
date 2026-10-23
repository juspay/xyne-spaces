import { useMemo, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { SpecimenView } from './SpecimenView';
import { orderedPalette, parseDesignTokens } from './designTokens';
import { STARTER_ATTRIBUTION, STARTER_SYSTEMS, type StarterSystem } from './starters';

function StarterCard({
  starter,
  selected,
  onSelect,
}: {
  starter: StarterSystem;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  const swatches = useMemo(
    () => orderedPalette(parseDesignTokens(starter.tokensCss).colors).slice(0, 5),
    [starter.tokensCss],
  );

  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition-colors',
        selected ? 'border-foreground bg-secondary/60' : 'border-border hover:bg-secondary/40',
      )}
      data-track-category='XyneAI'
      data-track-name='PREVIEW_STARTER_DESIGN_SYSTEM'
      data-track-metadata={JSON.stringify({ starter: starter.id })}
    >
      <div className='flex gap-1'>
        {swatches.map(color => (
          <span
            key={color.token}
            className='h-6 flex-1 rounded border border-border'
            style={{ background: color.hex ?? color.value }}
            aria-hidden
          />
        ))}
      </div>
      <div className='mt-2 truncate text-sm font-medium text-foreground'>{starter.name}</div>
      <div className='mt-0.5 text-xs text-muted-foreground'>{starter.summary}</div>
    </button>
  );
}

export function StarterGallery({
  onUse,
  isUsing,
}: {
  onUse: (starter: StarterSystem) => void;
  isUsing: boolean;
}): ReactElement {
  const [selectedId, setSelectedId] = useState(STARTER_SYSTEMS[0]?.id ?? '');
  const selected =
    STARTER_SYSTEMS.find(starter => starter.id === selectedId) ?? STARTER_SYSTEMS[0] ?? null;

  return (
    <div className='pb-10 pt-5'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {STARTER_SYSTEMS.map(starter => (
          <StarterCard
            key={starter.id}
            starter={starter}
            selected={selected?.id === starter.id}
            onSelect={() => setSelectedId(starter.id)}
          />
        ))}
      </div>

      <p className='mt-3 text-xs text-muted-foreground'>
        From{' '}
        <a
          href={STARTER_ATTRIBUTION.url}
          target='_blank'
          rel='noreferrer'
          className='underline underline-offset-2'
          data-track-category='XyneAI'
          data-track-name='OPEN_STARTER_ATTRIBUTION'
        >
          {STARTER_ATTRIBUTION.project}
        </a>
        , used under {STARTER_ATTRIBUTION.licence}. Using one copies it into your organisation as an
        editable system; the original is left alone.
      </p>

      {selected && (
        <>
          <div className='mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5'>
            <div className='min-w-0'>
              <h2 className='truncate text-base font-semibold text-foreground'>{selected.name}</h2>
              <p className='mt-0.5 text-xs text-muted-foreground'>{selected.summary}</p>
            </div>
            <Button
              size='sm'
              variant='outline'
              disabled={isUsing}
              onClick={() => onUse(selected)}
              data-track-category='XyneAI'
              data-track-name='USE_STARTER_DESIGN_SYSTEM'
              data-track-metadata={JSON.stringify({ starter: selected.id })}
            >
              {isUsing ? 'Adding…' : 'Use as a starting point'}
            </Button>
          </div>

          <div className='mt-5'>
            <SpecimenView tokensCss={selected.tokensCss} />
          </div>
        </>
      )}
    </div>
  );
}
