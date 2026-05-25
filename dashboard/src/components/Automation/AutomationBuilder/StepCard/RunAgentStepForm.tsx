import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Wand2 } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonLanguage } from '@codemirror/lang-json';
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Button } from '../../../ui/Button/Button';
import { Combobox } from '../../../ui/Combobox/Combobox';
import { AutomationRichTextField } from '../SchemaForm/AutomationRichTextField';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';
import { fetchClawAgents } from '../../../../api/automationsApi';
const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

// A node in the output-schema tree: either a leaf type or a nested object.
type SchemaNode = FieldType | { [k: string]: SchemaNode };
type SchemaTree = Record<string, SchemaNode>;

interface RunAgentConfigShape {
  agentSlug?: string;
  prompt?: string;
  outputSchema?: SchemaTree;
}

const DEFAULT_SCHEMA: SchemaTree = {
  category: 'string',
  summary: 'string',
};

interface RunAgentStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
  readOnly?: boolean;
}

export function RunAgentStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
  readOnly = false,
}: RunAgentStepFormProps): React.ReactElement {
  const cfg = value as RunAgentConfigShape;
  const [agentSearch, setAgentSearch] = useState('');

  const {
    data: agents,
    isLoading: agentsLoading,
    isError: agentsError,
    refetch,
  } = useQuery({
    queryKey: ['claw-agents'],
    queryFn: fetchClawAgents,
    staleTime: 0,
  });

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`)) {
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
      }
    }
    return map;
  }, [issues, pathPrefix]);

  const outputSchema = cfg.outputSchema ?? {};

  // Combobox items filtered by the search box. Match against name + slug +
  // description so the user can find an agent by any of them.
  const agentItems = useMemo(() => {
    const all = agents ?? [];
    const q = agentSearch.trim().toLowerCase();
    const matched = !q
      ? all
      : all.filter(
          a =>
            a.name.toLowerCase().includes(q) ||
            a.slug.toLowerCase().includes(q) ||
            (a.description ?? '').toLowerCase().includes(q),
        );
    return matched.map(a => ({
      value: a.slug,
      label: a.name,
      description: a.slug,
      leftSlot: <Sparkles className='size-3.5' style={{ color: a.color }} />,
    }));
  }, [agents, agentSearch]);

  const selectedAgentItem = useMemo(() => {
    if (!cfg.agentSlug) return null;
    const a = (agents ?? []).find(x => x.slug === cfg.agentSlug);
    if (!a) {
      return {
        value: cfg.agentSlug,
        label: cfg.agentSlug,
        description: 'no longer available',
      };
    }
    return {
      value: a.slug,
      label: a.name,
      description: a.slug,
      leftSlot: <Sparkles className='size-3.5' style={{ color: a.color }} />,
    };
  }, [agents, cfg.agentSlug]);

  const setField = <K extends keyof RunAgentConfigShape>(
    key: K,
    next: RunAgentConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
      {/* Agent picker — searchable combobox so a workspace with many agents
          stays usable. Type to filter by name / slug / description. */}
      <FieldRow label='Agent' error={issuesAt.get('agentSlug')} required>
        {agentsLoading ? (
          <div className='text-xs text-muted-foreground'>Loading agents…</div>
        ) : agentsError ? (
          <div className='flex items-center gap-2 text-xs text-red-600'>
            <span>Couldn&apos;t reach claw — agents unavailable.</span>
            <button
              type='button'
              data-track-category='automation-builder'
              data-track-name='run-agent-step-agents-retry'
              onClick={() => {
                void refetch();
              }}
              className='underline hover:no-underline'
            >
              Retry
            </button>
          </div>
        ) : (
          <Combobox
            placeholder='Search agents by name or slug…'
            queryString={agentSearch}
            onInputValueChange={setAgentSearch}
            items={agentItems}
            value={selectedAgentItem}
            onValueChange={v => setField('agentSlug', v ?? '')}
            autoHighlight
            {...((agents ?? []).length === 0
              ? { hintText: 'No agents available in claw catalog.' }
              : {})}
          />
        )}
      </FieldRow>

      {/* Prompt — rich text field renders variable refs as inline chips
          (e.g. "Step 1 / output / category") instead of raw {{...}}. */}
      <FieldRow
        label='Prompt'
        error={issuesAt.get('prompt')}
        required
        description='What you want the agent to do. Use the Variable button in the toolbar to insert references from earlier steps.'
      >
        <AutomationRichTextField
          value={cfg.prompt ?? ''}
          onChange={next => setField('prompt', next)}
          variableSources={variableSources}
          placeholder='Summarize this ticket and classify its urgency…'
        />
      </FieldRow>

      {/* Output schema — JSON editor with nesting support */}
      <FieldRow
        label='Expected output'
        description='JSON shape the agent will return. Leaves are type strings ("string" | "number" | "boolean" | "object" | "array"); use a nested object for nested fields. Downstream steps see top-level keys as variables before this step runs.'
        error={issuesAt.get('outputSchema')}
      >
        <SchemaJsonEditor
          value={outputSchema}
          onChange={next => setField('outputSchema', next)}
          readOnly={readOnly}
        />
      </FieldRow>
    </div>
  );
}

function SchemaJsonEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: SchemaTree;
  onChange: (next: SchemaTree) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState(() => stringify(value));
  const [error, setError] = useState<string | null>(null);

  // Reflect external value changes back into the draft (e.g. user navigates
  // between steps and the parent re-mounts with a different value), but
  // never clobber a mid-edit local string when canonical content matches.
  useEffect(() => {
    const incoming = stringify(value);
    setDraft(prev => (canonical(prev) === canonical(incoming) ? prev : incoming));
  }, [value]);

  const handleChange = (next: string): void => {
    setDraft(next);
    const parsed = tryParseSchema(next);
    if (parsed.ok) {
      setError(null);
      onChange(parsed.value);
    } else {
      setError(parsed.error);
    }
  };

  const insertExample = (): void => {
    const text = stringify(DEFAULT_SCHEMA);
    setDraft(text);
    setError(null);
    onChange(DEFAULT_SCHEMA);
  };

  const isEmpty = Object.keys(value).length === 0;

  return (
    <div className='flex flex-col gap-2'>
      <div
        className={
          error
            ? 'overflow-hidden rounded-md border border-red-500/50'
            : 'overflow-hidden rounded-md border border-border'
        }
      >
        <CodeMirror
          value={draft}
          height='auto'
          minHeight='120px'
          maxHeight='480px'
          editable={!readOnly}
          extensions={[
            json(),
            // Type autocomplete: when the cursor is positioned to type a
            // value (`"category": "<here>"` or `"category": <here>`), we
            // surface the FIELD_TYPES literals so users don't need to
            // remember the exact strings.
            jsonLanguage.data.of({ autocomplete: typeAutocomplete }),
            autocompletion({ activateOnTyping: true, defaultKeymap: true }),
          ]}
          onChange={handleChange}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
        />
      </div>
      <div className='flex items-center justify-between gap-2'>
        <div className='min-h-[14px] text-[11px]'>
          {error ? (
            <span className='text-red-600'>{error}</span>
          ) : isEmpty ? (
            <span className='text-muted-foreground'>
              Empty schema — downstream steps will see no variables.
            </span>
          ) : (
            <span className='text-muted-foreground'>
              Valid. Leaf types: {FIELD_TYPES.join(', ')}. Press <kbd>Ctrl</kbd>+<kbd>Space</kbd>{' '}
              after a <code>:</code> to pick a type.
            </span>
          )}
        </div>
        {isEmpty && (
          <Button type='button' variant='outline' size='sm' onClick={insertExample}>
            <Wand2 className='mr-1 size-3.5' />
            Insert example
          </Button>
        )}
      </div>
    </div>
  );
}

function typeAutocomplete(context: CompletionContext): CompletionResult | null {
  const before = context.state.doc.sliceString(0, context.pos);
  const inString = /:\s*"([^"]*)$/.exec(before);
  if (inString) {
    const partial = inString[1] ?? '';
    return {
      from: context.pos - partial.length,
      options: FIELD_TYPES.map(t => ({ label: t, type: 'enum' })),
      validFor: /^[a-zA-Z]*$/,
    };
  }

  const afterColon = /:\s*$/.test(before);
  if (afterColon && (context.explicit || context.matchBefore(/:\s*$/))) {
    return {
      from: context.pos,
      options: FIELD_TYPES.map(t => ({
        label: `"${t}"`,
        type: 'enum',
        detail: t,
      })),
    };
  }

  return null;
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function canonical(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s;
  }
}

function tryParseSchema(
  text: string,
): { ok: true; value: SchemaTree } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Top-level must be an object {…}.' };
  }
  const check = walkSchema(parsed as Record<string, unknown>, '');
  if (check) return { ok: false, error: check };
  return { ok: true, value: parsed as SchemaTree };
}

function walkSchema(node: Record<string, unknown>, path: string): string | null {
  for (const [k, v] of Object.entries(node)) {
    const here = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      if (!(FIELD_TYPES as readonly string[]).includes(v)) {
        return `Field "${here}" has invalid type "${v}". Allowed: ${FIELD_TYPES.join(', ')}.`;
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = walkSchema(v as Record<string, unknown>, here);
      if (sub) return sub;
    } else {
      return `Field "${here}" must be a type string or nested object.`;
    }
  }
  return null;
}

function FieldRow({
  label,
  description,
  required,
  error,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline gap-2'>
        <label className='text-sm font-medium text-foreground'>
          {label}
          {required && <span className='text-red-600'> *</span>}
        </label>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600'>{error}</span>}
    </div>
  );
}
