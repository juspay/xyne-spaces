import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { Combobox } from '../../../ui/Combobox/Combobox';
import { AutomationRichTextField } from '../SchemaForm/AutomationRichTextField';
import { SchemaJsonEditor, type SchemaTree } from '../SchemaForm/SchemaJsonEditor';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';
import { fetchClawAgents, type ClawAgent } from '../../../../api/automationsApi';

interface RunAgentConfigShape {
  agentSlug?: string;
  prompt?: string;
  outputSchema?: SchemaTree;
}

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

  const selectedAgent = useMemo<ClawAgent | null>(() => {
    if (!cfg.agentSlug) return null;
    const found = (agents ?? []).find(x => x.slug === cfg.agentSlug);
    if (found) return found;
    return {
      id: cfg.agentSlug,
      slug: cfg.agentSlug,
      name: cfg.agentSlug,
      description: 'no longer available',
      enabled: false,
      isDefault: false,
      color: '#94a3b8',
    };
  }, [agents, cfg.agentSlug]);

  const selectedAgentItem = useMemo(() => {
    if (!selectedAgent) return null;
    return {
      value: selectedAgent.slug,
      label: selectedAgent.name,
      description: selectedAgent.slug,
      leftSlot: <Sparkles className='size-3.5' style={{ color: selectedAgent.color }} />,
    };
  }, [selectedAgent]);

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
        {selectedAgent ? (
          <div className='inline-flex max-w-full items-center gap-2 self-start rounded-full border border-border bg-accent/40 py-1 pl-2 pr-1 text-sm'>
            <div className='flex size-5 items-center justify-center rounded-full bg-background shadow-sm'>
              <Sparkles className='size-3' style={{ color: selectedAgent.color }} />
            </div>
            <span className='truncate font-medium text-foreground'>{selectedAgent.name}</span>
            <span className='hidden truncate text-xs text-muted-foreground sm:inline'>
              {selectedAgent.slug}
            </span>
            <button
              type='button'
              aria-label='Change agent'
              data-track-category='automation-builder'
              data-track-name='run-agent-step-clear-agent'
              onClick={() => setField('agentSlug', '')}
              className='ml-1 flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground'
            >
              <X className='size-3' />
            </button>
          </div>
        ) : agentsLoading ? (
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
          emptyHint='Empty schema — downstream steps will see no variables.'
        />
      </FieldRow>
    </div>
  );
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
