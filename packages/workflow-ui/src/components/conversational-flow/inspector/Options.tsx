/**
 * What a screen offers, laid out the way it will be read: one line per option,
 * in the order they appear, with where it leads under it.
 *
 * The row is quiet at rest — it is a list to be read, and most visits only read
 * it. Reordering and removing appear on the row you are pointing at; the way
 * back is generated from where the screen sits, so it is folded away.
 *
 * An option can be offered only sometimes. That is written on the option
 * itself — "show this line when…" — because that is what it is: the same
 * question, asked of two people who are owed different choices.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  addOption,
  moveOption,
  relabelOption,
  removeOption,
  retargetOption,
  setOptionCondition,
  type Condition,
  type ConversationalFlow,
  type NewScreenType,
  type Prompt,
  type PromptOption,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import { Button, CommitInput, type Edit, IconButton, ScreenPicker, TextInput, TypeChoice } from '../ui.js';
import { ConditionEditor, ConditionLine, canDecide, firstCondition } from './ConditionEditor.js';

/** What this needs of a question: which one it is, and what it offers. */
export type Asking = Pick<Prompt, 'id' | 'options'> & { optionsFrom?: string | undefined };

export function OptionList({
  flow,
  screen,
  prompt,
  edit,
  readOnly,
  onSelect,
  onNewScreen,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  /** The question whose options these are: a screen's own, or the one it asks on the way in. */
  prompt: Asking;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onNewScreen?: ((args: { title: string; type: NewScreenType }) => void) | undefined;
}) {
  // Which row has its condition open. Closed whenever the list itself changes,
  // since an index no longer means the option it meant.
  const [editing, setEditing] = useState<number | null>(null);
  const indexed = prompt.options.map((o, i) => ({ o, i }));
  const forward = indexed.filter(({ o }) => !o.back);
  const back = indexed.filter(({ o }) => o.back);
  const decidable = canDecide(flow, screen);

  // Any edit that changes the list itself closes the open condition first: an
  // index no longer means the option it meant.
  const structural: Edit = (change) => {
    setEditing(null);
    return edit(change);
  };

  const row = ({ o, i }: { o: PromptOption; i: number }, position: number, count: number, generated: boolean) => (
    <li key={`${o.value}-${i}`} className="group/opt flex flex-col gap-1 px-2 py-1.5 hover:bg-[var(--wui-bg-subtle)]">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <CommitInput
          aria-label={`Option ${String(i + 1)}`}
          value={o.label}
          disabled={readOnly}
          onCommit={(label) => edit((c) => relabelOption(c, prompt.id, i, label))}
          className="w-auto min-w-[6rem] flex-1 border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium hover:border-[var(--wui-border)]"
        />

        <span className="flex shrink-0 items-center gap-0.5 text-[var(--wui-fg-muted)]">
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
          {o.to.kind === 'screen' ? (
            <ScreenPicker
              aria-label={`Option ${String(i + 1)} opens`}
              flow={flow}
              value={o.to.screen}
              disabled={readOnly}
              onChange={(target) => edit((c) => retargetOption(c, prompt.id, i, target))}
              className="w-auto max-w-[11rem] truncate border-transparent bg-transparent px-1 py-0.5 pr-5 text-[12.5px] text-[var(--wui-fg-muted)] hover:border-[var(--wui-border)] hover:text-[var(--wui-fg)]"
            />
          ) : (
            <span className="px-1 text-[12.5px]">—</span>
          )}
        </span>

        {!readOnly && (
          <div className="flex shrink-0 items-center">
            {/* Making a line conditional is a feature, not a row affordance, so
                it is on the row rather than behind a hover. */}
            {!generated && o.when === undefined && (
              <button
                type="button"
                disabled={!decidable}
                title={decidable ? 'Offer this only under a condition' : 'This screen has nothing to decide on yet — start the conversation with a value, or look something up.'}
                onClick={() => {
                  if (edit((c) => setOptionCondition(c, prompt.id, i, firstCondition(flow, screen)))) setEditing(i);
                }}
                className="rounded px-1.5 py-1 text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Only when…
              </button>
            )}
            {/* Reordering and removing recede until you point at the row. They
                fade rather than disappear: a control nobody can find on a touch
                screen — or when one CSS rule fails to load — is not there at all. */}
            <span className="flex items-center opacity-35 transition-opacity group-hover/opt:opacity-100 group-focus-within/opt:opacity-100">
              <IconButton label="Move up" disabled={position === 0} onClick={() => structural((c) => moveOption(c, prompt.id, i, i - 1))}>
                <ArrowUp className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Move down" disabled={position === count - 1} onClick={() => structural((c) => moveOption(c, prompt.id, i, i + 1))}>
                <ArrowDown className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Remove option" tone="danger" onClick={() => structural((c) => removeOption(c, prompt.id, i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          </div>
        )}
      </div>

      {o.when !== undefined && editing !== i && (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setEditing(i)}
          className="flex items-center gap-1.5 self-start rounded-[var(--wui-radius-sm)] px-1 py-0.5 text-[11.5px] hover:bg-[var(--wui-bg-muted)] disabled:cursor-default"
          style={{ color: 'var(--wui-cf-data)' }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
          <span className="text-[var(--wui-fg-muted)]">Only when</span>
          <ConditionLine condition={o.when} />
        </button>
      )}

      {o.when !== undefined && editing === i && (
        <ConditionEditor
          flow={flow}
          screen={screen}
          condition={o.when}
          readOnly={readOnly}
          title={`Show “${o.label}” only when`}
          onChange={(next: Condition) => edit((c) => setOptionCondition(c, prompt.id, i, next))}
          onRemove={() => {
            setEditing(null);
            edit((c) => setOptionCondition(c, prompt.id, i, undefined));
          }}
          onDone={() => setEditing(null)}
        />
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-[var(--wui-border)] overflow-hidden rounded-[var(--wui-radius)] border border-[var(--wui-border)]" aria-label="Options">
        {forward.length === 0 && (
          <li className="px-3 py-2.5 text-[12.5px] text-[var(--wui-fg-muted)]">Nothing to tap yet — add an option, or a screen beneath this one.</li>
        )}
        {forward.map((entry, n) => row(entry, n, forward.length, false))}
      </ul>
      {!readOnly && <AddOption flow={flow} screen={screen} prompt={prompt} edit={structural} onNewScreen={onNewScreen} onSelect={onSelect} />}
      {back.length > 0 && (
        <details className="rounded-[var(--wui-radius)] border border-[var(--wui-border)]">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-[var(--wui-fg-muted)]">
            Ways back · {back.map(({ o }) => o.label).join(', ')}
          </summary>
          <ul className="flex flex-col divide-y divide-[var(--wui-border)] border-t border-[var(--wui-border)]">
            {back.map((entry, n) => row(entry, n, back.length, true))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Add an option — to a screen that exists, or to a new one made here. */
function AddOption({
  flow,
  screen,
  prompt,
  edit,
  onNewScreen,
  onSelect,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  prompt: Asking;
  edit: Edit;
  onNewScreen?: ((args: { title: string; type: NewScreenType }) => void) | undefined;
  onSelect: (id: string) => void;
}) {
  const [mode, setMode] = useState<'closed' | 'new' | 'existing'>('closed');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<NewScreenType>('message');
  const [target, setTarget] = useState('');
  // A Message has no room beneath it, so it is not offered a screen to put there.
  const canHoldScreens = screen.kind === 'menu';
  const isEntry = (screen.prompts[0] ?? screen.questions[0])?.id === prompt.id;

  if (mode === 'closed') {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {onNewScreen && isEntry && canHoldScreens && (
          <Button variant="primary" onClick={() => setMode('new')}>
            <Plus className="h-3.5 w-3.5" /> New screen beneath
          </Button>
        )}
        <Button variant="secondary" onClick={() => setMode('existing')}>
          <Plus className="h-3.5 w-3.5" /> Link a screen
        </Button>
      </div>
    );
  }

  if (mode === 'new' && onNewScreen) {
    return (
      <form
        className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onNewScreen({ title, type });
          setTitle('');
          setMode('closed');
        }}
      >
        <p className="text-[12.5px] font-medium text-[var(--wui-fg)]">New screen beneath “{screen.title}”</p>
        <TextInput
          autoFocus
          aria-label={`New screen beneath “${screen.title}”`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Promo codes"
        />
        <TypeChoice value={type} onChange={setType} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!title.trim()}>Add screen</Button>
          <Button variant="ghost" onClick={() => setMode('closed')}>Cancel</Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        const label = title.trim() || flow.screens.find((s) => s.id === target)?.title || target;
        if (edit((c) => addOption(c, prompt.id, { label, screen: target }))) {
          setTitle('');
          setTarget('');
          setMode('closed');
        }
      }}
    >
      <p className="text-[12.5px] font-medium text-[var(--wui-fg)]">An option that opens a screen</p>
      <ScreenPicker aria-label="Which screen" flow={flow} value={target} onChange={setTarget} placeholder="Choose a screen…" />
      <TextInput aria-label="Option label" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Label (defaults to the screen’s title)" />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!target}>Add option</Button>
        <Button variant="ghost" onClick={() => setMode('closed')}>Cancel</Button>
        {target && <Button variant="ghost" className="ml-auto" onClick={() => onSelect(target)}>Open it</Button>}
      </div>
    </form>
  );
}
