import { useMemo, useState } from 'react';
import { SchemaJsonEditor, type SchemaTree } from '../SchemaForm/SchemaJsonEditor';
import { Button } from '../../../ui/Button/Button';
import { schemaFromPayload } from '../AutomationBuilder.utils';
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

  const hasFields = Object.keys(bodySchema).length > 0;
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const showPaste = pasteOpen || !hasFields;

  const closePaste = (): void => {
    setPasteOpen(false);
    setPasted('');
    setPasteError(null);
  };

  const generateFromPayload = (): void => {
    try {
      const parsed: unknown = JSON.parse(pasted);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPasteError('Paste a JSON object, e.g. the body of a real webhook delivery.');
        return;
      }
      setField('bodySchema', schemaFromPayload(parsed) as SchemaTree);
      closePaste();
    } catch (err) {
      setPasteError(
        `Invalid JSON (${err instanceof Error ? err.message : 'parse error'}). Paste the complete body.`,
      );
    }
  };

  return (
    <div className='flex flex-col gap-5'>
      <Field
        label='Expected payload'
        description='Listed fields are required (400 if missing), so keep only those present in every event. Leave empty to accept any JSON. Reach into lists by index, e.g. push.changes.0.new.name.'
        error={issuesAt.get('bodySchema')}
      >
        {showPaste ? (
          <div className='flex flex-col gap-2 rounded-md border border-dashed border-border p-3'>
            <span className='text-xs text-muted-foreground'>
              Paste a real delivery body from Bitbucket, GitHub or any app. Only field names and
              types are kept.
            </span>
            <textarea
              value={pasted}
              onChange={e => {
                setPasted(e.target.value);
                setPasteError(null);
              }}
              rows={8}
              spellCheck={false}
              data-track-category='automation-builder'
              data-track-name='webhook-payload-paste'
              placeholder='{ "push": { "changes": [ { "new": { "name": "main" } } ] } }'
              className={`w-full rounded-md border bg-background p-2 font-mono text-xs ${
                pasteError ? 'border-red-500/50' : 'border-border'
              }`}
            />
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                size='sm'
                disabled={pasted.trim().length === 0}
                onClick={generateFromPayload}
                data-track-category='automation-builder'
                data-track-name='GENERATE_WEBHOOK_FROM_PAYLOAD'
              >
                Generate fields
              </Button>
              {hasFields && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={closePaste}
                  data-track-category='automation-builder'
                  data-track-name='CANCEL_WEBHOOK_PAYLOAD_PASTE'
                >
                  Cancel
                </Button>
              )}
              {pasteError && <span className='text-[11px] text-red-600'>{pasteError}</span>}
            </div>
          </div>
        ) : (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='self-start'
            onClick={() => setPasteOpen(true)}
            data-track-category='automation-builder'
            data-track-name='OPEN_WEBHOOK_PAYLOAD_PASTE'
          >
            Replace from a real payload
          </Button>
        )}
        <SchemaJsonEditor
          value={bodySchema}
          onChange={next => setField('bodySchema', next)}
          example={{ ticketId: 'string', event: 'string' }}
          emptyHint='No fields declared — any JSON payload is accepted.'
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
