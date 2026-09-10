/**
 * Developer playground for the on-device intent classifier.
 *
 * Runs ONLY the local embedding classifier — no server call, no widget, no
 * telemetry (playground scores would pollute the production distributions we are
 * trying to measure). Bypasses the public-channel eligibility gate, which is why
 * it is a dev route rather than something reachable from product UI.
 *
 * See docs/ON_DEVICE_INTENT.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play } from 'lucide-react';

import Button from '../../components/ui/Button';
import Textarea from '../../components/ui/Textarea';
import {
  INTENTS,
  MIN_INTENT_SCORE,
  MODEL_VERSION,
  PROTOTYPES_VERSION,
  TOPIC_FLOOR,
  TOPIC_MARGIN,
  UNCLASSIFIED,
  UNRESOLVED_TOPIC,
  getIntent,
  intentClassifier,
  prefilter,
  type ClassificationResult,
} from '../../services/onDeviceIntent';

/** What a firing detection actually does. A detection is purely local now — see
 *  the note at the top of config.ts for the server path that used to be here. */
const ACTION_COPY = 'Shows a local suggestion toast. No server call.';

/**
 * The single question the playground exists to answer: would this message fire a
 * suggestion, and if not, why not. Everything else is supporting detail.
 */
type Verdict =
  | { kind: 'fires'; intentId: string; score: number; threshold: number; topicId?: string }
  | { kind: 'prefiltered' }
  | { kind: 'unclassified'; score: number }
  | { kind: 'absorbed'; intentId: string; score: number }
  | { kind: 'unrouted'; intentId: string; score: number; bestTopic: string; topicScore: number }
  | { kind: 'below'; intentId: string; score: number; threshold: number };

// Widened to `number` on purpose: INTENTS is `as const`, so TS knows its exact length
// and flags `=== 1` as a comparison that can never hold. The pluralisation must keep
// working as intents are added or removed.
const intentCount: number = INTENTS.length;

function verdictOf(result: ClassificationResult): Verdict {
  if (result.prefiltered) return { kind: 'prefiltered' };
  if (result.topIntent === UNCLASSIFIED) {
    return { kind: 'unclassified', score: result.topScore };
  }
  const intent = getIntent(result.topIntent);
  if (!intent?.actionable) {
    return { kind: 'absorbed', intentId: result.topIntent, score: result.topScore };
  }
  if (result.topScore >= intent.threshold) {
    // Stage 2 is a gate: an intent that routes by topic has not fired until a
    // topic resolves. "How-to, but about nothing we can act on" is its own
    // outcome and must not read as a threshold miss.
    if (result.topic) {
      if (result.topic.topicId === UNRESOLVED_TOPIC) {
        return {
          kind: 'unrouted',
          intentId: result.topIntent,
          score: result.topScore,
          bestTopic: result.topic.all[0]?.topicId ?? '—',
          topicScore: result.topic.score,
        };
      }
      return {
        kind: 'fires',
        intentId: result.topIntent,
        score: result.topScore,
        threshold: intent.threshold,
        topicId: result.topic.topicId,
      };
    }
    return {
      kind: 'fires',
      intentId: result.topIntent,
      score: result.topScore,
      threshold: intent.threshold,
    };
  }
  return {
    kind: 'below',
    intentId: result.topIntent,
    score: result.topScore,
    threshold: intent.threshold,
  };
}

const SAMPLES = [
  'how do I start a call here',
  'can we hop on a call to discuss this',
  'anyone free for a quick huddle?',
  // The hard negatives — "who is on call this week" is the one that still leaks
  // past the anti-prototypes at ~0.59. See docs/ON_DEVICE_INTENT.md §7.
  'who is on call this week',
  'the on-call rotation needs updating',
  'I called the API and it 500d',
  'there is a clear call to action on that page',
];

interface Attempt {
  text: string;
  result: ClassificationResult;
  wallMs: number;
}

function scoreTone(score: number): string {
  if (score >= 0.7) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 0.55) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export default function IntentPlaygroundScreen(): React.ReactElement {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [history, setHistory] = useState<Attempt[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Start the ~23MB model download immediately so the first run isn't a cold start.
    intentClassifier.warmup();
    inputRef.current?.focus();
  }, []);

  const run = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setRunning(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const result = await intentClassifier.classifyForPlayground(trimmed);
      const next = { text: trimmed, result, wallMs: performance.now() - startedAt };
      setAttempt(next);
      setHistory(prev => [next, ...prev].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  const wouldPrefilter = useMemo(() => text.trim().length > 0 && !prefilter(text), [text]);

  return (
    <div className='h-full overflow-y-auto bg-background'>
      <div className='mx-auto flex max-w-3xl flex-col gap-6 p-8'>
        <header className='flex flex-col gap-1'>
          <h1 className='text-xl font-semibold text-foreground'>Intent playground</h1>
          <p className='text-sm text-muted-foreground'>
            Runs the on-device embedding classifier only. Nothing is sent to the server and no
            telemetry is recorded.
          </p>
          <p className='font-mono text-xs text-muted-foreground'>
            {MODEL_VERSION} · prototypes v{PROTOTYPES_VERSION} · {intentCount} intent
            {intentCount === 1 ? '' : 's'}
          </p>
        </header>

        <section className='flex flex-col gap-3'>
          <Textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void run(text);
              }
            }}
            placeholder='Type a message as it would appear in a channel…'
            className='min-h-[96px]'
          />

          <div className='flex items-center gap-3'>
            <Button
              onClick={() => void run(text)}
              data-track-category='intent-playground'
              data-track-name='run-classify'
              disabled={running || !text.trim()}
            >
              {running ? <Loader2 className='animate-spin' /> : <Play />}
              {running ? 'Classifying…' : 'Classify'}
            </Button>
            <span className='text-xs text-muted-foreground'>⌘/Ctrl + Enter</span>
            {wouldPrefilter && (
              <span className='text-xs text-amber-600 dark:text-amber-400'>
                Prefilter will reject this — no embedding will run
              </span>
            )}
          </div>

          <div className='flex flex-wrap gap-2'>
            {SAMPLES.map(sample => (
              <button
                key={sample}
                type='button'
                data-track-category='intent-playground'
                data-track-name='sample-phrase'
                onClick={() => {
                  setText(sample);
                  void run(sample);
                }}
                className='rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className='rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive'>
            {error}
          </div>
        )}

        {attempt && <ResultPanel attempt={attempt} />}

        {history.length > 1 && (
          <section className='flex flex-col gap-2'>
            <h2 className='text-sm font-medium text-foreground'>Session history</h2>
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-xs'>
                <thead className='text-muted-foreground'>
                  <tr>
                    <th className='py-1 pr-4 font-medium'>Score</th>
                    <th className='py-1 pr-4 font-medium'>Intent</th>
                    <th className='py-1 pr-4 font-medium'>Embed</th>
                    <th className='py-1 font-medium'>Text</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={`${h.text}-${i}`} className='border-t border-border'>
                      <td className={`py-1 pr-4 font-mono ${scoreTone(h.result.topScore)}`}>
                        {h.result.prefiltered ? '—' : h.result.topScore.toFixed(3)}
                      </td>
                      <td className='py-1 pr-4 text-muted-foreground'>
                        {h.result.prefiltered ? 'prefiltered' : h.result.topIntent}
                      </td>
                      <td className='py-1 pr-4 font-mono text-muted-foreground'>
                        {h.result.embedMs.toFixed(1)}ms
                      </td>
                      <td className='py-1 text-foreground'>{h.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * States the answer in one line. Previously the panel led with "top intent:
 * start-call" for text scoring 0.21, which reads as a classification when it is
 * only an argmax that fires nothing.
 */
const VerdictBanner: React.FC<{ verdict: Verdict }> = ({ verdict }) => {
  const [tone, headline, detail] = ((): [string, string, string] => {
    switch (verdict.kind) {
      case 'fires':
        return [
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          `Fires → ${verdict.intentId}${verdict.topicId ? ` · ${verdict.topicId}` : ''}`,
          `${verdict.score.toFixed(4)} ≥ threshold ${verdict.threshold}. ${ACTION_COPY}`,
        ];
      case 'prefiltered':
        return [
          'border-border bg-muted/40 text-foreground',
          'Silent — prefiltered',
          'Rejected on shape before any embedding ran.',
        ];
      case 'unclassified':
        return [
          'border-border bg-muted/40 text-muted-foreground',
          'Silent — unclassified',
          `Best score ${verdict.score.toFixed(4)} is under the ${MIN_INTENT_SCORE} floor, so no intent claims this message.`,
        ];
      case 'absorbed':
        return [
          'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          `Silent — ${verdict.intentId}`,
          `Claimed at ${verdict.score.toFixed(4)}, but this intent is an absorber (actionable: false). It exists to stop other intents claiming these phrasings.`,
        ];
      case 'unrouted':
        return [
          'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          `Silent — ${verdict.intentId}, no topic resolved`,
          `Claimed at ${verdict.score.toFixed(4)}, but the best topic (${verdict.bestTopic} @ ` +
            `${verdict.topicScore.toFixed(4)}) missed the ${TOPIC_FLOOR} floor or the ` +
            `${TOPIC_MARGIN} margin. A how-to with no destination in the product — absorbed, ` +
            `which is what it was built to do.`,
        ];
      case 'below':
        return [
          'border-border bg-muted/40 text-muted-foreground',
          `Silent — ${verdict.intentId} below threshold`,
          `${verdict.score.toFixed(4)} < ${verdict.threshold}.`,
        ];
    }
  })();

  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <p className='text-sm font-semibold'>{headline}</p>
      <p className='mt-0.5 text-xs opacity-90'>{detail}</p>
    </div>
  );
};

function ResultPanel({ attempt }: { attempt: Attempt }): React.ReactElement {
  const { result, wallMs } = attempt;

  if (result.prefiltered) {
    return (
      <section className='rounded-md border border-border bg-muted/40 p-4'>
        <VerdictBanner verdict={{ kind: 'prefiltered' }} />
        <p className='mt-2 text-xs text-muted-foreground'>
          Stage 0 rejected this on shape alone — length bounds, bare URL, or a code fence. No
          embedding was computed, so this costs nothing.
        </p>
      </section>
    );
  }

  const gap = result.topScore - result.runnerUpScore;

  return (
    <section className='flex flex-col gap-4 rounded-md border border-border p-4'>
      <VerdictBanner verdict={verdictOf(result)} />

      {result.segments.length > 1 && (
        <div className='flex flex-col gap-1'>
          <span className='text-xs text-muted-foreground'>
            scored as {result.segments.length} segments — best match highlighted
          </span>
          <div className='flex flex-col gap-0.5'>
            {result.segments.map((seg, i) => (
              <p
                key={`${seg}-${i}`}
                className={
                  i === result.matchedSegment
                    ? 'rounded bg-primary/10 px-2 py-1 text-xs text-foreground'
                    : 'px-2 py-1 text-xs text-muted-foreground'
                }
              >
                {seg}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className='flex flex-wrap items-baseline gap-x-6 gap-y-1'>
        <div>
          <span className='text-xs text-muted-foreground'>best score</span>
          <p className={`font-mono text-sm font-medium ${scoreTone(result.topScore)}`}>
            {result.topScore.toFixed(4)}
          </p>
        </div>
        {result.runnerUpIntent && (
          <div>
            <span className='text-xs text-muted-foreground'>gap to runner-up</span>
            <p className='font-mono text-sm text-foreground'>{gap.toFixed(4)}</p>
          </div>
        )}
        <div>
          <span className='text-xs text-muted-foreground'>embed</span>
          <p className='font-mono text-sm text-foreground'>{result.embedMs.toFixed(1)}ms</p>
        </div>
        <div>
          <span className='text-xs text-muted-foreground'>round trip</span>
          <p className='font-mono text-sm text-muted-foreground'>{wallMs.toFixed(1)}ms</p>
        </div>
      </div>

      <div className='flex flex-col gap-3'>
        {result.all.map(score => {
          const intent = INTENTS.find(i => i.id === score.intentId);
          const matchedPositive = intent?.examples[score.matchedExample];
          const matchedNegative = intent?.negatives[score.matchedNegative];
          return (
            <div key={score.intentId} className='flex flex-col gap-1'>
              <div className='flex items-center justify-between gap-4 text-xs'>
                <span className='flex items-center gap-1.5 text-foreground'>
                  {score.intentId}
                  {/* Which intents can act at all, versus pure absorbers. */}
                  <span
                    className={
                      intent?.actionable
                        ? 'rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400'
                        : 'rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground'
                    }
                  >
                    {intent?.actionable ? `fires ≥ ${intent.threshold}` : 'absorber'}
                  </span>
                </span>
                {score.suppressed ? (
                  <span className='font-mono text-destructive'>suppressed</span>
                ) : (
                  <span className={`font-mono ${scoreTone(score.score)}`}>
                    {score.score.toFixed(4)}
                  </span>
                )}
              </div>
              <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
                <div
                  className={`h-full rounded-full ${score.suppressed ? 'bg-destructive/50' : 'bg-primary'}`}
                  style={{
                    width: `${Math.max(0, Math.min(1, score.suppressed ? score.negativeScore : score.score)) * 100}%`,
                  }}
                />
              </div>
              {score.suppressed ? (
                <p className='text-[11px] text-destructive'>
                  anti-prototype won at {score.negativeScore.toFixed(4)}
                  {matchedNegative ? ` — “${matchedNegative}”` : ''}
                </p>
              ) : (
                <>
                  {matchedPositive && (
                    <p className='text-[11px] text-muted-foreground'>
                      closest example: “{matchedPositive}”
                    </p>
                  )}
                  <p className='text-[11px] text-muted-foreground'>
                    nearest anti-prototype: {score.negativeScore.toFixed(4)}
                    {matchedNegative ? ` — “${matchedNegative}”` : ''}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      <TopicPanel result={result} />

      <p className='text-[11px] text-muted-foreground'>
        Thresholds here come from the 49-fixture eval, which is a small held-out set. The live
        values get re-read off the production score histogram — see docs/ON_DEVICE_INTENT.md §7.
      </p>
    </section>
  );
}

/**
 * Stage 2 — which specific thing a how-to was about.
 *
 * Rendered only when the winning intent declares a topic table, because "no
 * topics" and "topics that all scored zero" are different states and collapsing
 * them would hide the first.
 */
function TopicPanel({ result }: { result: ClassificationResult }): React.ReactElement | null {
  const { topic } = result;
  if (!topic) return null;

  // getIntent(), not INTENTS.find(): INTENTS is `as const`, so find() returns a
  // union of literal types and only the members that declare `topics` have it.
  const intent = getIntent(result.topIntent);
  const resolved = topic.topicId !== UNRESOLVED_TOPIC;

  return (
    <div className='rounded-md border border-border bg-muted/20 p-3'>
      <div className='flex items-baseline justify-between gap-3'>
        <p className='text-xs font-semibold text-foreground'>
          Stage 2 · topic routing for “{result.topIntent}”
        </p>
        <span className='font-mono text-[11px] text-muted-foreground'>
          floor {TOPIC_FLOOR} · margin {TOPIC_MARGIN}
        </span>
      </div>
      <p className='mt-0.5 text-[11px] text-muted-foreground'>
        Scored on the same vector stage 1 used — no second embedding.
      </p>

      <div className='mt-3 flex flex-col gap-3'>
        {topic.all.map(t => {
          const spec = intent?.topics?.find(x => x.id === t.topicId);
          const isWinner = resolved && t.topicId === topic.topicId;
          return (
            <div key={t.topicId} className='flex flex-col gap-1'>
              <div className='flex items-center justify-between gap-4 text-xs'>
                <span className='flex items-center gap-1.5 text-foreground'>
                  {t.topicId}
                  {isWinner && (
                    <span className='rounded bg-emerald-500/15 px-1 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400'>
                      routed
                    </span>
                  )}
                </span>
                {t.suppressed ? (
                  <span className='font-mono text-destructive'>suppressed</span>
                ) : (
                  <span className={`font-mono ${scoreTone(t.score)}`}>{t.score.toFixed(4)}</span>
                )}
              </div>
              <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
                <div
                  className={`h-full rounded-full ${t.suppressed ? 'bg-destructive/50' : 'bg-primary'}`}
                  style={{
                    width: `${Math.max(0, Math.min(1, t.suppressed ? t.negativeScore : t.score)) * 100}%`,
                  }}
                />
              </div>
              {t.suppressed ? (
                <p className='text-[11px] text-destructive'>
                  anti-prototype won at {t.negativeScore.toFixed(4)}
                  {spec?.negatives[t.matchedNegative]
                    ? ` — “${spec.negatives[t.matchedNegative]}”`
                    : ''}
                </p>
              ) : (
                spec?.examples[t.matchedExample] && (
                  <p className='text-[11px] text-muted-foreground'>
                    closest: “{spec.examples[t.matchedExample]}”
                  </p>
                )
              )}
            </div>
          );
        })}
      </div>

      <p className='mt-3 font-mono text-[11px] text-muted-foreground'>
        margin {topic.margin.toFixed(4)} vs runner-up {topic.runnerUpId ?? '—'} ·{' '}
        {resolved ? `routed to ${topic.topicId}` : 'unresolved — nothing fires'}
      </p>
    </div>
  );
}
