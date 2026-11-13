/**
 * Something the conversation fetches, and what can be done with it.
 *
 * The panel says three things, in the order an author needs them: where it goes,
 * what to do when it can't be reached, and how to quote what it found. The last
 * is the point of the whole thing — a lookup nobody quotes is a call for
 * nothing — so the references are one click from here.
 */
import { useId, useState } from 'react';
import { Copy, Database, Trash2 } from 'lucide-react';
import {
  ancestorsOf,
  breadcrumb,
  callRef,
  moveCall,
  quotedIn,
  removeCall,
  setCall,
  setCallFallback,
  type Call,
  type ConversationalFlow,
  type Screen,
} from '@xyne/workflow-sdk/conversational-flow';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { Button, FieldLabel } from '../ui.js';
import { RequestEditor } from './RequestEditor.js';
import { Section } from './sections.js';
import { PanelShell } from './PanelShell.js';

/** Applies an edit, or shows why it was refused. Returns whether it went through. */
export type Edit = (change: (config: WorkflowConfig) => WorkflowConfig) => boolean;

/** When a lookup runs, said the way an author thinks about it. */
const WHEN: Record<Call['scope'], string> = {
  conversation: 'Once, before the conversation starts.',
  section: 'On the way into this section, and again each time someone comes back to it.',
  screen: 'Every time this screen opens.',
};

export function CallPanel({
  flow,
  call,
  owner,
  edit,
  readOnly,
  onSelect,
  onClose,
}: {
  flow: ConversationalFlow;
  call: Call;
  owner: Screen;
  edit: Edit;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const [copied, setCopied] = useState<string | null>(null);
  const request = call.request;

  const where = breadcrumb(flow, owner) || owner.title;
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const trail = [...ancestorsOf(flow, owner.id), owner.id]
    .map((id) => byId.get(id))
    .filter((s): s is Screen => s !== undefined)
    .map((s) => ({ id: s.id, title: s.title }));
  const quoting = quotedIn(flow, call.id);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
  };

  return (
    <PanelShell
      label={`Lookup: ${call.title}`}
      trail={trail}
      trailFallback="Runs before the conversation starts"
      title={call.title}
      titleLabel="Lookup name"
      onRename={(title) => edit((config) => setCall(config, call.id, { title, request }))}
      badge={
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: 'color-mix(in srgb, var(--wui-cf-data, var(--wui-primary)) 14%, transparent)',
            color: 'var(--wui-cf-data, var(--wui-primary))',
          }}
        >
          <Database className="h-3 w-3" aria-hidden /> Lookup
        </span>
      }
      id={call.id}
      readOnly={readOnly}
      onSelect={onSelect}
      onClose={onClose}
    >
        <Section title="Runs before">
          <select
            aria-label="Runs before"
            disabled={readOnly}
            value={owner.id}
            onChange={(e) => edit((config) => moveCall(config, call.id, e.target.value))}
            className="w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 text-[12.5px] text-[var(--wui-fg)]"
          >
            {flow.screens
              .filter((s) => s.kind !== 'router')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {breadcrumb(flow, s) || s.title}
                  {s.children.length > 0 ? ' — and everything inside it' : ''}
                </option>
              ))}
          </select>
          <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">{WHEN[call.scope]}</p>
        </Section>

        <RequestEditor call={call} readOnly={readOnly} onChange={(request) => edit((config) => setCall(config, call.id, { title: call.title, request }))} />

        <Section title="If it can’t be reached">
          {call.scope === 'conversation' ? (
            <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
              This runs before the conversation starts, so there is nowhere to send anyone. It fails the run.
            </p>
          ) : (
            <>
              <FieldLabel htmlFor={`${uid}-fail`}>Open this screen instead</FieldLabel>
              <select
                id={`${uid}-fail`}
                disabled={readOnly}
                value={call.onFail ?? ''}
                onChange={(e) => edit((config) => setCallFallback(config, call.id, e.target.value || null))}
                className="w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 text-[12.5px] text-[var(--wui-fg)]"
              >
                <option value="">Nothing — the conversation fails</option>
                {flow.screens
                  .filter((s) => s.kind !== 'router')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {breadcrumb(flow, s) || s.title}
                    </option>
                  ))}
              </select>
            </>
          )}
        </Section>

        <Section title="What you can use" hint={call.fields.length > 0 ? `${String(call.fields.length)} fields` : undefined}>
          <p className="text-[12.5px] leading-relaxed text-[var(--wui-fg-muted)]">
            Anywhere on {where} and the screens inside it — what a screen says, what an option is called, what a Finish reports.
          </p>
          <ul className="flex flex-col gap-1">
            {(call.fields.length > 0 ? call.fields : [{ path: '', type: undefined }]).map((field) => {
              const ref = callRef(call.id, field.path ? `body.${field.path}` : 'body');
              return (
                <li key={ref} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[var(--wui-radius-sm)] bg-[var(--wui-bg-subtle)] px-2 py-1 font-mono text-[11px] text-[var(--wui-fg)]">
                    {ref}
                  </code>
                  <button
                    type="button"
                    aria-label={`Copy ${ref}`}
                    onClick={() => copy(ref)}
                    className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] hover:bg-[var(--wui-bg-muted)] hover:text-[var(--wui-fg)]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          {copied !== null && <p className="text-[11.5px] text-[var(--wui-fg-muted)]">Copied. Paste it into what a screen says.</p>}
        </Section>

        {quoting.length > 0 && (
          <Section title="Quoted in">
            <ul className="flex flex-col gap-0.5">
              {quoting.map((what) => (
                <li key={what} className="text-[12.5px] text-[var(--wui-fg)]">
                  {what}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {!readOnly && (
          <Section>
            <Button
              variant="danger"
              className="self-start"
              onClick={() => {
                if (edit((config) => removeCall(config, call.id))) onSelect(owner.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove lookup
            </Button>
          </Section>
        )}
    </PanelShell>
  );
}
