import { ReactElement, ReactNode, useState } from 'react';
import { ChevronRight, Pencil, Play } from 'lucide-react';
import { toast } from 'sonner';
import { proactivityApi } from '../../api/proactivityApi';
import type {
  MessageTraceResponse,
  ProactiveDraftView,
  ProactivityDecisionView,
  XorCallView,
} from '../../api/proactivityApi';
import { cn } from '../../utils/classNames';
import {
  OUTCOMES as OUTCOME_WORDS,
  questionLabel,
  reasonLabel,
  needs,
  STEP_RULES,
  STEP_TITLES,
} from './agentActivityWords';

type TraceDecision = MessageTraceResponse['decisions'][number];
type Thresholds = NonNullable<MessageTraceResponse['thresholds']>;

/** The outcome in a sentence, with why. */
export const describe = (decision: ProactivityDecisionView): string => {
  const agent = decision.agentSlug ?? 'an agent';
  switch (decision.outcome) {
    case 'posted':
      return `Replied: ${agent}`;
    case 'reacted':
      return `Agreed with a reply already there (👍): ${agent}`;
    case 'shadow':
      return `Would have replied (test only): ${agent}`;
    case 'held':
      return `Didn’t post: ${reasonLabel(decision.reason)}`;
    case 'quiet':
      return `Didn’t reply: ${reasonLabel(decision.reason)}`;
    default:
      return 'An agent is drafting a reply';
  }
};

export const outcomeTone = (outcome: string | null): string => {
  switch (outcome) {
    case 'posted':
    case 'reacted':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    case 'held':
    case 'shadow':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'quiet':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-sky-500/10 text-sky-700 dark:text-sky-400';
  }
};

/** A draft as people read it: no citation tokens, nothing for an empty or zero-width draft. */
export const readableDraft = (text: string | null): string =>
  (text ?? '')
    .replace(/\s*\[clf-[^\]]+\]/g, '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .trim();

/** A score as shown: rounded down, so one just under its line never reads as on it. */
const score2 = (p: number): string => (Math.floor(p * 100) / 100).toFixed(2);

type Tone = 'pass' | 'stop' | 'neutral' | 'working';

const DOT: Record<Tone, string> = {
  pass: 'bg-emerald-500',
  stop: 'bg-amber-500',
  neutral: 'bg-muted-foreground/40',
  working: 'animate-pulse bg-sky-500',
};

const stepKey = (step: string): string => {
  switch (step) {
    case 'bump_gate':
      return 'bump';
    case 'before_posting':
      return 'check';
    case 'follow_up':
      return 'follow';
    default:
      return step;
  }
};

/** "11:08 PM": when a message was sent, on one line. */
const clock = (at: string): string =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "445 ms", "12.3 s", "3m 15s", "1h 4m". */
const seconds = (ms: number): string => {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return s < 3600
    ? `${Math.floor(s / 60)}m ${s % 60}s`
    : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Spaces tools arrive namespaced; the trace shows the tool's own name. */
const toolName = (name: string): string => name.replace(/^.*__/, '');

/** The text a question quotes between its triple quotes: a message, or an agent's description. */
const quoted = (instructions: string): string | null =>
  /"""\s*([\s\S]*?)\s*"""/.exec(instructions)?.[1] ?? null;

/** The question an instruction asks, without what it quotes. */
const questionText = (instructions: string): string =>
  instructions.split('"""').pop()?.trim() || instructions;

/** Does this reason name this question? `not_draft_answers` is a no to `draft_answers`. */
const decidedBy = (reason: string | null, name: string): boolean =>
  reason !== null && reason.replace(/^not_/, '') === name;

interface Row {
  key: string;
  /** The question's key, without the message label. */
  question: string;
  name: string;
  hint: string;
  probability: number | null;
  threshold: number | null;
}

interface Group {
  label: string | null;
  text: string | null;
  rows: Row[];
}

const thresholdFor = (step: string, name: string, t: Thresholds | null): number | null => {
  if (!t) return null;
  switch (stepKey(step)) {
    case 'route':
      // `best_agent_0` is a share of the choice between agents, not a yes/no.
      return name.startsWith('best_') ? null : t.route.relevant;
    case 'check':
      return t.beforePosting[name] ?? null;
    case 'follow':
      return t.followUp[name] ?? null;
    default:
      return t.gate[name] ?? null;
  }
};

/** Per-message questions (`m1_asks_something`) grouped by message; routing rows named by agent. */
const groupRows = (call: XorCallView, t: Thresholds | null): Group[] => {
  const groups = new Map<string, Group>();
  for (const q of call.questions) {
    const perMessage = /^(m\d+)_(.+)$/.exec(q.key);
    const label = perMessage?.[1] ?? null;
    const question = perMessage?.[2] ?? q.key;
    const group = groups.get(label ?? '') ?? {
      label,
      text: label ? quoted(q.instructions) : null,
      rows: [],
    };
    const agent =
      stepKey(call.step) === 'route'
        ? `${quoted(q.instructions)?.split(':')[0]}${question.startsWith('best_') ? ': best fit' : ''}`
        : null;
    group.rows.push({
      key: q.key,
      question,
      name:
        agent ??
        questionLabel(stepKey(call.step), question.replace(/_r\d+$/, '')) +
          (/_r\d+$/.test(question) ? ` (reply ${question.replace(/^.*_r/, '')})` : ''),
      hint: `${questionText(q.instructions)} (${question})`,
      probability: q.probability,
      // `same_answer_r1` is `same_answer` against reply r1.
      threshold: thresholdFor(call.step, question.replace(/_r\d+$/, ''), t),
    });
    groups.set(label ?? '', group);
  }
  return [...groups.values()];
};

/** What a step decided, in a sentence, and whether the journey went on past it. */
/** Each question's plain name by its key, as the rows show it; which message, when there are several. */
const rowNames = (groups: Group[]): Map<string, string> => {
  const several = groups.filter(g => g.label).length > 1;
  return new Map(
    groups.flatMap(g =>
      g.rows.map(row => [
        row.key,
        several && g.label ? `Message ${g.label.slice(1)}: ${row.name}` : row.name,
      ]),
    ),
  );
};

/** Who the route picked, by the policy's rule: see ProactivityPolicy.route. */
const routePicks = (rows: Row[], route: Thresholds['route'] | null): Row[] => {
  if (!route) return [];
  const share = (row: Row): number =>
    rows.find(r => r.key === `best_${row.key}`)?.probability ?? (rows.length > 1 ? 0 : 1);
  const fit = (row: Row): number => row.probability ?? 0;
  const [best, ...rest] = rows
    .filter(row => !row.key.startsWith('best_'))
    .sort((a, b) => share(b) - share(a) || fit(b) - fit(a));
  if (!best || fit(best) < route.relevant) return [];
  return [
    best,
    ...rest.filter(
      row => fit(row) >= route.secondAgent && share(row) >= route.closeChoice * share(best),
    ),
  ].slice(0, Math.max(1, route.maxAgents));
};

const verdict = (
  call: XorCallView,
  decision: TraceDecision,
  groups: Group[],
  thresholds: Thresholds | null,
): { text: string; tone: Tone } => {
  if (call.failed) return { text: 'XOR didn’t respond', tone: 'stop' };
  const rows = groups.flatMap(g => g.rows);
  const deciding = rows.find(row => decidedBy(decision.reason, row.question));
  const stopped = (prefix: string): { text: string; tone: Tone } => ({
    text: `${prefix}: ${reasonLabel(decision.reason)}${
      deciding && deciding.probability !== null ? ` (${score2(deciding.probability)})` : ''
    }`,
    tone: 'stop',
  });
  switch (stepKey(call.step)) {
    case 'gate':
    case 'bump':
      if (decision.gate === 'open') return { text: 'Yes, an agent can help', tone: 'pass' };
      if (decision.gate === 'bump')
        return { text: 'A nudge, so the earlier question is checked instead', tone: 'neutral' };
      return stopped('No');
    case 'route': {
      const picked = routePicks(rows, thresholds?.route ?? null).map(
        row => `${row.name} (${score2(row.probability ?? 0)})`,
      );
      return picked.length > 0
        ? { text: picked.join(', '), tone: 'pass' }
        : { text: 'No agent knows this topic', tone: 'stop' };
    }
    default: {
      // Each agent's check from its own scores: the decision's reason is the deciding agent's.
      const { action, stopped: at } = checkStop(rows, stepKey(call.step));
      const question = at[0] ?? '';
      const row = rows.find(r => r.question === question);
      const score = row && row.probability !== null ? ` (${score2(row.probability)})` : '';
      const why = reasonLabel(
        needs(stepKey(call.step), question) === 'yes' ? `not_${question}` : question,
      );
      switch (action) {
        case 'react':
          return { text: `Says the same as a reply: 👍 instead${score}`, tone: 'pass' };
        case 'redraft':
          return { text: `Adds something new: rewritten to only that${score}`, tone: 'neutral' };
        case 'correction':
          return { text: `Contradicts a reply: posted as a correction${score}`, tone: 'pass' };
        case 'hold':
          return {
            text: `${stepKey(call.step) === 'follow' ? 'Not answered' : 'Not posted'}: ${why}${score}`,
            tone: 'stop',
          };
        default:
          return {
            text: stepKey(call.step) === 'follow' ? 'Answered' : 'Good to post',
            tone: 'pass',
          };
      }
    }
  }
};

type Action = 'post' | 'hold' | 'react' | 'redraft' | 'correction';

/**
 * What one agent's check decided, from its own scores, in the backend policy's order
 * (`beforePosting` and `followUp`): the action, and the question that decided it.
 */
const checkStop = (rows: Row[], step: string): { action: Action; stopped: string[] } => {
  const yes = (question: string): boolean => {
    const row = rows.find(r => r.question === question);
    return !!row && row.threshold !== null && (row.probability ?? 0) >= row.threshold;
  };
  const best = (prefix: string): Row | undefined =>
    rows
      .filter(r => r.question.startsWith(prefix) && r.threshold !== null)
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
  const passes = (row: Row | undefined): row is Row =>
    !!row && (row.probability ?? 0) >= (row.threshold ?? 1);
  // Only questions that still have a line today: older traces asked some that are gone.
  const present = (question: string): boolean =>
    rows.some(r => r.question === question && r.threshold !== null);
  if (step === 'follow') {
    if (yes('sensitive')) return { action: 'hold', stopped: ['sensitive'] };
    for (const question of ['asks_agent_more', 'asks_for_info']) {
      if (present(question) && !yes(question)) return { action: 'hold', stopped: [question] };
    }
    return { action: 'post', stopped: [] };
  }
  if (yes('already_answered')) {
    const contradicts = best('contradicts_');
    // Correcting or adding needs an answer of its own, as in the backend.
    const answers = yes('draft_answers');
    if (answers && passes(contradicts)) {
      return { action: 'correction', stopped: [contradicts.question] };
    }
    if (answers && yes('adds_to_answer')) return { action: 'redraft', stopped: ['adds_to_answer'] };
    const same = best('same_answer_');
    if (answers && passes(same)) return { action: 'react', stopped: [same.question] };
    return { action: 'hold', stopped: ['already_answered'] };
  }
  if (yes('no_longer_open')) return { action: 'hold', stopped: ['no_longer_open'] };
  if (present('draft_answers') && !yes('draft_answers')) {
    return { action: 'hold', stopped: ['draft_answers'] };
  }
  return { action: 'post', stopped: [] };
};

/** A probability against its threshold: filled past the line is a yes. */
type Mark = 'stop' | 'go' | null;

const Meter = ({ row, mark }: { row: Row; mark: Mark }): ReactElement => {
  const deciding = mark !== null;
  const p = row.probability ?? 0;
  const yes = row.threshold !== null && p >= row.threshold;
  return (
    <div className='flex w-40 shrink-0 items-center gap-2.5'>
      <div className='relative h-1 flex-1 rounded-full bg-muted'>
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            mark === 'stop'
              ? 'bg-amber-500'
              : mark === 'go'
                ? 'bg-emerald-500'
                : yes
                  ? 'bg-foreground/70'
                  : 'bg-foreground/15',
          )}
          style={{ width: `${Math.round(p * 100)}%` }}
        />
        {row.threshold !== null ? (
          <div
            className='absolute -top-1 h-3 w-px bg-foreground/40'
            style={{ left: `${Math.round(row.threshold * 100)}%` }}
            title={`Yes at ${row.threshold}`}
          />
        ) : null}
      </div>
      <span
        className={cn(
          'w-8 text-right text-xs tabular-nums',
          yes || deciding ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {row.probability !== null ? score2(row.probability) : '–'}
      </span>
    </div>
  );
};

const Mono = ({ children }: { children: ReactNode }): ReactElement => (
  <pre className='max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground'>
    {children}
  </pre>
);

/** A quiet text toggle for the raw material behind a step. */
const Reveal = ({ label, children }: { label: string; children: ReactNode }): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='text-xs text-muted-foreground hover:text-foreground'
        data-track-category='workspace-management'
        data-track-name='AGENT_TRACE_REVEAL'
      >
        {open ? 'Hide' : 'Show'} {label}
      </button>
      {open ? <div className='mt-1.5'>{children}</div> : null}
    </div>
  );
};

/** One row of the journey: a dot, what the step is, what it decided; details on click. */
const Step = ({
  tone,
  title,
  verdictText,
  meta,
  children,
}: {
  tone: Tone;
  title: string;
  verdictText: string;
  meta: string;
  children: ReactNode;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <li className='group relative pl-6'>
      <span className='absolute left-[3px] top-5 bottom-0 w-px bg-border group-last:hidden' />
      <span className={cn('absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full', DOT[tone])} />
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='flex w-full items-baseline gap-3 pb-3 text-left'
        data-track-category='workspace-management'
        data-track-name='AGENT_TRACE_STEP'
      >
        <span className='w-36 shrink-0 truncate text-[13px] font-medium text-foreground'>
          {title}
        </span>
        <span className='min-w-0 flex-1 truncate text-[13px] text-muted-foreground'>
          {verdictText}
        </span>
        <span className='shrink-0 text-xs tabular-nums text-muted-foreground/80'>{meta}</span>
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 self-center text-muted-foreground/60 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? <div className='mb-5 ml-[156px] space-y-3'>{children}</div> : null}
    </li>
  );
};

/**
 * Where the gate stopped for one message, in the order it checks (`quietBecause` in the
 * backend's policy): the question that decided, and those that then didn’t matter (XOR answered them all in one call).
 */
const GATE_ORDER = [
  'personal_matter',
  'already_answered',
  'someone_took_it',
  'info_not_a_task',
  'anyone_could_answer',
  // Older traces asked these instead.
  'sensitive',
  'someone_on_it',
  // Older traces asked these instead.
  'only_addressed_can_answer',
  'asks_opinion_or_decision',
  'announcement_or_instruction',
  'asks_feature',
];

const gateStop = (rows: Row[]): { stopped: string[]; unchecked: Set<string> } => {
  const yes = (question: string): boolean => {
    const row = rows.find(r => r.question === question);
    return !!row && row.threshold !== null && (row.probability ?? 0) >= row.threshold;
  };
  // A nudge ("anyone?") is set aside: the earlier question it repeats is judged instead.
  // Older traces have only_addressed_can_answer and just_a_bump where newer ones have
  // anyone_could_answer and just_a_nudge.
  const forAnyone = rows.some(r => r.question === 'anyone_could_answer')
    ? yes('anyone_could_answer')
    : !yes('only_addressed_can_answer');
  if ((yes('just_a_nudge') || yes('just_a_bump')) && forAnyone) {
    return {
      stopped: [rows.some(r => r.question === 'just_a_nudge') ? 'just_a_nudge' : 'just_a_bump'],
      unchecked: new Set(),
    };
  }
  if (!yes('needs_an_answer') && !yes('asks_something') && !yes('reports_problem')) {
    return {
      stopped: ['needs_an_answer', 'asks_something', 'reports_problem'],
      unchecked: new Set(GATE_ORDER),
    };
  }
  const blocks = (question: string): boolean =>
    question === 'info_not_a_task' || question === 'anyone_could_answer'
      ? !yes(question)
      : yes(question);
  // Only questions XOR was asked: older traces have some that newer ones don't.
  const order = GATE_ORDER.filter(question =>
    rows.some(r => r.question === question && r.threshold !== null),
  );
  const at = order.findIndex(blocks);
  return at < 0
    ? { stopped: [], unchecked: new Set() }
    : { stopped: [order[at] ?? ''], unchecked: new Set(order.slice(at + 1)) };
};

const passes = (row: Row | undefined): boolean =>
  !!row && row.threshold !== null && (row.probability ?? 0) >= row.threshold;

/** The question that decided a step for one message: what stopped it, or what let it through. */
const decidingRows = (step: string, rows: Row[]): { mark: Mark; questions: string[] } => {
  if (step === 'gate' || step === 'bump') {
    const { stopped } = gateStop(rows);
    return stopped.length > 0
      ? { mark: 'stop', questions: stopped }
      : {
          mark: 'go',
          questions: ['needs_an_answer', 'asks_something', 'reports_problem'].filter(q =>
            passes(rows.find(r => r.question === q)),
          ),
        };
  }
  if (step === 'check' || step === 'follow') {
    const { action, stopped } = checkStop(rows, step);
    if (action === 'hold') return { mark: 'stop', questions: stopped };
    if (action === 'post') {
      return { mark: 'go', questions: [step === 'follow' ? 'asks_agent_more' : 'draft_answers'] };
    }
    return { mark: 'go', questions: stopped };
  }
  return { mark: 'go', questions: rows.filter(passes).map(r => r.question) };
};

const XorDetail = ({ step, groups }: { step: string; groups: Group[] }): ReactElement => (
  <>
    {groups.map((group, i) => {
      const { mark, questions } = decidingRows(step, group.rows);
      return (
        <div key={group.label ?? 'all'} className='space-y-1.5'>
          {group.label && groups.length > 1 ? (
            <p className='truncate text-xs text-muted-foreground'>
              <span className='mr-1.5 font-medium text-foreground'>Message {i + 1}</span>
              {group.text}
            </p>
          ) : null}
          <ul>
            {group.rows.map(row => {
              const rowMark = questions.includes(row.question) ? mark : null;
              return (
                <li key={row.key} className='flex items-center gap-4 py-1' title={row.hint}>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px]',
                      rowMark === 'stop'
                        ? 'font-medium text-amber-700 dark:text-amber-400'
                        : rowMark === 'go'
                          ? 'font-medium text-emerald-700 dark:text-emerald-400'
                          : 'text-foreground',
                    )}
                  >
                    {row.name}
                    {rowMark ? (
                      <span className='ml-2 text-[11px] font-normal text-muted-foreground'>
                        {rowMark === 'stop' ? 'stopped here' : 'went ahead'}
                      </span>
                    ) : null}
                  </span>
                  <Meter row={row} mark={rowMark} />
                </li>
              );
            })}
          </ul>
        </div>
      );
    })}
  </>
);

/** The request exactly as it went to XOR: the model, what it read, and each question. */
const requestOf = (call: XorCallView, model: string): string =>
  JSON.stringify(
    {
      model,
      state: call.input,
      questions: Object.fromEntries(
        call.questions.map(q => [
          q.key,
          {
            type: 'noul',
            instructions: q.instructions,
            ...(q.criteriaTrue || q.criteriaFalse
              ? { criteria: { true: q.criteriaTrue ?? '', false: q.criteriaFalse ?? '' } }
              : {}),
          },
        ]),
      ),
    },
    null,
    2,
  );

const small =
  'rounded-md px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground';

/**
 * The request sent to XOR, in full. The pencil makes it editable: run it again to see how
 * a change in wording moves each answer, next to what XOR said the first time.
 */
const XorRequest = ({
  call,
  model,
  names,
}: {
  call: XorCallView;
  model: string;
  names: Map<string, string>;
}): ReactElement => {
  const original = requestOf(call, model);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(original);
  const [result, setResult] = useState<Record<string, number | null> | null>(null);
  const [running, setRunning] = useState(false);
  const before = new Map(call.questions.map(q => [q.key, q.probability]));

  const run = async (): Promise<void> => {
    let parsed: Parameters<typeof proactivityApi.tryXor>[0];
    try {
      parsed = JSON.parse(text) as Parameters<typeof proactivityApi.tryXor>[0];
    } catch {
      toast.error('That is not valid JSON');
      return;
    }
    setRunning(true);
    try {
      // The model is the server's to choose; only what it reads and the questions go.
      const { state, questions } = parsed;
      setResult((await proactivityApi.tryXor({ state, questions })).probabilities);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not ask XOR');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className='space-y-2'>
      <div className='relative'>
        {editing ? (
          <textarea
            value={text}
            onChange={event => setText(event.target.value)}
            spellCheck={false}
            aria-label='XOR request'
            data-track-category='workspace-management'
            data-track-name='AGENT_TRACE_XOR_EDIT'
            className='h-80 w-full resize-y rounded-lg bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground ring-1 ring-primary/30 focus:outline-none'
          />
        ) : (
          <>
            <Mono>{original}</Mono>
            <button
              type='button'
              onClick={() => setEditing(true)}
              className='absolute right-2 top-2 rounded-md bg-background/90 p-1.5 text-muted-foreground ring-1 ring-border hover:text-foreground'
              aria-label='Edit and run again'
              title='Edit and run again'
              data-track-category='workspace-management'
              data-track-name='AGENT_TRACE_XOR_EDIT_OPEN'
            >
              <Pencil className='h-3.5 w-3.5' />
            </button>
          </>
        )}
      </div>
      {editing ? (
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => void run()}
            disabled={running}
            className='inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50'
            data-track-category='workspace-management'
            data-track-name='AGENT_TRACE_XOR_RUN'
          >
            <Play className='h-3 w-3' />
            {running ? 'Asking XOR…' : 'Run'}
          </button>
          <button
            type='button'
            onClick={() => {
              setText(original);
              setResult(null);
            }}
            className={small}
            data-track-category='workspace-management'
            data-track-name='AGENT_TRACE_XOR_RESET'
          >
            Reset
          </button>
          <button
            type='button'
            onClick={() => {
              setEditing(false);
              setText(original);
              setResult(null);
            }}
            className={small}
            data-track-category='workspace-management'
            data-track-name='AGENT_TRACE_XOR_CANCEL'
          >
            Cancel
          </button>
        </div>
      ) : null}
      {result ? (
        <ul className='divide-y divide-border/60'>
          {Object.entries(result).map(([key, p]) => {
            const was = before.get(key) ?? null;
            const moved = p !== null && was !== null ? p - was : null;
            return (
              <li key={key} className='flex items-center gap-3 py-1.5 text-xs'>
                <span className='min-w-0 flex-1 truncate text-foreground' title={key}>
                  {names.get(key) ?? key}
                </span>
                <span className='w-12 text-right tabular-nums text-muted-foreground'>
                  {was !== null ? score2(was) : '–'}
                </span>
                <span className='text-muted-foreground'>→</span>
                <span className='w-12 text-right font-medium tabular-nums text-foreground'>
                  {p !== null ? score2(p) : '–'}
                </span>
                <span
                  className={cn(
                    'w-14 text-right tabular-nums',
                    moved === null || Math.abs(moved) < 0.01
                      ? 'text-muted-foreground'
                      : moved > 0
                        ? 'text-emerald-600'
                        : 'text-amber-600',
                  )}
                >
                  {moved === null ? '' : `${moved > 0 ? '+' : ''}${moved.toFixed(2)}`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};

/** The request behind one small button, so the step stays a list of answers. */
const XorTools = ({
  call,
  model,
  names,
}: {
  call: XorCallView;
  model: string;
  names: Map<string, string>;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <div className='space-y-2'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='text-xs text-muted-foreground hover:text-foreground'
        data-track-category='workspace-management'
        data-track-name='AGENT_TRACE_XOR_REQUEST'
      >
        {open ? 'Hide' : 'Show'} XOR request
      </button>
      {open ? <XorRequest call={call} model={model} names={names} /> : null}
    </div>
  );
};

const XorStep = ({
  call,
  decision,
  thresholds,
  model,
}: {
  call: XorCallView;
  decision: TraceDecision;
  thresholds: Thresholds | null;
  model: string;
}): ReactElement => {
  const groups = groupRows(call, thresholds);
  const { text, tone } = verdict(call, decision, groups, thresholds);
  return (
    <Step
      tone={tone}
      title={STEP_TITLES[stepKey(call.step)] ?? call.step}
      verdictText={call.agentSlug ? `${call.agentSlug} · ${text}` : text}
      meta={seconds(call.durationMs)}
    >
      {STEP_RULES[stepKey(call.step)] ? (
        <p className='text-xs leading-relaxed text-muted-foreground'>
          {STEP_RULES[stepKey(call.step)]}
        </p>
      ) : null}
      <div className='max-h-96 space-y-3 overflow-auto pr-1'>
        <XorDetail step={stepKey(call.step)} groups={groups} />
      </div>
      <XorTools call={call} model={model} names={rowNames(groups)} />
    </Step>
  );
};

type ToolCallView = ProactiveDraftView['toolCalls'][number];

/** A tool call's arguments in a line: its values, without the JSON around them. */
const argsLine = (args: string): string => {
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed)
        .filter(value => typeof value === 'string' || typeof value === 'number')
        .join(' · ');
    }
  } catch {
    // Not JSON: shown as it came.
  }
  return args;
};

/** One tool call: what it ran and on what, in a line; its full input and output on click. */
const ToolCall = ({ tool }: { tool: ToolCallView }): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <li className='border-b border-border/60 last:border-b-0'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        className='flex w-full items-baseline gap-3 px-3 py-1.5 text-left hover:bg-muted/40'
        data-track-category='workspace-management'
        data-track-name='AGENT_TRACE_TOOL_CALL'
      >
        <span
          className={cn(
            'w-40 shrink-0 truncate font-mono text-xs',
            tool.isError ? 'text-destructive' : 'text-foreground',
          )}
        >
          {toolName(tool.toolName)}
        </span>
        <span className='min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'>
          {argsLine(tool.args)}
        </span>
        <span className='shrink-0 text-[11px] tabular-nums text-muted-foreground/70'>
          {tool.isError ? 'failed' : tool.durationMs !== null ? seconds(tool.durationMs) : ''}
        </span>
      </button>
      {open ? (
        <div className='space-y-1.5 px-3 pb-3'>
          <Mono>{tool.args}</Mono>
          <Mono>{tool.result}</Mono>
        </div>
      ) : null}
    </li>
  );
};

const RunStep = ({
  run,
  rewrite,
}: {
  run: ProactiveDraftView;
  /** A second run of the same agent: asked to rewrite its draft. */
  rewrite: boolean;
}): ReactElement => {
  const draft = run.error ?? readableDraft(run.result);
  const calls = `${run.toolCalls.length} tool ${run.toolCalls.length === 1 ? 'call' : 'calls'}`;
  // claw saves the result and tool calls only when the run ends.
  const working = run.completedAt === null && !run.error;
  return (
    <Step
      tone={working ? 'working' : draft && !run.error ? 'pass' : 'stop'}
      title={rewrite ? `${run.agentSlug} · rewrite` : run.agentSlug}
      verdictText={
        working
          ? 'Still working…'
          : run.error
            ? 'Failed'
            : `${draft ? 'Drafted a reply' : 'Found nothing to say'} · ${calls}`
      }
      meta={run.totalMs !== null ? seconds(run.totalMs) : ''}
    >
      {working ? null : (
        <div>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>What it wrote</p>
          {draft ? (
            <p className='max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] text-foreground'>
              {draft}
            </p>
          ) : run.result?.trim() ? (
            // Nothing readable, but something came back: show exactly what.
            <Mono>{run.result}</Mono>
          ) : (
            <p className='text-[13px] text-muted-foreground'>An empty reply.</p>
          )}
        </div>
      )}
      {run.toolCalls.length > 0 ? (
        <div>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>What it looked at</p>
          <ul className='max-h-72 overflow-auto rounded-lg bg-muted/50'>
            {run.toolCalls.map((tool, i) => (
              <ToolCall key={i} tool={tool} />
            ))}
          </ul>
        </div>
      ) : null}
      <Reveal label={`prompt${run.model ? ` · ${run.model}` : ''}`}>
        <Mono>{run.task}</Mono>
      </Reveal>
    </Step>
  );
};

const OUTCOME_TONE: Record<string, Tone> = {
  posted: 'pass',
  reacted: 'pass',
  shadow: 'pass',
  held: 'stop',
};

/**
 * The last step: what happened, and for a reply the reply itself — the deciding agent's
 * last draft, the one the check passed.
 */
const Outcome = ({ decision }: { decision: TraceDecision }): ReactElement | null => {
  if (!decision.outcome) return null;
  const replied = decision.outcome === 'posted' || decision.outcome === 'shadow';
  // The deciding agent's last draft: the reply, or for a held one what was stopped.
  const reply = readableDraft(
    [...decision.runs].reverse().find(run => run.agentSlug === decision.agentSlug)?.result ?? null,
  );
  const why =
    decision.outcome === 'held' || decision.outcome === 'quiet'
      ? reasonLabel(decision.reason)
      : decision.outcome === 'reacted'
        ? `${decision.agentSlug ?? 'an agent'} added 👍 to a reply already there`
        : (decision.agentSlug ?? '');
  return (
    <li className='relative pl-6'>
      <span
        className={cn(
          'absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full',
          DOT[OUTCOME_TONE[decision.outcome] ?? 'neutral'],
        )}
      />
      <div className='flex items-baseline gap-3 pb-3'>
        <span className='w-36 shrink-0 text-[13px] font-medium text-foreground'>
          {OUTCOME_WORDS[decision.outcome as keyof typeof OUTCOME_WORDS] ?? decision.outcome}
        </span>
        <span className='min-w-0 flex-1 truncate text-[13px] text-muted-foreground'>{why}</span>
      </div>
      {reply && (replied || decision.outcome === 'held') ? (
        <div
          className={cn(
            'mb-3 ml-[156px] max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] leading-relaxed',
            replied
              ? 'bg-primary/5 text-foreground ring-1 ring-primary/15'
              : 'border border-dashed border-border text-muted-foreground',
          )}
        >
          {reply}
        </div>
      ) : null}
    </li>
  );
};

const KIND: Record<ProactivityDecisionView['kind'], string> = {
  EPISODE: 'New question',
  REPLY: 'Reply in a thread',
  FOLLOW_UP: 'Follow-up',
};

const DecisionCard = ({
  decision,
  tracedId,
  thresholds,
  model,
}: {
  decision: TraceDecision;
  /** The message the trace was asked for, marked among the burst's. */
  tracedId: string;
  thresholds: Thresholds | null;
  model: string;
}): ReactElement => {
  const steps = [
    ...decision.xorCalls.map(call => ({
      at: call.createdAt,
      node: (
        <XorStep
          key={call.id}
          call={call}
          decision={decision}
          thresholds={thresholds}
          model={model}
        />
      ),
    })),
    ...decision.runs.map((run, i) => ({
      at: run.startedAt,
      node: (
        <RunStep
          key={`run-${i}`}
          run={run}
          rewrite={decision.runs.slice(0, i).some(earlier => earlier.agentSlug === run.agentSlug)}
        />
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className='rounded-2xl bg-card px-5 pt-4 pb-2 ring-1 ring-border'>
      <header className='mb-4 flex flex-wrap items-center justify-between gap-2'>
        <p className='text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>{KIND[decision.kind]}</span>
          {' · '}
          {decision.mode.toLowerCase() === 'shadow' ? 'test only' : 'live'}
        </p>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            outcomeTone(decision.outcome),
          )}
        >
          {describe(decision)}
        </span>
      </header>
      <ol className='mb-5 space-y-1.5 rounded-xl bg-muted/40 px-4 py-3'>
        {decision.messages.map(message => {
          const traced = message.messageId === tracedId || decision.messages.length === 1;
          return (
            <li key={message.messageId} className='flex items-baseline gap-4'>
              <p
                className={cn(
                  'min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed',
                  traced ? 'font-medium text-foreground' : 'text-foreground/70',
                )}
              >
                {message.text}
              </p>
              <span className='shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground'>
                {clock(message.createdAt)}
              </span>
            </li>
          );
        })}
      </ol>
      {steps.length === 0 ? (
        <p className='pb-3 text-[13px] text-muted-foreground'>
          Decided without asking XOR or an agent: {reasonLabel(decision.reason)}.
        </p>
      ) : (
        <ol>
          {steps.map(step => step.node)}
          <Outcome decision={decision} />
        </ol>
      )}
    </section>
  );
};

/**
 * A message's whole journey: the message, then each decision about it (follow-ups and
 * re-asks included). Every step says what it decided; the numbers behind it are a click away.
 */
export const AgentTrace = ({ trace }: { trace: MessageTraceResponse }): ReactElement => {
  if (!trace.message) {
    return <p className='text-[13px] text-muted-foreground'>No message with this id.</p>;
  }
  const { message } = trace;
  return (
    <div className='space-y-4'>
      <p className='text-xs text-muted-foreground'>
        {message.senderName ?? 'Someone'} in #{message.channelName ?? 'unknown'} ·{' '}
        {new Date(message.createdAt).toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </p>
      {trace.decisions.length === 0 ? (
        <div>
          <p className='whitespace-pre-wrap text-sm text-foreground'>{message.text}</p>
          <p className='mt-2 text-[13px] text-muted-foreground'>
            No agent decided anything about this message.
          </p>
        </div>
      ) : (
        trace.decisions.map(decision => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            tracedId={message.messageId}
            thresholds={trace.thresholds}
            model={trace.xorModel}
          />
        ))
      )}
    </div>
  );
};
