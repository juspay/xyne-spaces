/**
 * The request a lookup makes.
 *
 * Laid out the way every tool that does this well lays it out — Postman, n8n,
 * Insomnia: the method and address always on top, because they are the identity
 * of the request, and everything else behind tabs that carry a count. A request
 * with no headers and no body is then one line and nothing else, and a request
 * with eight headers says "8" before you go looking.
 *
 * The step's own config is the record, so nothing is translated or stored twice:
 * these fields write `url`, `method`, `headers`, `queryParams`, `body`,
 * `response`, `credentialName`, `timeoutMs` and `followRedirects` straight onto
 * it. What is ours is the ordering, the words, and that the fields of the answer
 * are read off a sample rather than written as a JSON Schema by hand.
 */
import { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Call } from '@xyne/workflow-sdk/conversational-flow';
import { declaredFields } from '@xyne/workflow-sdk/conversational-flow';
import { CommitInput, FieldLabel } from '../ui.js';
import { CredentialDropdown } from '../../schema-form/CredentialDropdown.js';
import { Section } from './sections.js';
import { cn } from '../../shared/cn.js';

/** The credentials the built-in connector knows how to send. */
const AUTH = ['BUILTIN_BEARER', 'BUILTIN_BASIC', 'BUILTIN_CUSTOM_HEADER', 'BUILTIN_OAUTH2_CLIENT_CREDENTIALS'] as const;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
const RAW_TYPES = ['json', 'xml', 'html', 'text', 'javascript', 'custom'] as const;

/** How the answer is read, and what that means for what you can quote. */
const RESPONSE: Array<{ type: string; label: string; hint: string }> = [
  { type: 'json', label: 'JSON', hint: 'parsed — name the fields below and quote them' },
  { type: 'auto', label: 'Whatever it sends', hint: 'parsed when it says JSON, otherwise text' },
  { type: 'text', label: 'Text', hint: 'the body as one string' },
  { type: 'base64', label: 'Binary', hint: 'base64 of the raw bytes' },
  { type: 'discard', label: 'Nothing', hint: 'only the status matters' },
];

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

type TabId = 'query' | 'auth' | 'headers' | 'body' | 'response' | 'more';

export function RequestEditor({
  call,
  readOnly,
  onChange,
}: {
  call: Call;
  readOnly: boolean;
  /** Replaces the step's whole config — the editor holds all of it. */
  onChange: (request: Rec) => void;
}) {
  const uid = useId();
  const request = call.request as Rec;
  const set = (patch: Rec) => onChange({ ...request, ...patch });
  const body = rec(request['body']);
  const response = rec(request['response']);
  const sends = call.method !== 'GET' && call.method !== 'HEAD';
  const [tab, setTab] = useState<TabId>('query');

  // A request with nothing set is one line; a busy one says where the weight is.
  const tabs: Array<{ id: TabId; label: string; badge?: string }> = [
    { id: 'query', label: 'Query', ...count(Object.keys(rec(request['queryParams'])).length) },
    { id: 'auth', label: 'Auth', ...(request['credentialName'] ? { badge: '1' } : {}) },
    { id: 'headers', label: 'Headers', ...count(Object.keys(rec(request['headers'])).length) },
    ...(sends ? [{ id: 'body' as const, label: 'Body', ...(str(body['mode']) && str(body['mode']) !== 'none' ? { badge: '•' } : {}) }] : []),
    { id: 'response', label: 'Answer', ...count(call.fields.filter((f) => f.path !== '').length) },
    { id: 'more', label: 'More' },
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : 'query';

  return (
    <Section title="The request">
      <div className="flex gap-2">
        <select
          aria-label="Method"
          disabled={readOnly}
          value={call.method}
          onChange={(e) => set({ method: e.target.value })}
          className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 font-mono text-[12px] font-semibold text-[var(--wui-fg)]"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <CommitInput
          aria-label="Address"
          value={call.url}
          disabled={readOnly}
          placeholder="https://api.example.com/orders/{{trigger.context.orderId}}"
          onCommit={(url) => set({ url })}
          className="flex-1 font-mono text-[12px]"
        />
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
        The address may quote anything already known — what started the conversation, and anything fetched further out.
      </p>

      <div role="tablist" aria-label="Request" className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-[var(--wui-border)] px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-1 border-b-2 px-2 pb-1.5 pt-1 text-[12px] transition-colors',
              active === t.id
                ? 'border-[var(--wui-primary)] font-semibold text-[var(--wui-fg)]'
                : 'border-transparent text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]',
            )}
          >
            {t.label}
            {t.badge && (
              <span className="rounded-full bg-[var(--wui-bg-muted)] px-1 text-[10px] font-medium tabular-nums text-[var(--wui-fg-muted)]">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex flex-col gap-2.5 pt-1">
        {active === 'query' && (
          <Pairs
            label="Query"
            value={rec(request['queryParams'])}
            readOnly={readOnly}
            onChange={(queryParams) => set({ queryParams })}
            placeholder={['status', 'open']}
            empty="Appended to the address, so “status=open” becomes ?status=open."
          />
        )}

        {active === 'auth' && (
          <>
            <CredentialDropdown
              value={str(request['credentialName'])}
              readOnly={readOnly}
              ariaLabel="Credential"
              accepts={AUTH}
              onChange={(credentialName) => set(credentialName ? { credentialName } : { credentialName: undefined })}
            />
            <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
              Held in the vault and attached when the call runs, so no key is ever written into the flow. Bearer, Basic, a custom
              header, or OAuth 2.0 client credentials.
            </p>
          </>
        )}

        {active === 'headers' && (
          <Pairs
            label="Headers"
            value={rec(request['headers'])}
            readOnly={readOnly}
            onChange={(headers) => set({ headers })}
            placeholder={['X-Tenant', 'acme']}
            empty="Sent with the request. Authorization comes from the credential, not from here."
          />
        )}

        {active === 'body' && sends && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(['none', 'raw', 'urlencoded', 'formdata'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={(str(body['mode']) || 'none') === mode}
                  onClick={() => set({ body: bodyFor(mode, body) })}
                  className={
                    (str(body['mode']) || 'none') === mode
                      ? 'rounded-full bg-[var(--wui-fg)] px-2.5 py-1 text-[12px] font-medium text-[var(--wui-bg)]'
                      : 'rounded-full border border-[var(--wui-border)] px-2.5 py-1 text-[12px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]'
                  }
                >
                  {mode === 'none' ? 'Nothing' : mode === 'raw' ? 'Raw' : mode === 'urlencoded' ? 'Form fields' : 'Form data'}
                </button>
              ))}
            </div>

            {str(body['mode']) === 'raw' && (
              <>
                <div className="flex items-center gap-2">
                  <FieldLabel htmlFor={`${uid}-ct`}>Sent as</FieldLabel>
                  <select
                    id={`${uid}-ct`}
                    disabled={readOnly}
                    value={str(body['contentType']) || 'json'}
                    onChange={(e) => set({ body: { ...body, contentType: e.target.value } })}
                    className="rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 text-[12px] text-[var(--wui-fg)]"
                  >
                    {RAW_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {str(body['contentType']) === 'custom' && (
                    <CommitInput
                      aria-label="Content type"
                      value={str(body['customContentType'])}
                      disabled={readOnly}
                      placeholder="application/vnd.api+json"
                      onCommit={(customContentType) => set({ body: { ...body, customContentType } })}
                      className="flex-1 font-mono text-[12px]"
                    />
                  )}
                </div>
                <RawBody
                  value={str(body['raw'])}
                  json={(str(body['contentType']) || 'json') === 'json'}
                  readOnly={readOnly}
                  onChange={(raw) => set({ body: { ...body, raw } })}
                />
              </>
            )}

            {(str(body['mode']) === 'urlencoded' || str(body['mode']) === 'formdata') && (
              <FieldRows
                fields={Array.isArray(body['fields']) ? (body['fields'] as Rec[]) : []}
                readOnly={readOnly}
                onChange={(fields) => set({ body: { ...body, fields } })}
              />
            )}
          </>
        )}

        {active === 'response' && (
          <>
            <select
              aria-label="What comes back"
              disabled={readOnly}
              value={str(response['type']) || 'json'}
              onChange={(e) => set({ response: responseFor(e.target.value, response) })}
              className="w-full rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 text-[12.5px] text-[var(--wui-fg)]"
            >
              {RESPONSE.map((r) => (
                <option key={r.type} value={r.type}>{r.label} — {r.hint}</option>
              ))}
            </select>

            {(str(response['type']) === 'json' || str(response['type']) === 'auto' || !response['type']) && (
              <Fields
                call={call}
                readOnly={readOnly}
                onChange={(bodySchema) =>
                  set({ response: { ...response, type: str(response['type']) || 'json', bodySchema } })
                }
              />
            )}
          </>
        )}

        {active === 'more' && (
          <>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor={`${uid}-t`}>Give up after</FieldLabel>
              <CommitInput
                id={`${uid}-t`}
                aria-label="Timeout"
                value={String(typeof request['timeoutMs'] === 'number' ? request['timeoutMs'] : 30_000)}
                disabled={readOnly}
                onCommit={(v) => set({ timeoutMs: Number(v) || 30_000 })}
                className="w-24 text-[12px]"
              />
              <span className="text-[12px] text-[var(--wui-fg-muted)]">ms</span>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px]">
              <span>Follow redirects</span>
              <input
                type="checkbox"
                disabled={readOnly}
                checked={request['followRedirects'] !== false}
                onChange={(e) => set({ followRedirects: e.target.checked })}
                className="h-4 w-4 accent-[var(--wui-primary)]"
              />
            </label>
          </>
        )}
      </div>
    </Section>
  );
}

/** A badge only where there is something to count. */
function count(n: number): { badge?: string } {
  return n > 0 ? { badge: String(n) } : {};
}

/**
 * Key/value rows — headers and query parameters are the same shape.
 *
 * There is always a blank row waiting at the end, so adding one is typing in it
 * rather than pressing a button and then typing. Nothing is ever pre-filled with
 * an example: a row you didn't write is a row you have to notice and delete.
 */
function Pairs({
  label,
  value,
  readOnly,
  onChange,
  placeholder,
  empty,
}: {
  label: string;
  value: Rec;
  readOnly: boolean;
  onChange: (next: Rec) => void;
  placeholder: [string, string];
  /** One line saying what these are for, while there are none. */
  empty: string;
}) {
  const saved = Object.entries(value).map(([k, v]) => [k, String(v)] as [string, string]);
  const [rows, setRows] = useState<Array<[string, string]>>(saved);
  useEffect(() => {
    setRows(Object.entries(value).map(([k, v]) => [k, String(v)] as [string, string]));
    // Only when the lookup itself changes: re-seeding on every keystroke would
    // fight whatever is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.keys(value))]);

  /** Keep exactly one blank row at the end, and save the rest. */
  const write = (next: Array<[string, string]>) => {
    const filled = next.filter(([k, v]) => k.trim() !== '' || v.trim() !== '');
    setRows([...filled, ['', '']]);
    onChange(Object.fromEntries(filled.filter(([k]) => k.trim() !== '')));
  };
  const shown = rows.length > 0 && rows[rows.length - 1]![0] === '' && rows[rows.length - 1]![1] === '' ? rows : [...rows, ['', ''] as [string, string]];

  return (
    <div>
      {saved.length === 0 && <p className="mb-1.5 text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">{empty}</p>}
      <div className="flex flex-col gap-1">
        {shown.map(([k, v], at) => (
          <div key={at} className="group/row flex items-center gap-1.5">
            <input
              aria-label={`${label} name`}
              value={k}
              disabled={readOnly}
              placeholder={at === shown.length - 1 ? placeholder[0] : ''}
              onChange={(e) => setRows(shown.map((r, i) => (i === at ? [e.target.value, r[1]] : r)))}
              onBlur={() => write(shown)}
              className="w-1/3 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
            />
            <input
              aria-label={`${label} value`}
              value={v}
              disabled={readOnly}
              placeholder={at === shown.length - 1 ? placeholder[1] : ''}
              onChange={(e) => setRows(shown.map((r, i) => (i === at ? [r[0], e.target.value] : r)))}
              onBlur={() => write(shown)}
              className="flex-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
            />
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${label.toLowerCase()} ${k || 'row'}`}
                onClick={() => write(shown.filter((_, i) => i !== at))}
                className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] opacity-0 transition-opacity hover:text-[var(--wui-status-failed)] group-hover/row:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A raw body. When it is meant to be JSON it is treated as JSON: tidied on
 * request, and told plainly when it doesn't parse — rather than discovering it
 * from a failed run. A `{{…}}` inside a string is ordinary JSON, so templates
 * stay valid and the check stays useful.
 */
function RawBody({
  value,
  json,
  readOnly,
  onChange,
}: {
  value: string;
  json: boolean;
  readOnly: boolean;
  onChange: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const problem = json && draft.trim() !== '' ? parseProblem(draft) : null;
  const tidy = () => {
    try {
      const next = JSON.stringify(JSON.parse(draft), null, 2);
      setDraft(next);
      onChange(next);
    } catch {
      /* the message below already says it doesn't parse */
    }
  };

  return (
    <>
      <textarea
        aria-label="Body"
        rows={6}
        disabled={readOnly}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onChange(draft)}
        spellCheck={false}
        placeholder={json ? '{\n  "orderId": "{{trigger.context.orderId}}"\n}' : ''}
        className="w-full resize-y rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
        style={problem ? { borderColor: 'var(--wui-status-failed)' } : undefined}
      />
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11.5px] text-[var(--wui-status-failed)]">{problem ?? ''}</p>
        {json && !readOnly && draft.trim() !== '' && (
          <button type="button" onClick={tidy} className="shrink-0 text-[11.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]">
            Tidy
          </button>
        )}
      </div>
    </>
  );
}

/** What is wrong with it, in one line, or nothing. */
function parseProblem(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const said = e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'it cannot be read';
    return `Not valid JSON — ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
  }
}

/** Form fields, which carry an enabled flag the record shape can't. */
function FieldRows({
  fields,
  readOnly,
  onChange,
}: {
  fields: Rec[];
  readOnly: boolean;
  onChange: (next: Rec[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {fields.map((field, at) => (
        <div key={at} className="flex items-center gap-1.5">
          <CommitInput
            aria-label="Field name"
            value={str(field['key'])}
            disabled={readOnly}
            onCommit={(key) => onChange(fields.map((f, i) => (i === at ? { ...f, key } : f)))}
            className="w-1/3 font-mono text-[11.5px]"
          />
          <CommitInput
            aria-label="Field value"
            value={str(field['value'])}
            disabled={readOnly}
            onCommit={(value) => onChange(fields.map((f, i) => (i === at ? { ...f, value } : f)))}
            className="flex-1 font-mono text-[11.5px]"
          />
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove field ${str(field['key'])}`}
              onClick={() => onChange(fields.filter((_, i) => i !== at))}
              className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] hover:text-[var(--wui-status-failed)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...fields, { key: '', value: '', enabled: true }])}
          className="self-start text-[12px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
        >
          <Plus className="inline h-3 w-3" /> Add field
        </button>
      )}
    </div>
  );
}

/**
 * The fields of the answer worth quoting.
 *
 * The step wants a JSON Schema. Writing one by hand to describe a response you
 * already have is the worst kind of chore, so the shortcut is the main path:
 * paste what the call returns and the fields are read off it. They stay editable
 * afterwards — the sample is a way to fill the list, not a thing to maintain.
 *
 * Naming a field here is also what makes it offerable while writing a screen, so
 * this list and the value picker are the same list.
 */
function Fields({ call, readOnly, onChange }: { call: Call; readOnly: boolean; onChange: (bodySchema: Rec) => void }) {
  const named = call.fields.map((f) => f.path).filter((p) => p !== '');
  const [paths, setPaths] = useState<string[]>(named);
  const [sample, setSample] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setPaths(call.fields.map((f) => f.path).filter((p) => p !== ''));
  }, [call.id]);

  /** What is already known about the answer's shape. */
  const current = rec(rec(call.request['response'])['bodySchema']);

  const write = (next: string[]) => {
    setPaths(next);
    onChange(schemaFor(next, (path) => nodeAt(current, path) ?? {}));
  };

  const read = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setProblem('That isn’t JSON — paste the response exactly as it comes back.');
      return;
    }
    const sampled = schemaFromSample(parsed);
    // The same walk the engine uses to decide what is quotable, so this list and
    // the value picker can never disagree about it.
    const found = declaredFields(sampled)
      .map((f) => f.path)
      .filter((path) => path !== '');
    if (found.length === 0) {
      setProblem('Nothing to name in that — it has no fields.');
      return;
    }
    setProblem(null);
    setSample(null);
    const next = [...new Set([...paths.filter((p) => p.trim() !== ''), ...found])];
    setPaths(next);
    // The sample is the better authority on shape; anything it did not mention
    // keeps whatever was known before.
    onChange(
      schemaFor(next, (path) => nodeAt(sampled, path) ?? nodeAt(current, path) ?? {}),
    );
  };

  return (
    <div>
      <FieldLabel hint="what you can quote">Fields you’ll use</FieldLabel>

      {sample !== null ? (
        <div className="flex flex-col gap-2 rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] p-2">
          <textarea
            aria-label="A sample response"
            autoFocus
            rows={6}
            value={sample}
            spellCheck={false}
            onChange={(e) => setSample(e.target.value)}
            placeholder={'{\n  "status": "shipped",\n  "address": { "city": "Bengaluru" }\n}'}
            className="w-full resize-y rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
          />
          {problem !== null && <p className="text-[11.5px] text-[var(--wui-status-failed)]">{problem}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => read(sample)}
              disabled={sample.trim() === ''}
              className="rounded-[var(--wui-radius-sm)] bg-[var(--wui-primary)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--wui-primary-fg,#fff)] disabled:opacity-50"
            >
              Read the fields
            </button>
            <button
              type="button"
              onClick={() => {
                setSample(null);
                setProblem(null);
              }}
              className="px-2 py-1 text-[12.5px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {paths.map((path, at) => (
            <div key={at} className="group/field flex items-center gap-1.5">
              <code className="shrink-0 font-mono text-[11px] text-[var(--wui-fg-muted)]">body.</code>
              <input
                aria-label="Field path"
                value={path}
                disabled={readOnly}
                placeholder="address.city"
                onChange={(e) => setPaths(paths.map((p, i) => (i === at ? e.target.value : p)))}
                onBlur={() => write(paths)}
                className="flex-1 rounded-[var(--wui-radius-sm)] border border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1 font-mono text-[11.5px] text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-muted)]"
              />
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove field ${path}`}
                  onClick={() => write(paths.filter((_, i) => i !== at))}
                  className="shrink-0 rounded p-1 text-[var(--wui-fg-muted)] opacity-0 transition-opacity hover:text-[var(--wui-status-failed)] group-hover/field:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSample('')}
                className="text-[12px] font-medium text-[var(--wui-primary)] hover:underline"
              >
                Paste a sample response
              </button>
              <button
                type="button"
                onClick={() => setPaths([...paths, ''])}
                className="text-[12px] text-[var(--wui-fg-muted)] hover:text-[var(--wui-fg)]"
              >
                <Plus className="inline h-3 w-3" /> or name one
              </button>
            </div>
          )}
          {paths.length === 0 && (
            <p className="text-[12px] leading-relaxed text-[var(--wui-fg-muted)]">
              None named, so the whole answer is one value. Paste what the call returns and each field becomes its own.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A pasted sample, as the JSON Schema the step reads its answer back from.
 *
 * This used to collect dotted paths and rebuild a schema from the strings,
 * which structurally could not describe two things:
 *
 *   - **a list of objects.** The walk stopped at an array, so `fareBreakup`
 *     became one opaque leaf and nothing inside it was nameable — which is why
 *     a fare breakdown could not be totalled or listed.
 *   - **types.** Every leaf was written out as `{ type: 'string' }`, so no
 *     lookup field has ever had a real type, and nothing could be checked
 *     against one.
 *
 * Both matter now that an expression can read these fields: a list needs `items`
 * for its element fields to be offerable, and `$sum` needs to know it is adding
 * numbers.
 *
 * The first element describes the whole list. A response whose elements differ
 * in shape is not describable this way, and a union is not something the field
 * list can express — so the first one is the honest read.
 */
export function schemaFromSample(value: unknown, depth = 0): Rec {
  if (depth > 8) return {};
  if (Array.isArray(value)) {
    return value.length > 0
      ? { type: 'array', items: schemaFromSample(value[0], depth + 1) }
      : { type: 'array' };
  }
  if (value === null) return {};
  if (typeof value === 'object') {
    const properties: Rec = {};
    for (const [key, inner] of Object.entries(value as Rec)) {
      properties[key] = schemaFromSample(inner, depth + 1);
    }
    return { type: 'object', properties };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'string' };
}

/** The node a dotted path names, stepping through lists on the way. */
export function nodeAt(schema: Rec, path: string): Rec | undefined {
  let node: Rec | undefined = schema;
  for (const part of path.split('.')) {
    for (let i = 0; node?.['type'] === 'array' && i < 10; i++) node = rec(node['items']);
    const properties = rec(node?.['properties']);
    node = properties[part] as Rec | undefined;
    if (!node) return undefined;
  }
  return node;
}

// ─── Writing the step's own shapes ───

/** A body of the chosen mode, keeping whatever the old one can still carry. */
function bodyFor(mode: string, was: Rec): Rec {
  if (mode === 'none') return { mode };
  if (mode === 'raw') return { mode, raw: str(was['raw']), contentType: str(was['contentType']) || 'json' };
  return { mode, fields: Array.isArray(was['fields']) ? was['fields'] : [] };
}

/** `bodySchema` only belongs on the modes that parse; the rest must not carry it. */
function responseFor(type: string, was: Rec): Rec {
  if (type !== 'json' && type !== 'auto') return { type };
  return { type, ...(was['bodySchema'] ? { bodySchema: was['bodySchema'] } : {}) };
}

/**
 * Paths an author named → the JSON Schema the step reads them back from.
 *
 * `shapeOf` supplies what is already known about each field — its type, and for
 * a list the shape of its items. Without it, rebuilding the schema from the
 * path list every time the author renames something would flatten whatever the
 * sample taught, which is the other half of why arrays never survived.
 *
 * A field nothing knows about becomes `{}` — genuinely unknown, which every
 * check treats as a wildcard. Not `{ type: 'string' }`: claiming a type nobody
 * verified is what made `$sum` of a number field look like a text error.
 */
export function schemaFor(paths: string[], shapeOf: (path: string) => Rec): Rec {
  const root: Rec = { type: 'object', properties: {} };
  for (const path of paths.filter((p) => p.trim() !== '')) {
    let node = root;
    const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
    parts.forEach((part, at) => {
      const properties = rec(node['properties']);
      node['properties'] = properties;
      if (at === parts.length - 1) {
        properties[part] = shapeOf(path);
      } else {
        const next = rec(properties[part]);
        next['type'] = 'object';
        properties[part] = next;
        node = next;
      }
    });
  }
  return root;
}
