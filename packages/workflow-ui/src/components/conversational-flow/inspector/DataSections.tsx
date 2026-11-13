/**
 * What a screen fetches, and what it can use.
 *
 * Two groups, because they answer two different questions and only one of them
 * is about this screen:
 *
 * - on a section — *what it provides*: fetched once on the way in, readable by
 *   everything inside it. The map draws that as the box around them.
 * - on any screen — *what it can use*: its own lookups and every one running
 *   further out, which is the list you want while writing what a screen says.
 */
import { useEffect, useId, useState } from 'react';
import { Database, Plus, Trash2 } from 'lucide-react';
import {
  addCall,
  answerRef,
  breadcrumb,
  callRef,
  quotedIn,
  setConversationInputs,
  type Call,
  type ConversationalFlow,
  type DeclaredField,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import {
  extractRefPath,
  type TypeKind,
} from '@xyne/workflow-sdk/builder';
import {
  isExpression,
} from '@xyne/workflow-sdk/expression';
import { Calculate } from './Calculate.js';
import { Button, type Edit, FieldLabel, Select, TextInput } from '../ui.js';

/** Every lookup in scope on this screen, innermost first, with where it runs. */
export function inScope(flow: ConversationalFlow, screen: Screen): Array<{ call: Call; on: Screen }> {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const frames = [screen.id, ...[...screen.frames].reverse()];
  const seen = new Set<string>();
  const out: Array<{ call: Call; on: Screen }> = [];
  for (const id of frames) {
    const on = byId.get(id);
    if (!on || seen.has(id)) continue;
    seen.add(id);
    for (const call of on.calls) {
      // A screen-scope lookup on a frame above runs for that screen, not this one.
      if (on.id !== screen.id && call.scope === 'screen') continue;
      out.push({ call, on });
    }
  }
  return out;
}

/**
 * One group, not two: what this screen fetches. What it can *use* is the nodes
 * on the map in front of it and the frames above — visible there, and offered
 * by name where the wording is written, so listing it here would only say the
 * same thing twice.
 */
export function ScreenData({
  flow,
  screen,
  edit,
  readOnly,
  onSelect,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
}) {
  const own = screen.calls;
  const everywhere = screen.id === flow.rootScreen;
  const section = screen.children.length > 0;
  if (own.length === 0 && readOnly) return null;

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
        {everywhere
          ? 'A lookup here runs once, before the conversation starts, and every screen in the flow can use what it found — however someone got there.'
          : section
            ? `A lookup here runs once on the way in, and every screen inside “${screen.title}” can use what it found.`
            : 'A lookup here runs every time this screen opens.'}
      </p>
      {own.map((call) => (
        <CallRow key={call.id} flow={flow} call={call} on={screen} here={screen} onSelect={onSelect} />
      ))}
      {!readOnly && <AddLookup screen={screen} edit={edit} onSelect={onSelect} />}
    </>
  );
}


/** One lookup: what it is, where it runs, and what it hands you. */
function CallRow({
  flow,
  call,
  on,
  here,
  onSelect,
}: {
  flow: ConversationalFlow;
  call: Call;
  on: Screen;
  here: Screen;
  onSelect: (id: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const elsewhere = on.id !== here.id;
  const unused = quotedIn(flow, call.id).length === 0;
  const fields = call.fields.length > 0 ? call.fields : [{ path: '', type: undefined }];

  return (
    <div className="flex flex-col gap-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] p-2">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => onSelect(call.id)}
          className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-medium text-[var(--wui-fg)] hover:text-[var(--wui-primary)]"
        >
          <Database className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--wui-cf-data, var(--wui-primary))' }} aria-hidden />
          <span className="truncate">{call.title}</span>
        </button>
        <span className="ml-auto shrink-0 text-[11.5px] text-[var(--wui-fg-muted)]">
          {elsewhere ? `from ${breadcrumb(flow, on) || on.title}` : call.scope === 'screen' ? 'this screen' : 'this section'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {fields.slice(0, 6).map((field) => {
          const ref = callRef(call.id, field.path ? `body.${field.path}` : 'body');
          return (
            <button
              key={ref}
              type="button"
              title={`Copy ${ref}`}
              onClick={() => {
                void navigator.clipboard?.writeText(ref);
                setCopied(ref);
              }}
              className="rounded-full bg-[var(--wui-bg-subtle)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
            >
              {field.path || 'body'}
            </button>
          );
        })}
        {fields.length > 6 && <span className="text-[11px] text-[var(--wui-fg-muted)]">+{fields.length - 6}</span>}
      </div>
      {copied !== null && <p className="text-[11px] text-[var(--wui-fg-muted)]">Copied {copied}</p>}
      {unused && !elsewhere && <p className="text-[11px] text-[var(--wui-status-failed)]">Nothing uses this yet.</p>}
    </div>
  );
}

/** Adding one, the way a screen is added: a button that opens an inline form. */
function AddLookup({ screen, edit, onSelect }: { screen: Screen; edit: Edit; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const uid = useId();

  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Look something up
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        // Select it once it exists: the next thing anyone does is configure it.
        let added = '';
        const done = edit((config) => {
          const made = addCall(config, screen.id, {
            title: title.trim() || 'Lookup',
            request: { method: 'GET', url: url.trim(), timeoutMs: 10_000, response: { type: 'json' } },
          });
          added = made.callId;
          return made.config;
        });
        if (!done) return;
        setTitle('');
        setUrl('');
        setOpen(false);
        if (added) onSelect(added);
      }}
    >
      <div>
        <FieldLabel htmlFor={`${uid}-url`}>Address</FieldLabel>
        <TextInput
          id={`${uid}-url`}
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/orders/{{trigger.context.orderId}}"
          className="font-mono text-[12px]"
        />
      </div>
      <div>
        <FieldLabel htmlFor={`${uid}-name`} hint="optional">Name</FieldLabel>
        <TextInput id={`${uid}-name`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lookup" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!url.trim()}>Add lookup</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * Everything a screen can quote, grouped by where it came from.
 *
 * Two sources today — what the conversation was started with, and what a lookup
 * found — and an author does not think in those terms: they think "what do I
 * know here". So it is one list, with the source as a caption.
 */
/**
 * One thing a screen can quote.
 *
 * Carries both spellings of the same address, because the two places it goes
 * need different ones and this is the only function that knows how a value is
 * addressed: `ref` is how it is quoted inside a sentence, `path` is the bare
 * form an expression reads. `path` is derived from `ref` rather than built
 * alongside it, so the two can never disagree.
 *
 * `type` is the JSON-Schema type its author declared — it was already on both
 * `flow.inputs` and `call.fields` and used to be dropped here. It is what lets
 * a picker say what it is handing you, and an operation say which values it can
 * take.
 */
export interface FlowValue {
  label: string;
  /** Quoted in text: `{{steps.…}}`. */
  ref: string;
  /** The same address, bare, for inside a `{% … %}`. */
  path: string;
  /** Declared type, when its author declared one. */
  type: string | undefined;
  /**
   * For a list of objects: the fields of each item — what a filter can test and
   * what a total can add up. Absent for everything else.
   */
  itemFields?: DeclaredField[];
}

export function valuesFor(
  flow: ConversationalFlow,
  screen: Screen,
): Array<{ group: string; items: FlowValue[] }> {
  const out: Array<{ group: string; items: FlowValue[] }> = [];
  const value = (label: string, ref: string, field: DeclaredField): FlowValue => ({
    label,
    ref,
    // Both spellings this editor produces already name an explicit root
    // (`trigger.…`, `steps.<id>.output.…`), which is exactly what an expression
    // requires — so stripping the braces is the whole conversion.
    path: extractRefPath(ref) ?? '',
    type: field.type,
    ...(field.itemFields ? { itemFields: field.itemFields } : {}),
  });

  if (flow.inputs.length > 0) {
    out.push({
      group: 'Started with',
      items: flow.inputs.map((input) =>
        value(input.path, `{{trigger.context.${input.path}}}`, input),
      ),
    });
  }
  for (const on of asking(flow, screen)) {
    const question = on.questions[0]!;
    out.push({
      // An input screen is named plainly, since asking is the whole screen.
      group:
        on.id === screen.id
          ? 'What it asks on the way in'
          : on.kind === 'input'
            ? on.title
            : `Asked entering ${breadcrumb(flow, on) || on.title}`,
      items: question.answers.map((answer) => value(answer.path, answerRef(question.id, answer.path), answer)),
    });
  }
  for (const { call, on } of inScope(flow, screen)) {
    out.push({
      group: on.id === screen.id ? call.title : `${call.title} · from ${breadcrumb(flow, on) || on.title}`,
      items: (call.fields.length > 0 ? call.fields : [{ path: '', type: undefined }]).map((field) =>
        value(
          field.path || 'the whole answer',
          callRef(call.id, field.path ? `body.${field.path}` : 'body'),
          field,
        ),
      ),
    });
  }

  return out;
}

/**
 * The frames whose question is in scope here: this screen's own, and every frame
 * it sits inside. Asked before the frame, so everything inside can read it — the
 * same reach a section's lookup has, for the same reason.
 */
function asking(flow: ConversationalFlow, screen: Screen): Screen[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  // An input screen's own question runs before its frame, so it cannot quote
  // itself — what it asks for is for the screens inside it.
  const frames = screen.kind === 'input' ? [...screen.frames].reverse().slice(1) : [screen.id, ...[...screen.frames].reverse()];
  return frames
    .map((id) => byId.get(id))
    .filter((on): on is Screen => on !== undefined && on.questions.length > 0)
    .filter((on, at, all) => all.findIndex((other) => other.id === on.id) === at);
}

/** Chosen when someone wants to name a reference this list doesn't hold. */
const TYPE_IT = '\u0000type';

/** Chosen when the value they want isn't in the list because it isn't there yet. */
const CALCULATE = '\u0000calc';

/**
 * Choosing one value, for somewhere a reference is the whole content — the left
 * side of a condition, rather than a sentence with a value in it.
 *
 * The list is what this screen knows. A reference it doesn't hold — something
 * deeper inside an answer than the fields anyone declared — is still nameable,
 * by typing it; picking it back off the list is how you stop.
 */
export function ValuePicker({
  flow,
  screen,
  value,
  readOnly,
  expects,
  onChange,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  value: string;
  readOnly: boolean;
  /**
   * What whatever consumes this insists on, when it insists — an operator that
   * can only hold against a number should not offer ways of producing text.
   */
  expects?: TypeKind | undefined;
  onChange: (ref: string) => void;
}) {
  const groups = valuesFor(flow, screen);
  const known = groups.some((g) => g.items.some((i) => i.ref === value));
  const [typing, setTyping] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const computed = isExpression(value.trim());

  // Adding it here rather than at each call site means every place that picks a
  // value — a condition's left side today, whatever comes next — can also work
  // one out, and they cannot drift apart.
  if (calculating) {
    return (
      <Calculate
        groups={groups}
        // Carried in, so "rebuild" opens the form holding what is already
        // there rather than making the author start over.
        {...(computed ? { initial: value } : {})}
        {...(expects === undefined ? {} : { expects })}
        onInsert={(text) => {
          onChange(text);
          setCalculating(false);
        }}
        onCancel={() => setCalculating(false)}
      />
    );
  }

  // A worked-out value, shown as what it is rather than dropped into a box
  // labelled `{{steps.…}}`. It gets its own row because the two things it needs
  // — change it, or get rid of it — must both be deliberate: this used to render
  // as an unrecognised reference beside a button that replaced it with the first
  // value in the list, which is not an edit anyone asked for.
  if (computed && !typing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span
          title={value}
          className="min-w-0 flex-1 truncate rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] px-1.5 py-1 font-mono text-[11px] text-[var(--wui-fg)]"
        >
          {value}
        </span>
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => setCalculating(true)}
              title="Work it out again, from the list"
              className="shrink-0 text-[11px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
            >
              rebuild
            </button>
            <button
              type="button"
              onClick={() => setTyping(true)}
              title="Change the expression itself"
              className="shrink-0 text-[11px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
            >
              edit
            </button>
          </>
        )}
      </span>
    );
  }

  if (typing || (value !== '' && !known)) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <input
          aria-label="Which value"
          autoFocus={typing}
          value={value}
          disabled={readOnly}
          spellCheck={false}
          placeholder={computed ? '{% … %}' : '{{steps.…}}'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTyping(false)}
          className="min-w-0 flex-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-1.5 py-1 font-mono text-[11px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)] disabled:opacity-60"
        />
        {groups.length > 0 && !readOnly && (
          <button
            type="button"
            // Clears, rather than substituting the first value in the list.
            // Returning to the list means abandoning what is typed — that is
            // unavoidable, since the list cannot show it — so it says so
            // instead of quietly choosing something on the author's behalf.
            onClick={() => {
              setTyping(false);
              onChange('');
            }}
            title="Discard this and choose from the list"
            className="shrink-0 text-[11px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
          >
            clear
          </button>
        )}
      </span>
    );
  }

  return (
    <Select
      aria-label="Which value"
      disabled={readOnly}
      value={known ? value : ''}
      onChange={(e) => {
        if (e.target.value === TYPE_IT) setTyping(true);
        else if (e.target.value === CALCULATE) setCalculating(true);
        else onChange(e.target.value);
      }}
      className="w-auto max-w-[11rem] px-2 py-1 text-[12px]"
    >
      <option value="">Pick a value…</option>
      {groups.map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.items.map((item) => (
            <option key={item.ref} value={item.ref}>
              {item.type ? `${item.label} · ${item.type}` : item.label}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CALCULATE}>Work it out…</option>
      <option value={TYPE_IT}>Type a reference…</option>
    </Select>
  );
}

/**
 * Putting a value into what a screen says, where the cursor is.
 *
 * The list is everything in scope here — which is why it lives beside the box
 * rather than in a settings panel somewhere: the question "what can I say" and
 * the question "what do I have" are the same question while you are writing.
 */
export function InsertValue({
  flow,
  screen,
  insert,
  open,
  onOpenChange,
  editing,
  onEdited,
  onEditingDone,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  insert: (text: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A worked-out value already written, opened for editing rather than built
   * from nothing — someone clicked its pill in the text above.
   */
  editing?: string | undefined;
  /** The replacement for it. Not `insert`: it goes back where it was. */
  onEdited?: ((next: string) => void) | undefined;
  onEditingDone?: (() => void) | undefined;
}) {
  const groups = valuesFor(flow, screen);
  const [calculating, setCalculating] = useState(false);
  if (groups.length === 0) return null;

  // Editing an existing one wins over everything else this renders: the author
  // asked about *that* value, not about inserting another.
  if (editing !== undefined) {
    return (
      <Calculate
        groups={groups}
        initial={editing}
        onInsert={(text) => { onEdited?.(text); }}
        onCancel={() => { onEditingDone?.(); }}
      />
    );
  }


  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="self-start text-[12px] text-[var(--wui-fg-muted)] underline-offset-2 hover:text-[var(--wui-fg)] hover:underline"
      >
        Insert a value…
      </button>
    );
  }

  if (calculating) {
    return (
      <Calculate
        groups={groups}
        onInsert={(text) => {
          insert(text);
          setCalculating(false);
          onOpenChange(false);
        }}
        onCancel={() => setCalculating(false)}
      />
    );
  }

  return (
    <div role="listbox" aria-label="Insert a value" className="flex flex-col gap-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2">
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--wui-fg-muted)]">{group.group}</p>
          <div className="flex flex-wrap gap-1">
            {group.items.map((item) => (
              <button
                key={item.ref}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  insert(item.ref);
                  onOpenChange(false);
                }}
                title={item.type ? `${item.label} — ${item.type}` : item.label}
                className="rounded-full border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-2 py-0.5 font-mono text-[11px] text-[var(--wui-fg)] hover:border-[var(--wui-primary)]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* A value that has to be worked out rather than quoted. Below the list
          and behind one more click, because quoting is the common case. */}
      <div className="mt-0.5 flex items-center gap-2 border-t border-[var(--wui-border)] pt-1.5">
        <button
          type="button"
          onClick={() => setCalculating(true)}
          className="text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
        >
          Calculate…
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="ml-auto text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * What the conversation is started with.
 *
 * The same act as naming a lookup's fields, and deliberately the same shape: you
 * are promising that these names will be there, so that a screen can quote them,
 * the validator can check them, and the Test tab can ask you for them.
 */
export function StartedWith({
  flow,
  edit,
  readOnly,
}: {
  flow: ConversationalFlow;
  edit: Edit;
  readOnly: boolean;
}) {
  const declared = flow.inputs.map((i) => i.path);
  const [names, setNames] = useState<string[]>(declared);
  const [sample, setSample] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setNames(flow.inputs.map((i) => i.path));
  }, [flow.inputs.map((i) => i.path).join('|')]);

  const write = (next: string[]) => {
    setNames(next);
    edit((config) => setConversationInputs(config, next.map((path) => ({ path }))));
  };

  const read = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setProblem('That isn’t JSON — paste what your app passes in.');
      return;
    }
    const found = pathsOf(parsed);
    if (found.length === 0) {
      setProblem('Nothing to name in that.');
      return;
    }
    setProblem(null);
    setSample(null);
    write([...new Set([...names.filter((n) => n.trim() !== ''), ...found])]);
  };

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
        What whoever starts this conversation passes in. Naming them here is what lets a screen quote them, and what the test
        asks you for.
      </p>

      {sample !== null ? (
        <div className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2">
          <textarea
            aria-label="A sample start"
            autoFocus
            rows={5}
            value={sample}
            spellCheck={false}
            onChange={(e) => setSample(e.target.value)}
            placeholder={'{\n  "orderId": "A-1",\n  "customer": { "tier": "priority" }\n}'}
            className="w-full resize-y rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
          />
          {problem !== null && <p className="text-[11.5px] text-[var(--wui-status-failed)]">{problem}</p>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => read(sample)} disabled={sample.trim() === ''}>Read the names</Button>
            <Button variant="ghost" onClick={() => { setSample(null); setProblem(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {names.map((name, at) => (
            <div key={at} className="group/input flex items-center gap-1.5">
              <code className="shrink-0 font-mono text-[11px] text-[var(--wui-fg-muted)]">context.</code>
              <input
                aria-label="Value name"
                value={name}
                disabled={readOnly}
                placeholder="orderId"
                onChange={(e) => setNames(names.map((n, i) => (i === at ? e.target.value : n)))}
                onBlur={() => write(names)}
                className="flex-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
              />
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => write(names.filter((_, i) => i !== at))}
                  className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] opacity-35 transition-opacity hover:text-[var(--wui-status-failed)] group-hover/input:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setSample('')} className="text-[12px] font-medium text-[var(--wui-primary)] hover:underline">
                Paste a sample start
              </button>
              <button type="button" onClick={() => setNames([...names, ''])} className="text-[12px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">
                <Plus className="inline h-3 w-3" /> or name one
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Every leaf of a sample, as a dotted name. */
function pathsOf(value: unknown, at = '', depth = 0): string[] {
  if (depth > 3 || Array.isArray(value) || value === null || typeof value !== 'object') return at ? [at] : [];
  const out: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out.push(...pathsOf(inner, at ? `${at}.${key}` : key, depth + 1));
    if (out.length > 30) break;
  }
  return out;
}
