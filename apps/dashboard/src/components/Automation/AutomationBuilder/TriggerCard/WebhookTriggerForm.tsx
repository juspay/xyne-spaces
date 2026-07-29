import { useMemo } from 'react';
import { SchemaJsonEditor, type SchemaTree } from '../SchemaForm/SchemaJsonEditor';
import type { ValidationIssue } from '../../Automation.types';

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
        label='Request body'
        description='JSON shape callers must POST. Declared keys are required on every call (extras allowed); a 400 is returned on mismatch. Downstream steps read these as {{trigger.body.*}}.'
        error={issuesAt.get('bodySchema')}
      >
        <SchemaJsonEditor
          value={bodySchema}
          onChange={next => setField('bodySchema', next)}
          emptyHint='No body fields required — any JSON body is accepted.'
        />
      </Field>

      <Field
        label='Request headers'
        description='Header names callers must send. Declared headers are required (extras allowed). Mark a header sensitive by giving it the "secret" type — its value is redacted before the request is stored. Downstream steps read these as {{trigger.headers.*}}.'
        error={issuesAt.get('headerSchema')}
      >
        <SchemaJsonEditor
          value={headerSchema}
          onChange={next => setField('headerSchema', next)}
          allowSecret
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
