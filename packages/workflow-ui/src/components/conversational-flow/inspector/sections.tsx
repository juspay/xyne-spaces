/**
 * The inspector's building blocks. Each edits the workflow through `edit`, a
 * function from config to config; a refused edit surfaces as a message and
 * changes nothing.
 */
import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { OptionsField, useFieldOptionsScope } from '../../builder/v3/field-options.js';
import { cn } from '../../shared/cn.js';
import {
  breadcrumb,
  type ConversationalFlow,
  type Prompt,
  type Screen,
  setAskAi,
  setEndMessage,
  setPromptSays,
  setEndResult,
  setRouterGuidance,
  setRouterMode,
  setRouterService,
  scopeOf,
  setTypedRouter,
  routerFor,
  routersOf,
  routingIsValid,
  routerName,
  DEFAULT_CLASSIFIER_ENDPOINT,
} from '@xyne/workflow-sdk/conversational-flow';
import { Button, CommitInput, CommitTextarea, type Edit, FieldLabel, IconButton, TextInput } from '../ui.js';
import { CredentialDropdown } from '../../schema-form/CredentialDropdown.js';
import { AskDifferently, VersionWhen } from './Asking.js';
import { InsertValue } from './DataSections.js';
import { Message } from './Message.js';

export function Section({
  title,
  hint,
  bare = false,
  children,
}: {
  title?: string | undefined;
  hint?: string | undefined;
  /** Inside a box of its own, which already gives it its edges and its room. */
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={bare ? 'flex flex-col gap-2.5' : 'flex flex-col gap-2.5 border-t border-[var(--wui-border)] px-5 py-4 first:border-t-0'}>
      {title && (
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-[var(--wui-fg)]">{title}</h3>
          {hint && <span className="text-[11.5px] text-[var(--wui-fg-muted)]">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Agents ───

/**
 * Which agent runs: the agent step's own picker — the same one the step builder
 * shows, answered by the step's `getOptions`. Without a saved workflow to ask
 * about, a plain id field.
 */
export function AgentField({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const id = useId();
  const scope = useFieldOptionsScope();
  return (
    <div>
      <FieldLabel htmlFor={id}>Agent</FieldLabel>
      {scope?.workflowId || scope?.folderId ? (
        <OptionsField
          field={AGENT_FIELD}
          value={value}
          onChange={(v) => onChange(typeof v === 'string' ? v : '')}
          config={{ [AGENT_FIELD]: value }}
          scope={scope}
          placeholder="Choose an agent…"
          disabled={readOnly}
        />
      ) : (
        <CommitInput id={id} value={value} disabled={readOnly} onCommit={onChange} placeholder="Agent id, e.g. ask-ai" className="font-mono text-[12.5px]" />
      )}
    </div>
  );
}

/** The agent step's field naming the agent. */
const AGENT_FIELD = 'agentSlug';

export function AskAiSettings({ screen, edit, readOnly }: { screen: Screen; edit: Edit; readOnly: boolean }) {
  const ai = screen.askAi!;
  const uid = useId();
  return (
    <>
      <Section title="Ask AI">
        <AgentField value={ai.agent ?? ''} readOnly={readOnly} onChange={(agent) => edit((c) => setAskAi(c, screen.id, { agent }))} />
        <div>
          <FieldLabel htmlFor={`${uid}-intro`}>Before the first question</FieldLabel>
          <CommitTextarea id={`${uid}-intro`} value={ai.intro} rows={2} disabled={readOnly} onCommit={(intro) => edit((c) => setAskAi(c, screen.id, { intro }))} />
        </div>
        <div>
          <FieldLabel htmlFor={`${uid}-task`}>What the agent should do</FieldLabel>
          <CommitTextarea id={`${uid}-task`} value={ai.task} rows={4} disabled={readOnly} onCommit={(task) => edit((c) => setAskAi(c, screen.id, { task }))} />
        </div>
      </Section>
      <Section title="Ways out" hint="follow where this screen sits">
        <div className="flex flex-wrap gap-1.5">
          {ai.exits.map((e) => (
            <span key={e.value} className="rounded-full bg-[var(--wui-bg-muted)] px-2.5 py-1 text-[12px] text-[var(--wui-fg-muted)]">{e.label}</span>
          ))}
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
          They keep asking until they pick one of these. Each question is answered by the agent in the same conversation.
        </p>
      </Section>
    </>
  );
}

// ─── Finish ───

/**
 * How a Finish closes. It can close more than one way, each under the condition
 * it closes for, with the one used when nothing else holds at the bottom — the
 * same construct a screen that asks differently uses.
 */
export function EndResult({ flow, screen, edit, readOnly }: { flow: ConversationalFlow; screen: Screen; edit: Edit; readOnly: boolean }) {
  const several = screen.versions.length > 1;
  return (
    <>
      {several ? (
        <VersionList>
          {screen.versions.map((version, at) => (
            <VersionBox key={version.promptId} label={version.when ? `Closes when ${String(at + 1)}` : 'Closes otherwise'}>
              {version.when ? (
                <VersionWhen flow={flow} screen={screen} when={version.when} promptId={version.promptId} readOnly={readOnly} edit={edit} />
              ) : (
                <p className="text-[12.5px] font-medium text-[var(--wui-fg-muted)]">Otherwise</p>
              )}
              <Ending
                flow={flow}
                screen={screen}
                edit={edit}
                readOnly={readOnly}
                versionId={version.promptId}
                message={version.endMessage}
                result={version.endValue}
                label={version.when ? `What it says when ${String(at + 1)}` : 'What it says otherwise'}
              />
            </VersionBox>
          ))}
        </VersionList>
      ) : (
        <Ending flow={flow} screen={screen} edit={edit} readOnly={readOnly} message={screen.endMessage} result={screen.endValue} />
      )}
      {!readOnly && (
        <Section>
          <AskDifferently flow={flow} screen={screen} edit={edit} />
        </Section>
      )}
    </>
  );
}

/**
 * The ways a Hand off or a Finish says something, when it has several: each in
 * a box of its own, drawn as `Asking` draws the ways a screen asks.
 */
function VersionList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 px-5 pb-1 pt-4">{children}</div>;
}

function VersionBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-2.5 rounded-[var(--wui-radius)] border border-[var(--wui-border)] p-3">
      {children}
    </section>
  );
}

/** One way a Finish closes: its last word, and what the run reports. */
function Ending({
  flow,
  screen,
  edit,
  readOnly,
  versionId,
  message,
  result,
  label,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
  /** Which way of closing, when the screen has several — and so sits in a box. */
  versionId?: string;
  message: string | undefined;
  result: Record<string, unknown> | undefined;
  /** Each way says its own thing, so its box needs its own name. */
  label?: string;
}) {
  const bare = versionId !== undefined;
  const entries = Object.entries(result ?? {});
  const uid = useId();
  const [picking, setPicking] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const write = (next: Array<[string, unknown]>) => edit((c) => setEndResult(c, screen.id, Object.fromEntries(next), versionId));
  return (
    <>
      <Section bare={bare}>
        <div>
          <FieldLabel htmlFor={`${uid}-bye`} hint="optional">{label ?? 'What the assistant says as it closes'}</FieldLabel>
          <CommitTextarea
            id={`${uid}-bye`}
            value={message ?? ''}
            rows={2}
            disabled={readOnly}
            placeholder="e.g. Glad that helped — I’ll close this here."
            onCommit={(said) => edit((c) => setEndMessage(c, screen.id, said, versionId))}
            onBraces={() => { setPicking(true); }}
            footer={(insert) => (
              <InsertValue flow={flow} screen={screen} insert={insert} open={picking} onOpenChange={setPicking} />
            )}
          />
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
            Left empty, the conversation simply ends without a last word.
          </p>
        </div>
      </Section>
      <Section bare={bare} title="Outcome" hint="what the run reports">
        <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
          Data for whoever runs this flow — a category, a team, a reference — reported when the conversation ends here. The person never
          sees it.
        </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map(([k, v], i) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="w-28 shrink-0 truncate font-mono text-[12px] text-[var(--wui-fg-muted)]">{k}</span>
            <CommitInput
              aria-label={`${k} value`}
              value={String(v ?? '')}
              disabled={readOnly}
              onCommit={(nv) => write(entries.map(([ek, ev], j) => [ek, j === i ? nv : ev]))}
              className="font-mono text-[12.5px]"
            />
            {!readOnly && (
              <IconButton label={`Remove ${k}`} tone="danger" onClick={() => write(entries.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!key.trim()) return;
            write([...entries, [key.trim(), value]]);
            setKey('');
            setValue('');
          }}
        >
          <TextInput aria-label="New result name" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. team" className="w-28 font-mono text-[12.5px]" />
          <TextInput aria-label="New result value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. accounts" className="font-mono text-[12.5px]" />
          <Button type="submit" variant="secondary" disabled={!key.trim()}>Add</Button>
        </form>
      )}
      </Section>
    </>
  );
}

/**
 * Where a screen's typed messages are looked up: the whole flow, a section that
 * keeps them inside it, or — on a screen with others beneath it — a section of
 * its own, created here.
 */
export function TypedRouting({
  flow,
  screen,
  edit,
  readOnly,
}: {
  flow: ConversationalFlow;
  screen: Screen;
  edit: Edit;
  readOnly: boolean;
}) {
  const typed = screen.prompts.find((p) => p.freeText?.kind === 'screen')?.freeText;
  if (typed?.kind !== 'screen') return null;
  const current = typed.screen;
  const choices = routersOf(flow)
    .filter((r) => routingIsValid(flow, screen.id, r.id))
    .map((r) => {
      const scope = scopeOf(flow, r);
      const count = r.router?.candidates.length ?? 0;
      return scope
        ? { id: r.id, label: `${breadcrumb(flow, scope)} and below`, hint: `${String(count)} screens` }
        : { id: r.id, label: 'Any screen', hint: `${String(count)} screens` };
    });

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
        A typed message is read by the AI router, which opens whichever of these screens fits.
      </p>
      <div role="radiogroup" aria-label="Where typed messages are looked up" className="flex flex-col gap-1">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={current === c.id}
            disabled={readOnly}
            onClick={() => {
              if (current !== c.id) edit((config) => setTypedRouter(config, screen.id, c.id));
            }}
            className={cn(
              'flex items-baseline gap-2 rounded-[var(--wui-radius-sm)] border px-2.5 py-2 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              current === c.id
                ? 'border-transparent font-semibold text-[var(--wui-fg)] shadow-[inset_0_0_0_1.5px_var(--wui-primary)]'
                : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <span className="shrink-0 text-[11px] text-[var(--wui-fg-muted)]">{c.hint}</span>
          </button>
        ))}
      </div>

    </>
  );
}

/** Whether this section keeps typed messages inside it — one thing, so one switch. */
export function sectionKeepsTyping(flow: ConversationalFlow, screen: Screen): boolean | undefined {
  if (!flow.screens.some((s) => s.parent === screen.id)) return undefined;
  return routersOf(flow).some((r) => scopeOf(flow, r)?.id === screen.id);
}

/** Where this screen's typed messages are looked up, in a few words. */
export function typedRoutingValue(flow: ConversationalFlow, screen: Screen): string | undefined {
  const typed = screen.prompts.find((p) => p.freeText?.kind === 'screen')?.freeText;
  if (typed?.kind !== 'screen') return undefined;
  const router = routersOf(flow).find((r) => r.id === typed.screen);
  if (!router) return undefined;
  const scope = scopeOf(flow, router);
  return scope ? `${scope.title} and below` : 'any screen';
}

/** Which router serves this screen, said in one line — for the map's card. */
export function servedBy(flow: ConversationalFlow, screen: Screen): string | undefined {
  const router = routerFor(flow, screen.id);
  return router ? routerName(flow, router) : undefined;
}

// ─── Hand off ───

export function HandoffNote({ flow, screen, edit, readOnly }: { flow: ConversationalFlow; screen: Screen; edit: Edit; readOnly: boolean }) {
  const first = screen.prompts[0];
  const to = first?.options ?? [];
  const versions = screen.versions.length > 0 ? screen.versions : first ? [{ promptId: first.id }] : [];
  const several = versions.length > 1;
  // What the customer reads as a person takes over — the same box a Message is
  // written in, so it quotes the same values.
  const says = (prompt: Prompt, label: string) => (
    <Message
      flow={flow}
      screen={screen}
      says={prompt.says}
      onSays={(next) => edit((c) => setPromptSays(c, prompt.id, next))}
      readOnly={readOnly}
      label={label}
      placeholder="e.g. I’m passing you to a person — one moment."
    />
  );
  return (
    <>
      {several ? (
        <VersionList>
          {versions.map((version, at) => {
            const prompt = screen.prompts.find((p) => p.id === version.promptId);
            if (!prompt) return null;
            return (
              <VersionBox key={prompt.id} label={prompt.when ? `Hands off when ${String(at + 1)}` : 'Hands off otherwise'}>
                {prompt.when ? (
                  <VersionWhen flow={flow} screen={screen} when={prompt.when} promptId={prompt.id} readOnly={readOnly} edit={edit} />
                ) : (
                  <p className="text-[12.5px] font-medium text-[var(--wui-fg-muted)]">Otherwise</p>
                )}
                {says(prompt, prompt.when ? `What it says when ${String(at + 1)}` : 'What it says otherwise')}
              </VersionBox>
            );
          })}
        </VersionList>
      ) : (
        first && <Section>{says(first, 'What the assistant says as it hands off')}</Section>
      )}
      {!readOnly && first && (
        <Section>
          <AskDifferently flow={flow} screen={screen} edit={edit} />
        </Section>
      )}
      <Section>
        <p className="text-[13px] leading-relaxed text-[var(--wui-fg)]">
          A person takes the conversation here, in your own system. The Conversation API answers{' '}
          <code className="font-mono text-[12px]">handed_off</code> with everything said so far, and waits. When their call is over, your
          system answers that turn: a Finish closes the conversation, a screen hands it back.
        </p>
      </Section>
      <Section title="Can be sent to" hint={`${to.length} places`}>
        <ul className="flex max-h-56 flex-col overflow-y-auto">
          {to.map((o) => (
            <li key={o.value} className="truncate px-2 py-1 text-[12.5px] text-[var(--wui-fg)]">{o.label}</li>
          ))}
        </ul>
        <p className="text-[12px] text-[var(--wui-fg-muted)]">Every Finish, then every screen — kept up to date as the flow changes.</p>
      </Section>
    </>
  );
}

// ─── The AI router ───

/** Screens the router may open — the same list whichever way it decides. */
function ScreensItCanOpen({ flow, router, onSelect }: { flow: ConversationalFlow; router: Screen['router'] & object; onSelect: (id: string) => void }) {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return (
    <Section title="Can open" hint={`${router.candidates.length} screens`}>
      <ul className="flex flex-col">
        {router.candidates.map((id) => {
          const s = byId.get(id);
          return (
            <li key={id}>
              <button type="button" onClick={() => onSelect(id)} className="flex w-full items-baseline gap-2 rounded-[var(--wui-radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--wui-bg-muted)]">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--wui-fg)]">{s ? breadcrumb(flow, s) : id}</span>
                {!s?.about && <span className="shrink-0 text-[11px]" style={{ color: 'var(--wui-cf-questions)' }}>no description</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
        Each screen’s “AI sends people here when…” is what it reads. Screens without one are described by their place in the menu.
      </p>
    </Section>
  );
}

/** Which service answers, as which model, with which key — and how sure it must be. */
function ClassifierSettings({ screen, edit, readOnly }: { screen: Screen; edit: Edit; readOnly: boolean }) {
  const r = screen.router!;
  const uid = useId();
  const threshold = r.minConfidence;
  return (
    <>
      <Section title="Service" hint="every router in this flow">
        <div>
          <FieldLabel htmlFor={`${uid}-model`}>Model</FieldLabel>
          <CommitInput
            id={`${uid}-model`}
            value={r.model ?? ''}
            disabled={readOnly}
            placeholder="jev-latest"
            onCommit={(model) => edit((c) => setRouterService(c, { model }))}
            className="font-mono text-[12.5px]"
          />
        </div>
        <div>
          <FieldLabel hint="from Credentials">Endpoint & key</FieldLabel>
          <CredentialDropdown
            value={r.credentialName ?? ''}
            readOnly={readOnly}
            ariaLabel="Endpoint & key"
            accepts={['BUILTIN_ENDPOINT_KEY']}
            onChange={(credentialName) => edit((c) => setRouterService(c, { credentialName }))}
          />
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
            The credential holds where the model lives and the key it takes, so pointing this flow at another model is a change there, not here.
            Without one it calls {DEFAULT_CLASSIFIER_ENDPOINT} unauthenticated.
          </p>
        </div>
      </Section>
      <Section title="When it isn’t sure">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px]">
          <span>
            Send them back to the first screen
            <span className="block text-[12px] text-[var(--wui-fg-muted)]">instead of opening the screen it guessed at</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={threshold !== undefined}
            disabled={readOnly}
            onChange={(e) => edit((c) => setRouterService(c, { minConfidence: e.target.checked ? 0.5 : null }))}
            className="h-4 w-4 accent-[var(--wui-primary)]"
          />
        </label>
        {threshold !== undefined && (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={threshold}
              disabled={readOnly}
              aria-label="How sure it must be"
              onChange={(e) => edit((c) => setRouterService(c, { minConfidence: Number(e.target.value) }))}
              className="flex-1 accent-[var(--wui-primary)]"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[12.5px] tabular-nums text-[var(--wui-fg)]">{threshold.toFixed(2)}</span>
          </div>
        )}
      </Section>
    </>
  );
}

export function RouterSettings({ flow, screen, edit, readOnly, onSelect }: { flow: ConversationalFlow; screen: Screen; edit: Edit; readOnly: boolean; onSelect: (id: string) => void }) {
  const r = screen.router!;
  const uid = useId();
  return (
    <>
      <Section>
        <p className="text-[13px] leading-relaxed text-[var(--wui-fg)]">
          {r.mode === 'classifier'
            ? 'When someone types instead of tapping, a classifier model reads the message and picks one of the screens below, with a measure of how sure it was.'
            : r.mode === 'agent'
              ? 'When someone types instead of tapping, this agent reads the message and opens the screen that fits. It can only choose screens listed below, and it says why.'
              : 'When someone types instead of tapping, the first rule whose words appear in the message picks the screen.'}
        </p>
      </Section>
      {!readOnly && (r.mode === 'classifier' || r.mode === 'agent') && (
        <Section title="Decides with">
          <div role="radiogroup" aria-label="How typed text is routed" className="grid grid-cols-2 gap-1.5">
            {([
              ['classifier', 'Classifier model', 'One short call, and it says how sure it was.'],
              ['agent', 'AI agent', 'Reads the screens and says why it chose one.'],
            ] as const).map(([mode, label, hint]) => {
              const on = r.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={hint}
                  onClick={() => {
                    if (!on) {
                      edit((c) =>
                        mode === 'agent'
                          ? setRouterMode(c, screen.id, { mode: 'agent', agentSlug: r.agent ?? '' })
                          : setRouterMode(c, screen.id, { mode: 'classifier', ...(r.model ? { model: r.model } : {}) }),
                      );
                    }
                  }}
                  className={cn(
                    'rounded-[var(--wui-radius-sm)] border px-2.5 py-2 text-left text-[12.5px] transition-colors',
                    on
                      ? 'border-transparent bg-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)] font-semibold text-[var(--wui-fg)] shadow-[inset_0_0_0_1.5px_var(--wui-primary)]'
                      : 'border-[var(--wui-border)] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
            {r.mode === 'classifier'
              ? 'A classifier answers in one short call and can send an unsure message back instead of guessing.'
              : 'An agent costs a model call per message and cannot say how sure it was.'}
          </p>
        </Section>
      )}
      {r.mode === 'classifier' && <ClassifierSettings screen={screen} edit={edit} readOnly={readOnly} />}
      {(r.mode === 'classifier' || r.mode === 'agent') && (
        <ScreensItCanOpen flow={flow} router={r} onSelect={onSelect} />
      )}
      {r.mode === 'classifier' && r.task && (
        <Section>
          <details>
            <summary className="cursor-pointer text-[12.5px] text-[var(--wui-fg-muted)]">The question the model is asked</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--wui-radius)] bg-[var(--wui-bg-subtle)] p-3 font-mono text-[11px] leading-relaxed text-[var(--wui-fg)]">{r.task}</pre>
          </details>
        </Section>
      )}
      {r.mode === 'agent' && (
        <>
          <Section title="Agent">
            <AgentField
              value={r.agent ?? ''}
              readOnly={readOnly}
              onChange={(agent) => edit((c) => setRouterMode(c, screen.id, { mode: 'agent', agentSlug: agent }))}
            />
            <div>
              <FieldLabel htmlFor={`${uid}-g`} hint="optional">Your own guidance</FieldLabel>
              <CommitTextarea
                id={`${uid}-g`}
                value={r.guidance ?? ''}
                rows={3}
                disabled={readOnly}
                placeholder="e.g. Anything about access goes to Account access, never to Billing."
                onCommit={(g) => edit((c) => setRouterGuidance(c, screen.id, g))}
              />
            </div>
          </Section>
          {r.task && (
            <Section>
              <details>
                <summary className="cursor-pointer text-[12.5px] text-[var(--wui-fg-muted)]">The instructions the agent receives</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--wui-radius)] bg-[var(--wui-bg-subtle)] p-3 font-mono text-[11px] leading-relaxed text-[var(--wui-fg)]">{r.task}</pre>
              </details>
            </Section>
          )}
        </>
      )}
    </>
  );
}
