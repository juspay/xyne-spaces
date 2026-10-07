import { useCallback, useMemo, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Globe, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  StreamingMarkdownBlocks,
  rehypeStreamWordFade,
} from '@/components/utils/StreamingMarkdownBlocks';
import {
  UserQuestionCard,
  type UserQuestionAnswers,
  type UserQuestionPhase,
} from '@/components/flowUI/nodes/UserQuestionCard';
import { createMarkdownComponents } from '@/utils/markdownComponents';
import { cn } from '@/utils/classNames';
import {
  serializeAnswers,
  type DraftActivity,
  type DraftQuestion,
  type DraftSuggestion,
} from './agentDraftStream';

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REHYPE_STREAMING = [rehypeStreamWordFade];
const keepUrl = (url: string): string => url;

/**
 * A Build chat answer as markdown. While it streams, settled blocks stay put
 * and new words fade in; the render function and components keep one identity
 * for the message's lifetime so nothing blinks.
 */
export function BuildReplyMarkdown({
  id,
  content,
  streamed,
}: {
  id: string;
  content: string;
  /** True for a reply that arrived live (it keeps the word fade once done). */
  streamed: boolean;
}): ReactElement {
  const components = useMemo(() => createMarkdownComponents(id), [id]);
  const render = useCallback(
    (markdown: string): ReactElement => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={streamed ? REHYPE_STREAMING : undefined}
        urlTransform={keepUrl}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    ),
    [components, streamed],
  );
  return (
    <div
      className={cn(
        'bot-markdown-content xyne-ai-markdown text-sm font-normal leading-7 text-foreground',
        streamed && 'streaming-answer-fade',
      )}
      data-testid='agent-create-chat-reply'
    >
      {streamed ? <StreamingMarkdownBlocks content={content} render={render} /> : render(content)}
    </div>
  );
}

/** "Searched the web · 4 sources", opening to the source links. */
export function BuildSearchLine({
  activities,
}: {
  activities: DraftActivity[];
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const last = activities.at(-1);
  if (!last || last.status === 'running') return null;
  const sources = last.sources ?? [];
  return (
    <div
      className='flex flex-col gap-1 text-xs text-muted-foreground'
      data-testid='agent-create-search'
    >
      <button
        type='button'
        disabled={sources.length === 0}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        data-track-category='Claw Agents'
        data-track-name='Create agent chat: toggle sources'
        className='-ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground'
      >
        <Globe className='size-3.5' aria-hidden />
        <span>
          {last.label}
          {last.detail ? ` · ${last.detail}` : ''}
        </span>
        {sources.length > 0 && (
          <ChevronDown
            className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        )}
      </button>
      {open && sources.length > 0 && (
        <ul className='ml-5 flex flex-col gap-0.5'>
          {sources.map(source => (
            <li key={source.url} className='truncate'>
              <a
                href={source.url}
                target='_blank'
                rel='noopener noreferrer'
                className='underline-offset-2 hover:text-foreground hover:underline'
              >
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One-tap changes under a reply. Tapping one sends its message as the next turn. */
export function BuildSuggestionChips({
  suggestions,
  disabled,
  onApply,
}: {
  suggestions: DraftSuggestion[];
  disabled: boolean;
  onApply: (suggestion: DraftSuggestion) => void;
}): ReactElement {
  return (
    <div className='flex flex-wrap gap-2 pt-1' data-testid='agent-create-suggestions'>
      {suggestions.map(suggestion => (
        <Button
          key={suggestion.id}
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          title={suggestion.message}
          onClick={() => onApply(suggestion)}
          data-track-category='Claw Agents'
          data-track-name='Create agent chat: apply suggestion'
          className='h-auto min-h-8 whitespace-normal rounded-lg py-1.5 text-left'
        >
          <Sparkles className='size-3.5' aria-hidden />
          {suggestion.label}
        </Button>
      ))}
    </div>
  );
}

/** A follow-up question card; submitting sends the answers as the next turn. */
export interface BuildQuestionState {
  id: string;
  questions: DraftQuestion[];
  phase: UserQuestionPhase;
  answers: UserQuestionAnswers;
  notes: Record<string, string>;
}

export function BuildQuestionCard({
  state,
  disabled,
  onChange,
  onAnswer,
  docked = false,
}: {
  state: BuildQuestionState;
  disabled: boolean;
  /**
   * In the composer's place at the bottom of the chat: full width, with
   * Skip / Submit above the questions.
   */
  docked?: boolean;
  onChange: (next: BuildQuestionState) => void;
  /** The answers as one message, e.g. "Job: Review pull requests. Runs: Daily." */
  onAnswer: (message: string) => void;
}): ReactElement {
  const submit = useCallback((): number | null => {
    onChange({ ...state, phase: 'answered' });
    onAnswer(serializeAnswers(state.questions, state.answers, state.notes));
    return null;
  }, [onAnswer, onChange, state]);
  return (
    <div className={docked ? undefined : 'pt-1'} data-testid='agent-create-question-card'>
      <UserQuestionCard
        optionStyle='filled'
        {...(docked ? { actionsPlacement: 'top' as const, className: 'w-full' } : {})}
        questions={state.questions}
        phase={state.phase}
        answers={state.answers}
        notes={state.notes}
        onAnswersChange={answers => onChange({ ...state, answers })}
        onNotesChange={notes => onChange({ ...state, notes })}
        onSubmit={submit}
        disabled={disabled}
        showLabels
      />
    </div>
  );
}
