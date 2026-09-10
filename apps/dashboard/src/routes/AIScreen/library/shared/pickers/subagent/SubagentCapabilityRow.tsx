import { useMemo, useState, type ReactElement } from 'react';
import { Ai01, InformationCircle, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { DotGridLoader } from '../mcp/DotGridLoader';
import { BrowseSubagentsDialog } from './BrowseSubagentsDialog';
import { SubagentChip } from './SubagentChip';
import {
  disableSubagent,
  enableSubagent,
  isSubagentSelected,
  type SubagentSelection,
} from './subagentCatalog';
import { useSubagentCatalog } from './useSubagentCatalog';
import { useSubagentSuggestions } from './useSubagentSuggestions';

const CAPTION = 'Delegate specialized tasks to focused agents.';

interface SubagentCapabilityRowProps {
  selection: SubagentSelection;
  onSelectionChange: (next: SubagentSelection) => void;
  suggestContext: { systemPrompt: string; description: string };
}

export function SubagentCapabilityRow({
  selection,
  onSelectionChange,
  suggestContext,
}: SubagentCapabilityRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const { entries, loading, isError, refetch } = useSubagentCatalog();
  const suggestions = useSubagentSuggestions(entries, suggestContext);

  const selectedEntries = useMemo(
    () => entries.filter(entry => isSubagentSelected(selection, entry)),
    [entries, selection],
  );
  const suggestedChips = useMemo(
    () => suggestions.suggested.filter(entry => !isSubagentSelected(selection, entry)),
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
            Couldn&apos;t suggest subagents{suggestions.error ? ` — ${suggestions.error}` : ''}
          </span>
          <button
            type='button'
            onClick={suggestions.run}
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: retry subagent suggestions'
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
        data-track-name='Create agent v2: suggest subagents'
        className='flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs leading-5 tracking-[-0.24px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
      >
        <Ai01 className='size-3.5 shrink-0' aria-hidden />
        {suggestions.status === 'ready' ? 'Suggest again' : 'Suggest subagents'}
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
              Subagent
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
          aria-label='Browse subagents'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: browse subagents'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{CAPTION}</p>

      {(selectedEntries.length > 0 || suggestedChips.length > 0) && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {selectedEntries.map(entry => (
            <SubagentChip
              key={`selected-${entry.name}`}
              label={entry.name}
              selected
              onToggle={() => onSelectionChange(disableSubagent(selection, entry))}
            />
          ))}
          {suggestedChips.map(entry => (
            <SubagentChip
              key={`suggested-${entry.name}`}
              label={entry.name}
              selected={false}
              onToggle={() => onSelectionChange(enableSubagent(selection, entry))}
            />
          ))}
        </div>
      )}

      {suggestions.status === 'ready' && suggestions.suggested.length === 0 && (
        <p className='text-xs text-muted-foreground'>
          No subagent matched this agent — browse the full list to pick one yourself.
        </p>
      )}

      <BrowseSubagentsDialog
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
