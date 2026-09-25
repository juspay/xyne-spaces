import type { VariablePickerSource } from '../../Automation/AutomationBuilder/VariablePicker/VariablePicker.types';
import type {
  AppFetchConfig,
  AppFetchFormValue,
  AppFetchResponseMapping,
} from './AppFetchSection.types';

export const FETCH_METHODS = ['POST', 'GET'] as const;

/** Mirrors AppFetchConfigSchema's defaults, so a fresh form matches the server. */
export const DEFAULT_RESPONSE_MAPPING: AppFetchResponseMapping = {
  messagesPath: '',
  nextCursorPath: 'nextCursor',
  fields: {
    externalId: 'externalId',
    externalThreadId: 'externalThreadId',
    subject: 'subject',
    body: 'body',
    senderEmail: 'sender.email',
    senderName: 'sender.name',
    recipients: 'recipients',
    sentAt: 'sentAt',
  },
  idFields: [],
};

export const EMPTY_FETCH_FORM: AppFetchFormValue = {
  url: '',
  method: 'POST',
  encoding: 'JSON',
  timeoutMs: 30_000,
  pagination: 'cursor',
  pageSize: 50,
  response: DEFAULT_RESPONSE_MAPPING,
};

/** Field rows shown in the mapping editor, in the order an author fills them. */
export const MAPPED_FIELDS: readonly {
  key: keyof AppFetchResponseMapping['fields'];
  label: string;
  required?: boolean;
}[] = [
  { key: 'externalId', label: 'Message id', required: true },
  { key: 'sentAt', label: 'Sent at', required: true },
  { key: 'externalThreadId', label: 'Thread id' },
  { key: 'subject', label: 'Subject' },
  { key: 'body', label: 'Body' },
  { key: 'senderName', label: 'Sender name' },
  { key: 'senderEmail', label: 'Sender email' },
  { key: 'recipients', label: 'Recipients' },
];

/** The form value is untyped; these read one field back with a safe default. */
export function readPagination(value: AppFetchFormValue): 'cursor' | 'offset' {
  return value['pagination'] === 'offset' ? 'offset' : 'cursor';
}

export function readNumber(value: AppFetchFormValue, key: string, fallback: number): number {
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

export function readMapping(value: AppFetchFormValue): AppFetchResponseMapping {
  const raw = value['response'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_RESPONSE_MAPPING;
  const m = raw as Partial<AppFetchResponseMapping>;
  return {
    messagesPath: typeof m.messagesPath === 'string' ? m.messagesPath : '',
    nextCursorPath: typeof m.nextCursorPath === 'string' ? m.nextCursorPath : 'nextCursor',
    fields: { ...DEFAULT_RESPONSE_MAPPING.fields, ...(m.fields ?? {}) },
    idFields: Array.isArray(m.idFields) ? m.idFields.filter(x => typeof x === 'string') : [],
  };
}

/**
 * What the `(x)` picker offers. `role: 'trigger'` makes buildReference emit
 * `{{sourceKey.path}}` — so `fetch` + `startDate` becomes `{{fetch.startDate}}`,
 * which is exactly the reference the backend resolves.
 *
 * Pagination-dependent by design: `cursor` is always empty under offset
 * pagination and `offset`/`limit` are always zero under cursor pagination, so
 * offering the wrong one is offering a variable that silently renders nothing.
 */
export function buildFetchVariableSources(pagination: 'cursor' | 'offset'): VariablePickerSource[] {
  const fetchProperties: VariablePickerSource['schema']['properties'] =
    pagination === 'offset'
      ? {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        }
      : {
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          cursor: { type: 'string' },
        };

  return [
    {
      sourceKey: 'fetch',
      role: 'trigger',
      groupKey: 'trigger',
      label: 'Fetch window',
      groupLabel: 'Fetch',
      schema: { type: 'object', properties: fetchProperties },
    },
    {
      sourceKey: 'channel',
      role: 'trigger',
      label: 'Desk channel',
      groupKey: 'channel',
      groupLabel: 'Channel',
      schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
    },
    {
      sourceKey: 'source',
      role: 'trigger',
      label: 'App connection',
      groupKey: 'source',
      groupLabel: 'Connection',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
    },
    {
      sourceKey: 'installedApp',
      role: 'trigger',
      label: 'Install',
      groupKey: 'installedApp',
      groupLabel: 'Install',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
    },
    {
      sourceKey: 'app',
      role: 'trigger',
      label: 'App',
      groupKey: 'app',
      groupLabel: 'App',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
    },
    {
      sourceKey: 'workspace',
      role: 'trigger',
      label: 'Workspace',
      groupKey: 'workspace',
      groupLabel: 'Workspace',
      schema: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ];
}

export function configToFormValue(config: AppFetchConfig | null): AppFetchFormValue {
  return config ? ({ ...config } as AppFetchFormValue) : { ...EMPTY_FETCH_FORM };
}

/** The form's URL, which is untyped in the shared step-form value. */
function readUrl(value: AppFetchFormValue): string {
  const raw = value['url'];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** A form with no URL is the "no configuration" state — saving it removes the config. */
export function isBlankForm(value: AppFetchFormValue): boolean {
  return readUrl(value).length === 0;
}

/**
 * Client-side gate only: enough to disable Save on an obviously unusable config.
 * The server re-validates against the real schema, so this stays deliberately
 * thin rather than duplicating it.
 */
export function formError(value: AppFetchFormValue): string | null {
  const url = readUrl(value);
  if (!url) return 'A fetch URL is required';
  // A URL that is entirely a reference is resolved at send time, so it cannot be
  // parsed here — the same allowance the automations webhook form makes.
  if (url.startsWith('{{')) return null;
  try {
    new URL(url);
  } catch {
    return 'Must be a valid absolute URL, including the scheme';
  }
  return null;
}

/** One line summarising a test run, for the status strip above the result. */
export function describeTestStage(stage: 'transport' | 'response' | 'contract'): string {
  switch (stage) {
    case 'transport':
      return 'Could not reach the app';
    case 'response':
      return 'The app returned an error';
    case 'contract':
      return 'The app responded, but not in the expected shape';
  }
}

/**
 * Pull the per-field messages out of a rejected save.
 *
 * The API answers a bad config with `{ error, code, issues: [{ path, message }] }`.
 * Axios surfaces that under `response.data` (or `responseData`, depending on the
 * client wrapper), so both are checked rather than assuming one.
 */
export function readValidationIssues(err: unknown): string[] {
  const e = err as {
    responseData?: { issues?: unknown };
    response?: { data?: { issues?: unknown } };
  };
  const raw = e?.responseData?.issues ?? e?.response?.data?.issues;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(i => {
      const issue = i as { path?: unknown; message?: unknown };
      const message = typeof issue.message === 'string' ? issue.message : null;
      if (!message) return null;
      const path = typeof issue.path === 'string' && issue.path ? `${issue.path}: ` : '';
      return `${path}${message}`;
    })
    .filter((x): x is string => x !== null);
}
