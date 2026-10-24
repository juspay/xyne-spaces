import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Switch } from '../../ui/Switch';
import { cn } from '../../../utils/classNames';
import { useV2ChatProjectActions } from '../../../hooks/useAskAISessionsV2';
import type { ChatProject } from '../../../services/XyneAI/XyneAISessionsV2Service';
import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  SECTION_HEADING_CLASS,
  instructionsCounter,
} from './projectHome.utils';

const SAVE_DEBOUNCE_MS = 800;

export function ProjectInstructionsCard({ project }: { project: ChatProject }): ReactElement {
  const { updateProject } = useV2ChatProjectActions();
  const [draft, setDraft] = useState(project.instructions);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<number | null>(null);
  const savedRef = useRef(project.instructions);
  const draftRef = useRef(project.instructions);
  /** The draft holds keystrokes the server has not acknowledged yet. */
  const dirtyRef = useRef(false);

  useEffect(() => {
    setDraft(project.instructions);
    draftRef.current = project.instructions;
    savedRef.current = project.instructions;
    dirtyRef.current = false;
    setStatus('idle');
    // Switching project adopts its text outright; a changed `instructions` on
    // the SAME project is handled below, where unsaved keystrokes win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    // Our own save echoing back through the cache, or an edit from another tab.
    // Adopting it while newer keystrokes are outstanding would retype the older
    // copy over them, so take it only when the draft is settled.
    if (dirtyRef.current) return;
    setDraft(project.instructions);
    draftRef.current = project.instructions;
    savedRef.current = project.instructions;
  }, [project.instructions]);

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
        // Settled only if nothing was typed while this was in flight.
        if (draftRef.current === value) dirtyRef.current = false;
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
    draftRef.current = value;
    dirtyRef.current = true;
    setStatus('idle');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
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
    <section>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className={SECTION_HEADING_CLASS}>Instructions</h2>
          <p className='mt-2 text-xs text-muted-foreground'>Added to every chat in this project.</p>
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
        rows={3}
        placeholder='What should the assistant know or do in every chat here?'
        data-track-category='XyneAI'
        data-track-name='EDIT_PROJECT_INSTRUCTIONS'
        data-track-metadata={JSON.stringify({ projectId: project.id })}
        aria-label='Project instructions'
        disabled={!project.instructionsEnabled}
        className={cn(
          'mt-3 w-full resize-y rounded-md border border-transparent bg-transparent px-0 py-1 text-sm text-foreground',
          'placeholder:text-muted-foreground focus:outline-none',
          counter.overLimit && 'border-destructive px-3',
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
