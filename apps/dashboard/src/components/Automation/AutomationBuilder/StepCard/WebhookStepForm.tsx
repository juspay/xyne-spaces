import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import Input from '../../../ui/Input/Input';
import Textarea from '../../../ui/Textarea/Textarea';
import { Button } from '../../../ui/Button/Button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';
import { UseVariableButton } from '../SchemaForm/VariableFieldParts';
import { SchemaJsonEditor, type SchemaTree } from '../SchemaForm/SchemaJsonEditor';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const ENCODING_OPTIONS = [
  { value: 'JSON', label: 'JSON — application/json' },
  { value: 'FORM', label: 'Form — application/x-www-form-urlencoded' },
  { value: 'RAW', label: 'Raw — text/plain (or your Content-Type header)' },
] as const;
type Encoding = (typeof ENCODING_OPTIONS)[number]['value'];

const JSON_BODY_PLACEHOLDER = `{
  "key": "value"
}`;

const AUTH_TYPES = ['none', 'basic', 'bearer'] as const;
type AuthType = (typeof AUTH_TYPES)[number];

const AUTH_LABELS: Record<AuthType, string> = {
  none: 'No authentication',
  basic: 'Basic auth (username + password)',
  bearer: 'Bearer token',
};

interface AuthState {
  type: AuthType;
  username: string;
  password: string;
  token: string;
}

const EMPTY_AUTH: AuthState = { type: 'none', username: '', password: '', token: '' };

function splitAuth(headers: Record<string, string> | null): {
  auth: AuthState;
  rows: Array<[string, string]>;
} {
  const all = headers ? Object.entries(headers) : [];
  const authIdx = all.findIndex(([k]) => k.toLowerCase() === 'authorization');
  if (authIdx === -1) return { auth: EMPTY_AUTH, rows: all };

  const authRow = all[authIdx]!;
  const others = all.filter((_, i) => i !== authIdx);
  const v = authRow[1];

  if (v.startsWith('Basic ')) {
    try {
      const decoded = atob(v.slice(6));
      const idx = decoded.indexOf(':');
      const u = idx === -1 ? decoded : decoded.slice(0, idx);
      const p = idx === -1 ? '' : decoded.slice(idx + 1);
      return { auth: { type: 'basic', username: u, password: p, token: '' }, rows: others };
    } catch {
      return { auth: EMPTY_AUTH, rows: all };
    }
  }
  if (v.startsWith('Bearer ')) {
    return {
      auth: { type: 'bearer', username: '', password: '', token: v.slice(7) },
      rows: others,
    };
  }
  return { auth: EMPTY_AUTH, rows: all };
}

function validateWebhookUrl(raw: string): string | null {
  if (raw.length === 0) return null;
  if (/^\{\{\s*[^{}]+\s*\}\}$/.test(raw.trim())) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'Enter a valid URL.';
  }
  if (parsed.protocol !== 'https:') return 'URL must use HTTPS.';
  const host = parsed.hostname;
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(stripped)) {
    return 'URL must use a domain name, not an IP address.';
  }
  if (stripped.includes(':') && /^[0-9a-fA-F:.]+$/.test(stripped)) {
    return 'URL must use a domain name, not an IP address.';
  }
  return null;
}

function computeAuthHeader(auth: AuthState): string | null {
  if (auth.type === 'basic') {
    if (!auth.username && !auth.password) return null;
    try {
      return `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
    } catch {
      return null;
    }
  }
  if (auth.type === 'bearer') {
    if (!auth.token) return null;
    return `Bearer ${auth.token}`;
  }
  return null;
}

interface WebhookStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
  readOnly?: boolean;
}

export function WebhookStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
  readOnly = false,
}: WebhookStepFormProps): React.ReactElement {
  const responseSchemaRaw = value['responseSchema'];
  const responseSchema: SchemaTree =
    responseSchemaRaw && typeof responseSchemaRaw === 'object' && !Array.isArray(responseSchemaRaw)
      ? (responseSchemaRaw as SchemaTree)
      : {};
  const url = typeof value['url'] === 'string' ? value['url'] : '';
  const methodRaw = value['method'];
  const method: HttpMethod = (HTTP_METHODS as readonly string[]).includes(methodRaw as string)
    ? (methodRaw as HttpMethod)
    : 'POST';
  const encodingRaw = value['encoding'];
  const encoding: Encoding = ENCODING_OPTIONS.some(e => e.value === encodingRaw)
    ? (encodingRaw as Encoding)
    : 'JSON';
  const body = typeof value['body'] === 'string' ? value['body'] : '';
  const headersRaw = value['headers'];
  const headersRecord =
    headersRaw && typeof headersRaw === 'object' && !Array.isArray(headersRaw)
      ? (headersRaw as Record<string, string>)
      : null;
  const timeoutMs = typeof value['timeoutMs'] === 'number' ? value['timeoutMs'] : undefined;

  const [headerRows, setHeaderRows] = useState<Array<[string, string]>>(
    () => splitAuth(headersRecord).rows,
  );
  const [auth, setAuth] = useState<AuthState>(() => splitAuth(headersRecord).auth);
  const [authOpen, setAuthOpen] = useState(auth.type !== 'none');
  const [headersOpen, setHeadersOpen] = useState(headerRows.length > 0);
  const [advancedOpen, setAdvancedOpen] = useState(timeoutMs !== undefined);
  const [showPassword, setShowPassword] = useState(false);

  const commitAll = (rows: Array<[string, string]>, nextAuth: AuthState): void => {
    setHeaderRows(rows);
    setAuth(nextAuth);
    const cleaned = rows.filter(([k]) => k.length > 0);
    const finalHeaders: Record<string, string> = {};
    for (const [k, v] of cleaned) finalHeaders[k] = v;
    const authHeader = computeAuthHeader(nextAuth);
    if (authHeader !== null) finalHeaders['Authorization'] = authHeader;

    const next = { ...value };
    if (Object.keys(finalHeaders).length === 0) delete next['headers'];
    else next['headers'] = finalHeaders;
    onChange(next);
  };
  const commitHeaders = (rows: Array<[string, string]>): void => commitAll(rows, auth);
  const commitAuth = (nextAuth: AuthState): void => commitAll(headerRows, nextAuth);

  const update = (patch: Record<string, unknown>): void => {
    onChange({ ...value, ...patch });
  };

  const fieldIssue = useMemo(
    () =>
      (key: string): ValidationIssue | undefined =>
        issues?.find(
          i => i.path === `${pathPrefix}${key}` || i.path.startsWith(`${pathPrefix}${key}.`),
        ),
    [issues, pathPrefix],
  );

  const showBody = method !== 'GET';

  const urlLocalError = validateWebhookUrl(url);
  const urlBackendIssue = fieldIssue('url');
  const urlErrorMessage = urlLocalError ?? urlBackendIssue?.message;

  return (
    <div className='flex flex-col gap-4'>
      <FieldGroup label='Request' description='Pick an HTTP method and the destination URL.'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-stretch'>
          <div className='w-full sm:w-[120px]'>
            <Select value={method} onValueChange={v => update({ method: v as HttpMethod })}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map(m => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <InlineVarInput
            value={url}
            onChange={next => update({ url: next })}
            sources={variableSources}
            placeholder='https://example.com/webhook'
            mono
            error={!!urlErrorMessage}
          />
        </div>
        {urlErrorMessage ? <FieldError message={urlErrorMessage} /> : null}
      </FieldGroup>

      <Collapsible
        open={authOpen}
        onToggle={() => setAuthOpen(o => !o)}
        title='Authentication'
        subtitle={
          auth.type === 'none'
            ? 'Off — the request is sent unauthenticated.'
            : AUTH_LABELS[auth.type]
        }
        icon={<KeyRound className='size-3.5 text-muted-foreground' aria-hidden='true' />}
      >
        <AuthEditor
          auth={auth}
          onChange={commitAuth}
          showPassword={showPassword}
          onToggleShowPassword={() => setShowPassword(s => !s)}
        />
      </Collapsible>

      <Collapsible
        open={headersOpen}
        onToggle={() => setHeadersOpen(o => !o)}
        title='Custom headers'
        subtitle={
          headerRows.length > 0
            ? `${headerRows.length} header${headerRows.length === 1 ? '' : 's'} set`
            : 'Add X-Signature, X-API-Version, and other request headers.'
        }
      >
        <HeadersEditor rows={headerRows} onChange={commitHeaders} sources={variableSources} />
      </Collapsible>

      <FieldGroup label='Encoding' description='How the body is wrapped before sending.'>
        <Select value={encoding} onValueChange={v => update({ encoding: v as Encoding })}>
          <SelectTrigger className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENCODING_OPTIONS.map(e => (
              <SelectItem key={e.value} value={e.value}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {showBody && (
        <FieldGroup
          label='Body'
          description={
            encoding === 'JSON'
              ? 'JSON payload sent in the request body.'
              : encoding === 'FORM'
                ? 'JSON object — its top-level keys are URL-encoded as form fields.'
                : 'Raw payload sent verbatim with the Content-Type header you supply.'
          }
        >
          <BodyEditor
            value={body}
            onChange={next => update({ body: next })}
            sources={variableSources}
            placeholder={encoding === 'JSON' ? JSON_BODY_PLACEHOLDER : 'Request body…'}
            error={!!fieldIssue('body')}
          />
          {fieldIssue('body') ? <FieldError message={fieldIssue('body')!.message} /> : null}
        </FieldGroup>
      )}

      <FieldGroup
        label='Expected response body'
        description='Declare the JSON shape of the response body so downstream steps can drill into it. This shape becomes responseJson inside the full step output: { status, ok, responseBody, responseJson: <your shape> }. Open the Input / output peek above this form to see the complete output. Leaves are type strings ("string" | "number" | "boolean" | "object" | "array"); nest objects for nested fields.'
      >
        <SchemaJsonEditor
          value={responseSchema}
          onChange={next => {
            const cleaned = { ...value };
            if (Object.keys(next).length === 0) delete cleaned['responseSchema'];
            else cleaned['responseSchema'] = next;
            onChange(cleaned);
          }}
          readOnly={readOnly}
          emptyHint='Empty schema — downstream steps see responseJson as an opaque blob.'
        />
      </FieldGroup>

      <Collapsible
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(o => !o)}
        title='Advanced'
        subtitle={timeoutMs !== undefined ? `Timeout: ${timeoutMs}ms` : 'Request timeout'}
      >
        <FieldGroup
          label='Timeout (ms)'
          description='Abort the request if no response within this many ms. Max 30000.'
        >
          <Input
            type='number'
            min={100}
            max={30000}
            placeholder='10000'
            value={timeoutMs ?? ''}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') {
                const next = { ...value };
                delete next['timeoutMs'];
                onChange(next);
                return;
              }
              const n = Number(raw);
              if (!Number.isNaN(n)) update({ timeoutMs: n });
            }}
          />
        </FieldGroup>
      </Collapsible>
    </div>
  );
}

function FieldGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex flex-col gap-0.5'>
        <span className='text-xs font-medium text-foreground'>{label}</span>
        {description ? (
          <span className='text-[11px] text-muted-foreground'>{description}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function FieldError({ message }: { message: string }): React.ReactElement {
  return <span className='text-[11px] text-red-600'>{message}</span>;
}

function Collapsible({
  open,
  onToggle,
  title,
  subtitle,
  icon,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='rounded-lg border border-border bg-muted/40'>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        data-track-category='automation-builder'
        data-track-name='webhook-collapsible-toggle'
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
          'hover:bg-accent/40',
        )}
      >
        <span className='flex items-center gap-2'>
          {icon}
          <span className='flex flex-col gap-0.5'>
            <span className='text-xs font-medium uppercase tracking-[0.06em] text-foreground'>
              {title}
            </span>
            <span className='text-[11px] text-muted-foreground'>{subtitle}</span>
          </span>
        </span>
        {open ? (
          <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
        ) : (
          <ChevronRight className='size-4 text-muted-foreground' aria-hidden='true' />
        )}
      </button>
      {open ? (
        <div className='border-t border-border bg-background px-3 py-3'>{children}</div>
      ) : null}
    </div>
  );
}

function AuthEditor({
  auth,
  onChange,
  showPassword,
  onToggleShowPassword,
}: {
  auth: AuthState;
  onChange: (next: AuthState) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-3'>
      <FieldGroup
        label='Type'
        description='Adds an Authorization header to the request. Credentials are stored with the automation.'
      >
        <Select value={auth.type} onValueChange={v => onChange({ ...auth, type: v as AuthType })}>
          <SelectTrigger className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map(t => (
              <SelectItem key={t} value={t}>
                {AUTH_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {auth.type === 'basic' && (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <FieldGroup label='Username'>
            <Input
              value={auth.username}
              onChange={e => onChange({ ...auth, username: e.target.value })}
              autoComplete='off'
            />
          </FieldGroup>
          <FieldGroup label='Password'>
            <div className='flex items-center gap-2'>
              <div className='flex-1'>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={auth.password}
                  onChange={e => onChange({ ...auth, password: e.target.value })}
                  autoComplete='off'
                />
              </div>
              <button
                type='button'
                onClick={onToggleShowPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                data-track-category='automation-builder'
                data-track-name='webhook-toggle-password-visibility'
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border',
                  'text-muted-foreground hover:text-foreground hover:bg-accent/40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
                )}
              >
                {showPassword ? (
                  <EyeOff className='size-4' aria-hidden='true' />
                ) : (
                  <Eye className='size-4' aria-hidden='true' />
                )}
              </button>
            </div>
          </FieldGroup>
        </div>
      )}

      {auth.type === 'bearer' && (
        <FieldGroup label='Token' description='Sent as Authorization: Bearer <token>.'>
          <Input
            type={showPassword ? 'text' : 'password'}
            value={auth.token}
            onChange={e => onChange({ ...auth, token: e.target.value })}
            autoComplete='off'
          />
        </FieldGroup>
      )}
    </div>
  );
}

function InlineVarInput({
  value,
  onChange,
  sources,
  placeholder,
  mono,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  sources: VariablePickerSource[];
  placeholder?: string;
  mono?: boolean;
  error?: boolean;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const insertAtCursor = (text: string): void => {
    const el = containerRef.current?.querySelector<HTMLInputElement>('input');
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.length;
      try {
        el.setSelectionRange(cursor, cursor);
      } catch {
        // Some inputs don't support selectionRange — ignore.
      }
    });
  };

  return (
    <div ref={containerRef} className='flex flex-1 items-center gap-2'>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={cn(mono && 'font-mono text-xs')}
      />
      {sources.length > 0 ? <UseVariableButton sources={sources} onPick={insertAtCursor} /> : null}
    </div>
  );
}

function BodyEditor({
  value,
  onChange,
  sources,
  placeholder,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  sources: VariablePickerSource[];
  placeholder?: string;
  error?: boolean;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const insertAtCursor = (text: string): void => {
    const el = containerRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.length;
      try {
        el.setSelectionRange(cursor, cursor);
      } catch {
        // noop
      }
    });
  };

  return (
    <div ref={containerRef} className='flex items-start gap-2'>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={8}
        aria-invalid={error ? true : undefined}
        className='font-mono text-xs leading-relaxed'
      />
      {sources.length > 0 ? <UseVariableButton sources={sources} onPick={insertAtCursor} /> : null}
    </div>
  );
}

function HeadersEditor({
  rows,
  onChange,
  sources,
}: {
  rows: Array<[string, string]>;
  onChange: (next: Array<[string, string]>) => void;
  sources: VariablePickerSource[];
}): React.ReactElement {
  const setKey = (i: number, nextKey: string): void => {
    const copy = rows.slice();
    const current = copy[i];
    if (!current) return;
    copy[i] = [nextKey, current[1]];
    onChange(copy);
  };
  const setVal = (i: number, nextVal: string): void => {
    const copy = rows.slice();
    const current = copy[i];
    if (!current) return;
    copy[i] = [current[0], nextVal];
    onChange(copy);
  };
  const removeAt = (i: number): void => onChange(rows.filter((_, j) => j !== i));
  const addRow = (): void => onChange([...rows, ['', '']]);

  return (
    <div className='flex flex-col gap-2'>
      {rows.length === 0 ? (
        <div className='py-1 text-[11px] italic text-muted-foreground'>No headers set.</div>
      ) : (
        rows.map((row, i) => (
          <div key={i} className='flex items-center gap-2'>
            <Input
              placeholder='Header'
              value={row[0]}
              onChange={e => setKey(i, e.target.value)}
              className='w-[200px] font-mono text-xs'
            />
            <span className='text-muted-foreground' aria-hidden='true'>
              :
            </span>
            <div className='flex-1'>
              <InlineVarInput
                value={row[1]}
                onChange={next => setVal(i, next)}
                sources={sources}
                placeholder='Value'
                mono
              />
            </div>
            <button
              type='button'
              onClick={() => removeAt(i)}
              aria-label={`Remove header ${i + 1}`}
              data-track-category='automation-builder'
              data-track-name='webhook-header-remove'
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
                'hover:text-red-600 hover:bg-red-500/10',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
              )}
            >
              <Trash2 className='size-4' aria-hidden='true' />
            </button>
          </div>
        ))
      )}
      <Button
        variant='outline'
        size='sm'
        onClick={addRow}
        data-track-category='automation-builder'
        data-track-name='ADD_WEBHOOK_ROW'
        className='self-start'
      >
        <Plus className='size-4' />
        Add header
      </Button>
    </div>
  );
}
