import { useMemo } from 'react';
import { SchemaJsonEditor, type SchemaTree } from '../SchemaForm/SchemaJsonEditor';
import type { ValidationIssue } from '../../Automation.types';

const BODY_SCHEMA_EXAMPLE: SchemaTree = {
  customerId: 'string',
  amount: 'number',
  metadata: {
    source: 'string',
  },
};

const HEADER_SCHEMA_EXAMPLE: SchemaTree = {
  'x-signature': 'secret',
  'x-api-version': 'string',
};

interface WebhookTriggerConfigShape {
  bodySchema?: SchemaTree;
  headerSchema?: SchemaTree;
}

interface WebhookTriggerFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
}

export function WebhookTriggerForm({
  value,
  onChange,
  issues,
  pathPrefix,
}: WebhookTriggerFormProps): React.ReactElement {
  const cfg = value as WebhookTriggerConfigShape;

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(pathPrefix)) map.set(i.path.slice(pathPrefix.length), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof WebhookTriggerConfigShape>(
    key: K,
    next: WebhookTriggerConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  const bodySchema = cfg.bodySchema ?? {};
  const headerSchema = cfg.headerSchema ?? {};

  return (
    <div className='flex flex-col gap-5'>
      <Field
        label='Request body schema'
        description='This is not a sample request body. Declare each variable name and its type, for example { customerId: "string" }. Callers must POST those fields; downstream steps read them as {{trigger.body.customerId}}.'
        error={issuesAt.get('bodySchema')}
      >
        <SchemaJsonEditor
          value={bodySchema}
          onChange={next => setField('bodySchema', next)}
          example={BODY_SCHEMA_EXAMPLE}
          emptyHint='No body fields required — any JSON body is accepted.'
        />
      </Field>

      <Field
        label='Request header schema'
        description='Declare required header variable names and their types. Mark a sensitive header as "secret" so its value is redacted before storage. Downstream steps read them as {{trigger.headers.x-signature}}.'
        error={issuesAt.get('headerSchema')}
      >
        <SchemaJsonEditor
          value={headerSchema}
          onChange={next => setField('headerSchema', next)}
          allowSecret
          example={HEADER_SCHEMA_EXAMPLE}
          emptyHint='No required headers.'
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline gap-2'>
        <label className='text-sm font-medium text-foreground'>{label}</label>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600'>{error}</span>}
    </div>
  );
}
