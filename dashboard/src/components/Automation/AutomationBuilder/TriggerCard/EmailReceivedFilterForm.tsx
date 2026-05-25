import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MailX } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import type { JsonSchema, ValidationIssue } from '../../Automation.types';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';

const INCLUDE_KEYS = [
  'channelIds',
  'fromEmails',
  'fromDomains',
  'toEmails',
  'subjectContains',
  'bodyContains',
  'matchCase',
  'onlyNewThreads',
];
const EXCLUDE_KEYS = [
  'excludedFromEmails',
  'excludedFromDomains',
  'excludedToEmails',
  'excludedSubjectContains',
  'excludedBodyContains',
];

interface EmailReceivedFilterFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
}

export function EmailReceivedFilterForm({
  schema,
  value,
  onChange,
  issues,
  pathPrefix,
}: EmailReceivedFilterFormProps): React.ReactElement {
  const includeSchema = useMemo(() => pickSchemaProps(schema, INCLUDE_KEYS), [schema]);
  const excludeSchema = useMemo(() => pickSchemaProps(schema, EXCLUDE_KEYS), [schema]);

  const hasAnyExclusion = useMemo(() => EXCLUDE_KEYS.some(k => !isEmpty(value[k])), [value]);
  const [excludeOpen, setExcludeOpen] = useState(hasAnyExclusion);

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm
        schema={includeSchema}
        value={value}
        onChange={onChange}
        issues={issues}
        pathPrefix={pathPrefix}
      />

      <div className='rounded-lg border border-border bg-muted/40'>
        <button
          type='button'
          aria-expanded={excludeOpen}
          aria-controls='email-exclude-fields'
          onClick={() => setExcludeOpen(o => !o)}
          data-track-category='automation-builder'
          data-track-name='email-filter-toggle-exclude'
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
            'hover:bg-accent/40',
          )}
        >
          <span className='flex items-center gap-2'>
            <MailX className='size-4 text-muted-foreground' aria-hidden='true' />
            <span className='text-xs font-medium uppercase tracking-[0.06em] text-foreground'>
              Skip emails when…
            </span>
            <span className='text-[11px] text-muted-foreground'>
              · negative filters take priority over the match rules above
            </span>
          </span>
          {excludeOpen ? (
            <ChevronDown className='size-4 text-muted-foreground' aria-hidden='true' />
          ) : (
            <ChevronRight className='size-4 text-muted-foreground' aria-hidden='true' />
          )}
        </button>
        {excludeOpen && (
          <div id='email-exclude-fields' className='border-t border-border bg-background px-3 py-3'>
            <SchemaForm
              schema={excludeSchema}
              value={value}
              onChange={onChange}
              issues={issues}
              pathPrefix={pathPrefix}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function pickSchemaProps(schema: JsonSchema, keys: string[]): JsonSchema {
  const resolved = resolveSchema(schema);
  if (!resolved.properties) return schema;

  const filteredProps: Record<string, JsonSchema> = {};
  for (const k of keys) {
    const prop = resolved.properties[k];
    if (prop) filteredProps[k] = prop;
  }

  const filteredRequired = Array.isArray(resolved.required)
    ? resolved.required.filter(r => keys.includes(r))
    : undefined;

  if (schema.$ref && schema.definitions) {
    const refMatch = /^#\/definitions\/(.+)$/.exec(schema.$ref);
    const name = refMatch?.[1];
    if (name && schema.definitions[name]) {
      return {
        $ref: schema.$ref,
        definitions: {
          ...schema.definitions,
          [name]: {
            ...resolved,
            properties: filteredProps,
            ...(filteredRequired ? { required: filteredRequired } : {}),
          },
        },
      };
    }
  }

  return {
    ...resolved,
    properties: filteredProps,
    ...(filteredRequired ? { required: filteredRequired } : {}),
  };
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}
