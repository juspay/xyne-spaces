import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShortcutById } from '../../../shortcuts/hooks';
import { NAVIGATOR_ROOT_ATTR } from './collectClickables';
import { runNavigation, type NavigationRun, type NavigationStatus } from './runNavigation';
import { useNavigatorItems, type NavigatorItems } from './useNavigatorItems';

const NO_ITEMS: NavigatorItems = { canvas: [], dm: [], channel: [], agent: [] };

// Holds the canvas, DM, channel and agent subscriptions; mounted only while the box is open.
const ItemsSource = ({ onItems }: { onItems: (items: NavigatorItems) => void }): null => {
  const items = useNavigatorItems();
  useEffect(() => onItems(items), [items, onItems]);
  return null;
};

const STATUS_TEXT: Record<NavigationStatus, string> = {
  running: 'Finding the way…',
  reached: 'You are there.',
  stuck: "Couldn't find a way from here.",
  loop: 'Went in a circle, stopped.',
  maxSteps: 'Took too many steps, stopped.',
  unavailable: 'Navigation is unavailable right now.',
  cancelled: 'Stopped.',
};

// Strips the description back to what a person would call the element.
const shortLabel = (description: string): string => description.split(' — ')[0] ?? description;

/**
 * "Take me to…" box: type where you want to go and it takes you there, straight to the page or
 * item when it can and clicking through the screen when it can't. Text for now;
 * speech-to-text can call the same runNavigation later.
 */
const NavigatorInput = (): ReactElement | null => {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const [run, setRun] = useState<NavigationRun | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<NavigatorItems>(NO_ITEMS);
  const navigate = useNavigate();
  const setItems = useCallback((items: NavigatorItems) => {
    itemsRef.current = items;
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const close = useCallback(() => {
    cancel();
    setOpen(false);
    setRun(null);
  }, [cancel]);

  useShortcutById('assistant.navigate', () => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    const text = goal.trim();
    if (!text) return;
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    await runNavigation(text, controller.signal, setRun, {
      navigate: path => {
        void navigate(path);
      },
      getItems: () => itemsRef.current,
    });
    if (controllerRef.current === controller) controllerRef.current = null;
  }, [cancel, goal, navigate]);

  if (!open) return null;

  const running = run?.status === 'running';

  return (
    <div
      {...{ [NAVIGATOR_ROOT_ATTR]: '' }}
      className='fixed bottom-6 left-1/2 z-[1000] flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-lg'
    >
      <ItemsSource onItems={setItems} />
      <form
        className='flex items-center gap-2'
        onSubmit={event => {
          event.preventDefault();
          void start();
        }}
      >
        <input
          ref={inputRef}
          value={goal}
          onChange={event => setGoal(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              if (running) cancel();
              else close();
            }
          }}
          placeholder='Take me to… e.g. agent hub'
          aria-label='Where do you want to go?'
          className='min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
          data-track-category='Assistant'
          data-track-name='NAVIGATOR_INPUT'
        />
        <button
          type={running ? 'button' : 'submit'}
          onClick={running ? cancel : undefined}
          className='rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground hover:bg-accent'
          data-track-category='Assistant'
          data-track-name={running ? 'NAVIGATOR_STOP' : 'NAVIGATOR_GO'}
        >
          {running ? 'Stop' : 'Go'}
        </button>
      </form>
      {run && (
        <div className='flex flex-col gap-1 text-[12px] leading-[16px] text-muted-foreground'>
          <ol className='flex flex-col gap-1'>
            {run.steps.map((step, index) => (
              <li key={`${index}-${step.urlAfter}`} className='truncate'>
                {index + 1}. Clicked “{shortLabel(step.clicked)}” → {step.urlAfter}
              </li>
            ))}
          </ol>
          <span className={run.status === 'reached' ? 'text-foreground' : undefined}>
            {STATUS_TEXT[run.status]}
            {run.detail ? ` (${run.detail})` : ''}
          </span>
        </div>
      )}
    </div>
  );
};

export default NavigatorInput;
