/**
 * What a screen asks: the message someone reads, and the options under it.
 *
 * Laid out as the thing it makes — the message in the shape it will arrive in,
 * the options as the list they will be shown — because the panel's first job is
 * to let you see what you are writing.
 *
 * A screen can ask more than one way, each under the condition it is asked for,
 * with the one asked when nothing else holds at the bottom. That is exactly what
 * is stored: one whole way of asking per branch, not one list with toggles on
 * it, because pretending otherwise would be lying about the config.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  addVersion,
  removeVersion,
  setVersionWhen,
  optionsFrom,
  setOptionsFromLookup,
  setPromptSays,
  setOptionsWritten,
  type Condition,
  type ConversationalFlow,
  type NewScreenType,
  type Prompt,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import { Button, type Edit, SectionHead, Select } from '../ui.js';
import { ConditionEditor, ConditionLine, canDecide, firstCondition } from './ConditionEditor.js';
import { inScope } from './DataSections.js';
import { Message } from './Message.js';
import { OptionList } from './Options.js';

export function Asking({
  flow,
  screen,
  edit,
  readOnly,
  onSelect,
  onNewScreen,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onNewScreen: (args: { title: string; type: NewScreenType }) => void;
}) {
  const first = screen.prompts[0];
  if (!first) return null;

  const versions = screen.versions.length > 0 ? screen.versions : [{ promptId: first.id }];
  const byId = new Map(screen.prompts.map((p) => [p.id, p]));
  const several = versions.length > 1;

  return (
    <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
      {versions.map((version, at) => {
        const prompt = byId.get(version.promptId);
        if (!prompt) return null;
        return (
          <section
            key={version.promptId}
            className={
              several
                ? 'flex flex-col gap-2.5 rounded-[var(--wui-radius)] border border-[var(--wui-border)] p-3'
                : 'flex flex-col gap-2.5'
            }
            aria-label={several ? (version.when ? `Asked when ${String(at + 1)}` : 'Asked otherwise') : 'What this screen asks'}
          >
            {several &&
              (version.when ? (
                <VersionWhen
                  flow={flow}
                  screen={screen}
                  when={version.when}
                  promptId={prompt.id}
                  readOnly={readOnly}
                  edit={edit}
                />
              ) : (
                <p className="text-[12.5px] font-medium text-[var(--wui-fg-muted)]">Otherwise</p>
              ))}

            {!several && <SectionHead n="01">Message</SectionHead>}

            {/* Each version says its own things, so its boxes need their own name
                — otherwise two versions announce the same label. */}
            <Message
              flow={flow}
              screen={screen}
              says={prompt.says}
              onSays={(next) => edit((c) => setPromptSays(c, prompt.id, next))}
              readOnly={readOnly}
              {...(several ? { label: version.when ? `What it says when ${String(at + 1)}` : 'What it says otherwise' } : {})}
            />

            <OptionsHeading flow={flow} screen={screen} prompt={prompt} edit={edit} readOnly={readOnly} {...(!several ? { n: '02' } : {})} />
            {prompt.optionsFrom === undefined ? (
              <OptionList
                flow={flow}
                screen={screen}
                prompt={prompt}
                edit={edit}
                readOnly={readOnly}
                onSelect={onSelect}
                {...(at === versions.length - 1 ? { onNewScreen } : {})}
              />
            ) : (
              <FromLookup flow={flow} screen={screen} prompt={prompt} edit={edit} readOnly={readOnly} />
            )}
          </section>
        );
      })}

      {!readOnly && <AskDifferently flow={flow} screen={screen} edit={edit} />}
    </div>
  );
}

/** "Then they can", and where the list comes from. */
function OptionsHeading({
  flow,
  screen,
  prompt,
  edit,
  readOnly,
  n,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  prompt: Prompt;
  edit: Edit;
  readOnly: boolean;
  /** Set when the heading is a numbered block. */
  n?: string;
}) {
  const fromData = prompt.optionsFrom !== undefined;
  const lookups = inScope(flow, screen);

  return (
    <div className={`flex items-baseline justify-between gap-3${n ? ' mt-3' : ''}`}>
      {n ? <SectionHead n={n}>Then they can</SectionHead> : <h3 className="text-[13px] font-semibold text-[var(--wui-fg)]">Then they can</h3>}
      {!readOnly && lookups.length > 0 && (
        <button
          type="button"
          onClick={() =>
            edit((c) =>
              fromData
                ? setOptionsWritten(c, prompt.id)
                : setOptionsFromLookup(c, prompt.id, lookups[0]!.call.id, lookups[0]!.call.fields[0]?.path ?? ''),
            )
          }
          className="text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
        >
          {fromData ? 'write the list instead' : 'take them from a lookup'}
        </button>
      )}
    </div>
  );
}

/** When this version is the one asked — the same editor an option uses. */
export function VersionWhen({
  flow,
  screen,
  when,
  promptId,
  readOnly,
  edit,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  when: Condition;
  promptId: string;
  readOnly: boolean;
  edit: Edit;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 self-start rounded-[var(--wui-radius-sm)] px-1.5 py-0.5 text-[12px] hover:bg-[var(--wui-bg-muted)] disabled:cursor-default"
        style={{ color: 'var(--wui-cf-data)' }}
      >
        <span className="text-[var(--wui-fg-muted)]">Asked when</span>
        <ConditionLine condition={when} />
      </button>
    );
  }

  return (
    <ConditionEditor
      flow={flow}
      screen={screen}
      condition={when}
      readOnly={readOnly}
      title="Ask this way when"
      onChange={(next) => edit((c) => setVersionWhen(c, promptId, next))}
      onRemove={() => {
        setOpen(false);
        edit((c) => removeVersion(c, promptId));
      }}
      onDone={() => setOpen(false)}
    />
  );
}

/** Adding a way of asking starts it as a copy of what the screen already says. */
export function AskDifferently({ flow, screen, edit }: { flow: ConversationalFlow; screen: Screen; edit: Edit }) {
  // Nothing to decide on: say what would give it one, and stay out of the way.
  if (!canDecide(flow, screen)) {
    return (
      <p className="text-[12px] text-[var(--wui-fg-muted)]">
        To ask differently, or to offer an option only sometimes, this screen first needs a value — started with, or looked up.
      </p>
    );
  }

  return (
    <Button
      variant="ghost"
      className="self-start px-1.5"
      onClick={() => edit((c) => addVersion(c, screen.id, firstCondition(flow, screen)).config)}
    >
      <Plus className="h-3.5 w-3.5" /> Ask differently when…
    </Button>
  );
}

/**
 * Options taken from a lookup: which one, and which part of its answer holds the
 * `[{ label, value }]`.
 */
function FromLookup({
  flow,
  screen,
  prompt,
  edit,
  readOnly,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  prompt: Prompt;
  edit: Edit;
  readOnly: boolean;
}) {
  const current = optionsFrom(screen, prompt.id);
  const lookups = inScope(flow, screen);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="text-[var(--wui-fg-muted)]">From</span>
        <Select
          aria-label="Which lookup"
          disabled={readOnly}
          value={current?.callId ?? ''}
          onChange={(e) => edit((c) => setOptionsFromLookup(c, prompt.id, e.target.value, current?.field ?? ''))}
          className="w-auto px-2 py-1 text-[12px]"
        >
          {lookups.map(({ call }) => (
            <option key={call.id} value={call.id}>{call.title}</option>
          ))}
        </Select>
        <span className="text-[var(--wui-fg-muted)]" aria-hidden>›</span>
        <input
          aria-label="Which field"
          disabled={readOnly}
          value={current?.field ?? ''}
          placeholder="choices"
          onChange={(e) => edit((c) => setOptionsFromLookup(c, prompt.id, current?.callId ?? lookups[0]!.call.id, e.target.value))}
          className="w-32 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-surface,var(--wui-bg))] px-1.5 py-1 font-mono text-[11.5px] text-[var(--wui-fg)]"
        />
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
        It must hold a list of <code className="font-mono text-[11px]">{'{ label, value }'}</code>, each value naming a screen.
        Where these lead isn’t known until it runs, so the map can’t draw them.
      </p>
    </div>
  );
}
