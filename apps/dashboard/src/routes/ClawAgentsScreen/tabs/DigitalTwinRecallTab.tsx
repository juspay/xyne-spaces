import { FormEvent, ReactElement, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FlaskConical, Search } from '@/components/ClawAgents/digitalTwin/icons';
import { Button } from '@/components/ui/Button';
import { useRecallDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { isDigitalTwinDemoMode } from '@/services/claw/digitalTwinDemo';
import type { RecallResult } from '@/services/claw/digitalTwinTypes';
import {
  DIGITAL_TWIN_EASE_IN,
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
  digitalTwinStaggerDelay,
} from '@/components/ClawAgents/digitalTwin/motion';

type Budget = 'low' | 'mid' | 'high';

const BUDGETS: Array<{ value: Budget; label: string; help: string }> = [
  { value: 'low', label: 'Focused', help: 'Fastest, narrowest match' },
  { value: 'mid', label: 'Balanced', help: 'Recommended for most checks' },
  { value: 'high', label: 'Broad', help: 'Searches more surrounding context' },
];

const DEMO_QUERY = 'How should I communicate product changes?';

const DigitalTwinRecallTab = (): ReactElement => {
  const reduceMotion = useReducedMotion();
  const demoMode = isDigitalTwinDemoMode();
  const [query, setQuery] = useState(demoMode ? DEMO_QUERY : '');
  const [budget, setBudget] = useState<Budget>('mid');
  const [results, setResults] = useState<RecallResult[] | null>(null);
  const recall = useRecallDigitalTwin();
  const demoRecallStarted = useRef(false);
  const { mutate } = recall;

  useEffect(() => {
    if (!demoMode || demoRecallStarted.current) return;
    demoRecallStarted.current = true;
    mutate({ query: DEMO_QUERY, budget: 'mid' }, { onSuccess: setResults });
  }, [demoMode, mutate]);

  const submit = (event?: FormEvent): void => {
    event?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    recall.mutate({ query: trimmed, budget }, { onSuccess: setResults });
  };

  return (
    <div className='flex max-w-5xl flex-col gap-7'>
      <div>
        <p className='dt-accent text-sm font-bold'>Inspect · Recall lab</p>
        <h2 className='dt-display mt-1 text-2xl font-semibold text-[var(--dt-ink)]'>
          Test what the Twin can retrieve
        </h2>
        <p className='dt-muted mt-2 max-w-[68ch] text-base'>
          This diagnostic search does not change memory. Use it to check whether a real question
          finds the knowledge you expect.
        </p>
      </div>

      <form onSubmit={submit} className='border-y dt-rule py-6'>
        <label
          htmlFor='digital-twin-recall-query'
          className='block text-base font-semibold text-[var(--dt-ink)]'
        >
          Question or phrase
        </label>
        <p className='dt-muted mt-1 text-sm'>
          Use the wording someone might use when mentioning you.
        </p>
        <textarea
          id='digital-twin-recall-query'
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder='For example: What did I decide about the onboarding rollout?'
          rows={4}
          className='mt-3 w-full resize-y rounded-lg border dt-rule bg-[var(--dt-paper-raised)] px-4 py-3 text-base leading-7 text-[var(--dt-ink)]'
          data-track-category='Claw Agents'
          data-track-name='Digital Twin recall query'
        />

        <fieldset className='mt-5'>
          <legend className='text-sm font-semibold text-[var(--dt-ink)]'>Search breadth</legend>
          <div className='mt-2 grid gap-px bg-[var(--dt-rule)] sm:grid-cols-3'>
            {BUDGETS.map(option => (
              <label
                key={option.value}
                className={
                  budget === option.value
                    ? 'dt-paper-raised dt-selectable flex min-h-20 cursor-pointer gap-3 bg-[var(--dt-accent-soft)] p-3'
                    : 'dt-paper-raised dt-selectable flex min-h-20 cursor-pointer gap-3 p-3'
                }
              >
                <input
                  type='radio'
                  name='recall-budget'
                  value={option.value}
                  checked={budget === option.value}
                  onChange={() => setBudget(option.value)}
                  aria-label={`${option.label}: ${option.help}`}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin change recall breadth'
                  className='mt-1 size-4 accent-[var(--dt-accent)]'
                />
                <span>
                  <span className='block font-semibold text-[var(--dt-ink)]'>{option.label}</span>
                  <span className='dt-muted mt-1 block text-sm'>{option.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Button
          type='submit'
          className='dt-control dt-pressable mt-5 bg-[var(--dt-accent)] text-[var(--dt-on-accent)] hover:bg-[var(--dt-accent)] hover:opacity-90'
          disabled={!query.trim()}
          loading={recall.isPending}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin test recall'
        >
          <Search className='size-4' />
          Test recall
        </Button>
      </form>

      {recall.isError && (
        <div
          role='alert'
          className='border border-[var(--dt-danger)] bg-[var(--dt-danger-soft)] p-4'
        >
          <p className='font-semibold text-[var(--dt-danger)]'>Recall could not be tested.</p>
          <p className='dt-muted mt-1 text-sm'>{recall.error.message}</p>
          <Button variant='outline' className='dt-control mt-3' onClick={() => submit()}>
            Try again
          </Button>
        </div>
      )}

      <AnimatePresence mode='popLayout' initial={false}>
        {results && !recall.isError && (
          <motion.section
            key={`${query.trim()}:${budget}:${results.length}`}
            aria-live='polite'
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
            transition={{
              duration: reduceMotion ? DIGITAL_TWIN_MOTION.feedback : DIGITAL_TWIN_MOTION.state,
              ease: reduceMotion ? DIGITAL_TWIN_EASE_IN : DIGITAL_TWIN_EASE_OUT,
            }}
          >
            <div className='flex items-end justify-between gap-4 border-b-2 border-[var(--dt-ink)] pb-3'>
              <h3 className='dt-display text-xl font-semibold text-[var(--dt-ink)]'>
                Recall results
              </h3>
              <span className='dt-muted text-sm tabular-nums'>
                {results.length} result{results.length === 1 ? '' : 's'}
              </span>
            </div>
            {results.length === 0 ? (
              <div className='dt-grid-lines flex min-h-56 flex-col items-start justify-center border-b dt-rule px-6 py-10'>
                <FlaskConical className='size-6 text-[var(--dt-accent)]' />
                <p className='mt-4 font-semibold text-[var(--dt-ink)]'>
                  Nothing matched this wording.
                </p>
                <p className='dt-muted mt-1 text-sm'>
                  Try a broader phrase or increase search breadth.
                </p>
              </div>
            ) : (
              <ol>
                {results.map((result, index) => (
                  <motion.li
                    key={result.id ?? index}
                    className='border-b dt-rule py-5'
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: DIGITAL_TWIN_MOTION.state,
                      delay: reduceMotion ? 0 : digitalTwinStaggerDelay(index),
                      ease: DIGITAL_TWIN_EASE_OUT,
                    }}
                  >
                    <div className='flex items-start gap-4'>
                      <span className='dt-muted mt-0.5 w-8 shrink-0 text-sm font-semibold tabular-nums'>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className='min-w-0 flex-1'>
                        <p className='max-w-[76ch] whitespace-pre-wrap text-base leading-7 text-[var(--dt-ink)]'>
                          {result.text ?? 'No memory text returned'}
                        </p>
                        <div className='mt-3 flex flex-wrap gap-2 text-sm'>
                          {result.fact_type && (
                            <span className='rounded-full border dt-rule px-2.5 py-1 text-[var(--dt-muted)]'>
                              {result.fact_type}
                            </span>
                          )}
                          {result.score !== undefined && (
                            <span className='rounded-full bg-[var(--dt-sage-soft)] px-2.5 py-1 font-semibold tabular-nums text-[var(--dt-sage)]'>
                              {Math.round(result.score * 100)}% match
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.li>
                ))}
              </ol>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DigitalTwinRecallTab;
