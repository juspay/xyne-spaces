import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Switch } from '../../ui/Switch';
import { cn } from '../../../utils/classNames';
import { useV2ChatProjectActions } from '../../../hooks/useAskAISessionsV2';
import type { ChatProject } from '../../../services/XyneAI/XyneAISessionsV2Service';
import { PROJECT_INSTRUCTIONS_MAX_CHARS, instructionsCounter } from './projectHome.utils';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Instructions every chat in the project inherits.
 *
 * Typing saves on a debounce; the toggle saves at once. They are split because
 * they fail differently: a dropped keystroke is recoverable from what is still
 * on screen, but a toggle that looks flipped and was not would leave the user
 * believing their instructions are off while every run still reads them.
 */
export function ProjectInstructionsCard({ project }: { project: ChatProject }): ReactElement {
  const { updateProject } = useV2ChatProjectActions();
  const [draft, setDraft] = useState(project.instructions);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<number | null>(null);
  // The last value the server accepted, so an unchanged draft never re-saves
  // and a failed save can be retried by typing again.
  const savedRef = useRef(project.instructions);

  // A project switched underneath this card (sidebar navigation) must not
  // carry the previous project's draft into it.
  useEffect(() => {
    setDraft(project.instructions);
    savedRef.current = project.instructions;
    setStatus('idle');
  }, [project.id, project.instructions]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const counter = instructionsCounter(draft);

  const save = useCallback(
    async (value: string): Promise<void> => {
      if (value === savedRef.current) return;
      setStatus('saving');
      try {
        await updateProject(project.id, { instructions: value });
        savedRef.current = value;
        setStatus('saved');
      } catch {
        setStatus('idle');
        toast.error('Could not save instructions');
      }
    },
    [project.id, updateProject],
  );

  const onChange = (value: string): void => {
    setDraft(value);
    setStatus('idle');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    // Over the limit the server would reject it, so nothing is sent until the
    // user is back inside it — the counter already says why.
    if (value.length > PROJECT_INSTRUCTIONS_MAX_CHARS) return;
    timerRef.current = window.setTimeout(() => void save(value), SAVE_DEBOUNCE_MS);
  };

  const onToggle = async (next: boolean): Promise<void> => {
    try {
      await updateProject(project.id, { instructionsEnabled: next });
    } catch {
      toast.error(next ? 'Could not turn instructions on' : 'Could not turn instructions off');
    }
  };

  return (
    <section className='rounded-xl border border-border bg-card p-4 sm:p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-sm font-medium text-foreground'>Instructions</h2>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Added to every chat in this project.
          </p>
        </div>
        <Switch
          checked={project.instructionsEnabled}
          onCheckedChange={next => void onToggle(next)}
          aria-label='Use these instructions'
        />
      </div>

      <textarea
        value={draft}
        onChange={event => onChange(event.target.value)}
        onBlur={() => {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          if (counter.overLimit) return;
          void save(draft);
        }}
        rows={8}
        placeholder='What should the assistant know or do in every chat here?'
        data-track-category='XyneAI'
        data-track-name='EDIT_PROJECT_INSTRUCTIONS'
        data-track-metadata={JSON.stringify({ projectId: project.id })}
        aria-label='Project instructions'
        disabled={!project.instructionsEnabled}
        className={cn(
          'mt-3 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm text-foreground',
          'placeholder:text-muted-foreground focus:outline-none focus:ring-1',
          counter.overLimit
            ? 'border-destructive focus:ring-destructive'
            : 'border-border focus:ring-ring',
          !project.instructionsEnabled && 'opacity-60',
        )}
      />

      <div className='mt-2 flex items-center justify-between gap-3 text-xs'>
        <span className='text-muted-foreground' aria-live='polite'>
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
        <span
          className={counter.overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}
        >
          {counter.overLimit
            ? `${-counter.remaining} over the ${PROJECT_INSTRUCTIONS_MAX_CHARS.toLocaleString()} limit`
            : `${counter.used.toLocaleString()} / ${PROJECT_INSTRUCTIONS_MAX_CHARS.toLocaleString()}`}
        </span>
      </div>
    </section>
  );
}
