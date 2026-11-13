/**
 * What an input screen asks for.
 *
 * Asking is the whole screen, so this is its whole panel: what it says, what it
 * asks for, what the answers are for, and what answering opens. Its question
 * sits before the frame, which is why the screen inside — and everything below
 * it — can read the answers without anything carrying them.
 *
 * It asks one way, and the SDK refuses a second: each way would be its own WAIT
 * with its own id, and the screen inside can only name one — so the answer it
 * opened with would be empty whenever the other way ran. Asking differently
 * belongs to the screen inside, which is why this panel does not offer it.
 */
import { useState } from 'react';
import { List, Paperclip, Plus, Trash2, Type as TypeIcon } from 'lucide-react';
import {
  setQuestion,
  setQuestionPurpose,
  setQuestionSays,
  type ConversationalFlow,
  type QuestionDraft,
  type QuestionField,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import { Button, CommitInput, type Edit, FieldLabel, IconButton, SectionHead, Select, TextInput } from '../ui.js';
import { Message } from './Message.js';

/**
 * Every kind the layer can read. A field already written as one is still shown
 * and still edited — what is not offered is making a new one.
 */
const KINDS: Array<{ value: QuestionField['kind']; label: string; icon: typeof TypeIcon }> = [
  { value: 'text', label: 'Type', icon: TypeIcon },
  { value: 'choice', label: 'Pick', icon: List },
  { value: 'attachment', label: 'Attach', icon: Paperclip },
];

/** Scales worth not typing out. The values are the scale; nothing else records it. */
const SCALES: Array<{ label: string; choices: string[] }> = [
  { label: '1–5', choices: ['1', '2', '3', '4', '5'] },
  { label: '1–10', choices: Array.from({ length: 10 }, (_, i) => String(i + 1)) },
  { label: '👍 👎', choices: ['👍', '👎'] },
  { label: '😞 😐 🙂', choices: ['😞', '😐', '🙂'] },
];

/** Words other flows already use, so the same thing is called the same thing. */
const PURPOSES = ['feedback', 'details'];

/** An input screen asks on the way in; nothing else does. */
export function canAsk(screen: Screen): boolean {
  return screen.kind === 'input';
}

export function Asked({
  flow,
  screen,
  edit,
  readOnly,
  onSelect,
  n,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
  n?: string;
}) {
  if (!canAsk(screen)) return null;

  const asked = screen.questions[0];
  // The one screen inside it: where the answers are read.
  const inside = flow.screens.find((s) => s.id === screen.children[0])?.title;

  return (
    <section className="flex flex-col gap-4 border-t border-[var(--wui-border)] px-5 py-4">
      {n ? (
        <SectionHead n={n}>What it asks for</SectionHead>
      ) : (
        <h3 className="text-[13px] font-semibold text-[var(--wui-fg)]">What it asks for</h3>
      )}

      {asked ? (
        <Way flow={flow} screen={screen} asked={asked} readOnly={readOnly} edit={edit} />
      ) : null}

      {/* Where answering takes them. Not a list to edit: there is one screen
          inside, and branching belongs to it rather than to the question. */}
      {inside && (
        <p className="text-[12.5px] text-[var(--wui-fg-muted)]">
          Then{' '}
          <button
            type="button"
            onClick={() => { onSelect(screen.children[0]!); }}
            className="font-medium text-[var(--wui-fg)] underline decoration-dotted underline-offset-2"
          >
            {inside}
          </button>{' '}
          opens, with whatever they answered.
        </p>
      )}
    </section>
  );
}

/** One way of asking: what it says, what it asks for, and what the answers are. */
function Way({
  flow,
  screen,
  asked,
  readOnly,
  edit,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  asked: NonNullable<Screen['questions'][number]>;
  readOnly: boolean;
  edit: Edit;
}) {
  const [adding, setAdding] = useState(false);
  const asks = asked.asks;
  // One of each kind, because the key is the kind — so what is already asked
  // for is not offered again.
  const taken = new Set(asks.map((ask) => ask.kind));
  const free = KINDS.filter((kind) => !taken.has(kind.value));

  const write = (next: QuestionDraft[]): boolean => edit((c) => setQuestion(c, screen.id, next));
  const change = (at: number, to: Partial<QuestionDraft>): void => {
    write(asks.map((ask, i) => (i === at ? { ...ask, ...to } : ask)));
  };

  return (
    <section className="flex flex-col gap-2.5" aria-label="What this screen asks for">
      <Message
        flow={flow}
        screen={screen}
        says={asked.says}
        onSays={(next) => edit((c) => setQuestionSays(c, screen.id, next))}
        readOnly={readOnly}
        label="What it says while asking"
        placeholder="e.g. Which order is this about?"
      />

      {asks.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
          Nothing yet — whatever it asks for is asked once, and the screen inside can use the answer.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {asks.map((ask, at) => (
            <li
              key={ask.name}
              className="flex flex-col gap-1.5 rounded-[var(--wui-radius)] border border-[var(--wui-border)] px-2.5 py-2"
            >
              <div className="flex items-center gap-2">
                <CommitInput
                  aria-label={`What to call what it asks for, ${at + 1}`}
                  value={ask.label}
                  onCommit={(label) => change(at, { label })}
                  disabled={readOnly}
                  className="min-w-0 flex-1"
                />
                <Select
                  aria-label={`What kind of answer, ${at + 1}`}
                  value={ask.kind}
                  disabled={readOnly}
                  onChange={(e) => change(at, { kind: e.target.value as QuestionDraft['kind'] })}
                >
                  {KINDS.filter((kind) => kind.value === ask.kind || !taken.has(kind.value)).map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </Select>
                {!readOnly && (
                  <IconButton
                    label={`Stop asking for ${ask.label}`}
                    tone="danger"
                    onClick={() => write(asks.filter((_, i) => i !== at))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </div>

              {ask.kind === 'choice' && (
                <div className="flex flex-col gap-1.5">
                  <CommitInput
                    aria-label={`What they can pick, ${at + 1}`}
                    value={ask.choices.join(', ')}
                    placeholder="1, 2, 3, 4, 5"
                    disabled={readOnly}
                    // Separated by commas: these are what they pick, which are
                    // short by nature — a scale, a thumb, a handful of words.
                    onCommit={(raw) => change(at, { choices: raw.split(',').map((c) => c.trim()).filter(Boolean) })}
                  />
                  {!readOnly && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {SCALES.map((scale) => (
                        <Button key={scale.label} variant="ghost" onClick={() => change(at, { choices: scale.choices })}>
                          {scale.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 text-[11.5px] text-[var(--wui-fg-muted)]">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={ask.required}
                    disabled={readOnly}
                    onChange={(e) => change(at, { required: e.target.checked })}
                  />
                  They must answer to go further
                </label>
                <span
                  className="truncate font-mono"
                  title="What the answer is called wherever it is read. It follows the kind, so a client reads the same name in every workflow."
                >
                  as {ask.name}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && !adding && free.length > 0 && (
        <Button variant={asks.length === 0 ? 'secondary' : 'ghost'} onClick={() => { setAdding(true); }}>
          <Plus className="h-3.5 w-3.5" /> {asks.length === 0 ? 'Ask for something' : 'Add'}
        </Button>
      )}

      {adding && !readOnly && (
        <AddField
          free={free}
          onAdd={(ask) => {
            if (write([...asks, ask])) setAdding(false);
          }}
          onCancel={() => { setAdding(false); }}
        />
      )}

      {asks.length > 0 && (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`purpose-${asked.id}`} hint="for whoever reads the runs">
            These answers are
          </FieldLabel>
          <CommitInput
            id={`purpose-${asked.id}`}
            list={`purposes-${screen.id}`}
            aria-label="What these answers are"
            value={asked.purpose ?? ''}
            placeholder="e.g. feedback — leave empty if it doesn’t matter"
            disabled={readOnly}
            onCommit={(purpose) => edit((c) => setQuestionPurpose(c, screen.id, purpose))}
          />
          <datalist id={`purposes-${screen.id}`}>
            {PURPOSES.map((word) => (
              <option key={word} value={word} />
            ))}
          </datalist>
          <p className="text-[11.5px] leading-relaxed text-[var(--wui-fg-muted)]">
            Sent with the answers, so one kind of question can be told from another across workflows. The flow never reads it.
          </p>
        </div>
      )}
    </section>
  );
}

/** What to ask for, named by the author before it is written. */
function AddField({
  free,
  onAdd,
  onCancel,
}: {
  /** The kinds it does not already ask for — one of each is all it can have. */
  free: typeof KINDS;
  onAdd: (ask: QuestionDraft) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<QuestionDraft['kind']>(free[0]?.value ?? 'text');
  return (
    <form
      className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        onAdd({ kind, label: label.trim() });
      }}
    >
      <p className="text-[12.5px] font-medium text-[var(--wui-fg)]">What do you want to ask for?</p>
      <TextInput
        autoFocus
        aria-label="What to ask for"
        value={label}
        onChange={(e) => { setLabel(e.target.value); }}
        placeholder="e.g. Order number"
      />
      <Select aria-label="What kind of answer" value={kind} onChange={(e) => { setKind(e.target.value as QuestionDraft['kind']); }}>
        {free.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!label.trim()}>Add</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
