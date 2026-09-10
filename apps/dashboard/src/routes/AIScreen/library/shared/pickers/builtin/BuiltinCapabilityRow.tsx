import { useMemo, useState, type ReactElement } from 'react';
import { Ai01, InformationCircle, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { DotGridLoader } from '../mcp/DotGridLoader';
import { BrowseBuiltinToolsDialog } from './BrowseBuiltinToolsDialog';
import { BuiltinChip } from './BuiltinChip';
import { disableEntry, enableEntry, isEntryEnabled, type BuiltinSelection } from './builtinCatalog';
import { useBuiltinCatalog } from './useBuiltinCatalog';
import { useBuiltinSuggestions } from './useBuiltinSuggestions';

const CAPTION = 'Let your agent search, create, and take action.';

interface BuiltinCapabilityRowProps {
  selection: BuiltinSelection;
  onSelectionChange: (next: BuiltinSelection) => void;
  suggestContext: { systemPrompt: string; description: string };
}

export function BuiltinCapabilityRow({
  selection,
  onSelectionChange,
  suggestContext,
}: BuiltinCapabilityRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const { entries, loading, isError, refetch } = useBuiltinCatalog();
  const suggestions = useBuiltinSuggestions(entries, suggestContext);

  const selectedEntries = useMemo(
    () => entries.filter(entry => isEntryEnabled(selection, entry)),
    [entries, selection],
  );
  const suggestedChips = useMemo(
    () => suggestions.suggested.filter(match => !isEntryEnabled(selection, match.entry)),
    [suggestions.suggested, selection],
  );

  const renderSuggestAction = (): ReactElement => {
    if (suggestions.status === 'loading') {
      return (
        <span className='flex items-center gap-2'>
          <DotGridLoader />
          <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
            Loading suggestions
          </span>
        </span>
      );
    }

    if (suggestions.status === 'error') {
      return (
        <span className='flex items-center gap-2 text-xs leading-5 tracking-[-0.24px]'>
          <span className='text-muted-foreground'>
            Couldn&apos;t suggest tools{suggestions.error ? ` — ${suggestions.error}` : ''}
          </span>
          <button
            type='button'
            onClick={suggestions.run}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: retry built-in suggestions'
            className='font-medium text-foreground underline-offset-2 hover:underline'
          >
            Try again
          </button>
        </span>
      );
    }

    const action = (
      <button
        type='button'
        onClick={suggestions.run}
        disabled={!suggestions.canRun || loading}
        data-track-category='Claw Agents'
        data-track-name='Create agent v2: suggest built-in tools'
        className='flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs leading-5 tracking-[-0.24px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
      >
        <Ai01 className='size-3.5 shrink-0' aria-hidden />
        {suggestions.status === 'ready' ? 'Suggest again' : 'Suggest tools'}
      </button>
    );

    return suggestions.canRun ? (
      action
    ) : (
      <Tooltip side='top' content='Describe what this agent does first'>
        <span className='inline-flex'>{action}</span>
      </Tooltip>
    );
  };

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
              Built in tools
            </span>
            <Tooltip side='top' content={CAPTION}>
              <span className='inline-flex'>
                <InformationCircle className='size-4 text-muted-foreground' aria-hidden />
              </span>
            </Tooltip>
          </div>
          {renderSuggestAction()}
        </div>

        <button
          type='button'
          onClick={() => setBrowseOpen(true)}
          aria-label='Browse built in tools'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: browse built-in tools'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{CAPTION}</p>

      {(selectedEntries.length > 0 || suggestedChips.length > 0) && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {selectedEntries.map(entry => (
            <BuiltinChip
              key={`selected-${entry.source}`}
              label={entry.label}
              selected
              onToggle={() => onSelectionChange(disableEntry(selection, entry))}
            />
          ))}
          {suggestedChips.map(match => (
            <BuiltinChip
              key={`suggested-${match.entry.source}`}
              label={match.entry.label}
              selected={false}
              onToggle={() => onSelectionChange(enableEntry(selection, match.entry, match.tools))}
            />
          ))}
        </div>
      )}

      {suggestions.status === 'ready' && suggestions.suggested.length === 0 && (
        <p className='text-xs text-muted-foreground'>
          No built-in tool matched this agent — browse the full list to pick one yourself.
        </p>
      )}

      <BrowseBuiltinToolsDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        catalog={entries}
        loading={loading}
        isError={isError}
        onRetry={refetch}
        selection={selection}
        onSelectionChange={onSelectionChange}
        suggested={suggestions.suggested}
      />
    </div>
  );
}
