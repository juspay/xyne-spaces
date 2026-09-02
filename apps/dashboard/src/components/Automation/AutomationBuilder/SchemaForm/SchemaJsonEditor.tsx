import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonLanguage } from '@codemirror/lang-json';
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { Button } from '../../../ui/Button/Button';

export const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// `secret` is a string leaf that also marks the field sensitive (its value is
// redacted / encrypted). Only offered when the editor opts in via allowSecret.
export const SECRET_TYPE = 'secret';

export type SchemaNode = string | { [k: string]: SchemaNode };
export type SchemaTree = Record<string, SchemaNode>;

export function secretKeys(schema: SchemaTree | undefined): string[] {
  if (!schema) return [];
  return Object.entries(schema)
    .filter(([, v]) => v === SECRET_TYPE)
    .map(([k]) => k);
}

export function SchemaJsonEditor({
  value,
  onChange,
  readOnly = false,
  allowSecret = false,
  example,
  emptyHint = 'Empty schema — no fields declared.',
}: {
  value: SchemaTree;
  onChange: (next: SchemaTree) => void;
  readOnly?: boolean;
  allowSecret?: boolean;
  example?: SchemaTree;
  emptyHint?: string;
}): React.ReactElement {
  const allowedTypes = useMemo(
    () => (allowSecret ? [...FIELD_TYPES, SECRET_TYPE] : [...FIELD_TYPES]),
    [allowSecret],
  );
  const [draft, setDraft] = useState(() => stringify(value));
  const [error, setError] = useState<string | null>(null);

  // Reflect external value changes back into the draft, but never clobber a
  // mid-edit local string when canonical content matches.
  useEffect(() => {
    const incoming = stringify(value);
    setDraft(prev => (canonical(prev) === canonical(incoming) ? prev : incoming));
  }, [value]);

  const handleChange = (next: string): void => {
    setDraft(next);
    const parsed = tryParseSchema(next, allowedTypes);
    if (parsed.ok) {
      setError(null);
      onChange(parsed.value);
    } else {
      setError(parsed.error);
    }
  };

  const insertExample = (): void => {
    if (!example) return;
    const text = stringify(example);
    setDraft(text);
    setError(null);
    onChange(example);
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
            jsonLanguage.data.of({ autocomplete: makeTypeAutocomplete(allowedTypes) }),
            autocompletion({ activateOnTyping: true, defaultKeymap: true }),
          ]}
          onChange={handleChange}
          className='schema-json-editor'
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
        />
      </div>
      <div className='flex items-center justify-between gap-2'>
        <div className='min-h-[14px] text-[11px]'>
          {error ? (
            <span className='text-red-600'>{error}</span>
          ) : isEmpty ? (
            <span className='text-muted-foreground'>{emptyHint}</span>
          ) : (
            <span className='text-muted-foreground'>
              Valid. Leaf types: {allowedTypes.join(', ')}.
              {allowSecret ? ' Use "secret" to mark a header sensitive.' : ''} Press <kbd>Ctrl</kbd>
              +<kbd>Space</kbd> after a <code>:</code> to pick a type.
            </span>
          )}
        </div>
        {isEmpty && !readOnly && example && (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={insertExample}
            data-track-category='automation-builder'
            data-track-name='INSERT_SCHEMA_EXAMPLE'
          >
            Insert example
          </Button>
        )}
      </div>
    </div>
  );
}

function makeTypeAutocomplete(allowedTypes: string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.state.doc.sliceString(0, context.pos);
    const inString = /:\s*"([^"]*)$/.exec(before);
    if (inString) {
      const partial = inString[1] ?? '';
      return {
        from: context.pos - partial.length,
        options: allowedTypes.map(t => ({ label: t, type: 'enum' })),
        validFor: /^[a-zA-Z]*$/,
      };
    }

    const afterColon = /:\s*$/.test(before);
    if (afterColon && (context.explicit || context.matchBefore(/:\s*$/))) {
      return {
        from: context.pos,
        options: allowedTypes.map(t => ({ label: `"${t}"`, type: 'enum', detail: t })),
      };
    }

    return null;
  };
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

export function tryParseSchema(
  text: string,
  allowedTypes: string[],
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
  const check = walkSchema(parsed as Record<string, unknown>, '', allowedTypes);
  if (check) return { ok: false, error: check };
  return { ok: true, value: parsed as SchemaTree };
}

function walkSchema(
  node: Record<string, unknown>,
  path: string,
  allowedTypes: string[],
): string | null {
  for (const [k, v] of Object.entries(node)) {
    const here = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      if (!allowedTypes.includes(v)) {
        return `Field "${here}" has invalid type "${v}". Allowed: ${allowedTypes.join(', ')}.`;
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = walkSchema(v as Record<string, unknown>, here, allowedTypes);
      if (sub) return sub;
    } else {
      return `Field "${here}" must be a type string or nested object.`;
    }
  }
  return null;
}
