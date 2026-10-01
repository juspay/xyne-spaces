import DOMPurify from 'dompurify';
import { ChevronRight } from 'lucide-react';
import { Tooltip } from '../../../ui/Tooltip';
import {
  detectEntityArrayKind,
  detectEntityKind,
  EntityKind,
  humanise,
} from '../../AutomationBuilder/SchemaForm/SchemaForm.utils';
import { useEntityNameLookup } from '../../AutomationBuilder/ConditionEditor/useEntityNameLookup';
import type { EntityNameLookup } from '../../AutomationBuilder/ConditionEditor/ConditionEditor.utils';

// Real markup only (a closing tag or <br>), so "Name <addr@x.com>" stays plain text.
const HTML_TAG = /<\/[a-z][a-z0-9]*\s*>|<br\s*\/?>/i;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRow(value) && Object.keys(value).length === 0;
}

/** A run payload (trigger data, step input/output) as labelled fields instead of JSON. */
export function RunValueView({ value }: { value: unknown }): React.ReactElement {
  const nameForId = useEntityNameLookup();
  return (
    <div className='text-xs'>
      {isRow(value) ? (
        <Fields row={value} depth={0} nameForId={nameForId} />
      ) : (
        <Value fieldKey='' value={value} depth={0} nameForId={nameForId} />
      )}
    </div>
  );
}

function Fields({
  row,
  depth,
  nameForId,
}: {
  row: Row;
  depth: number;
  nameForId: EntityNameLookup;
}): React.ReactElement {
  return (
    <dl className='grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5'>
      {Object.entries(row).map(([key, value]) => (
        <div key={key} className='contents'>
          <dt className='truncate text-muted-foreground' title={key}>
            {humanise(key)}
          </dt>
          <dd className='min-w-0 text-foreground'>
            <Value fieldKey={key} value={value} depth={depth + 1} nameForId={nameForId} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Value({
  fieldKey,
  value,
  depth,
  nameForId,
}: {
  fieldKey: string;
  value: unknown;
  depth: number;
  nameForId: EntityNameLookup;
}): React.ReactElement {
  if (isEmpty(value)) return <span className='text-muted-foreground'>—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string') {
    if (HTML_TAG.test(value)) {
      return (
        <div
          className='break-words rounded-md border border-border bg-background px-2 py-1.5 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4'
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(value, {
              FORBID_TAGS: ['style', 'img', 'form', 'input', 'button'],
              FORBID_ATTR: ['style', 'class'],
            }),
          }}
        />
      );
    }
    const kind = detectEntityKind(fieldKey);
    return kind ? (
      <EntityId kind={kind} id={value} nameForId={nameForId} />
    ) : (
      <span className='whitespace-pre-wrap break-words'>{value}</span>
    );
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    if (items.some(isRow)) {
      return (
        <div className='flex flex-col gap-1'>
          {items.map((item, index) => (
            <Group
              key={index}
              label={`#${index + 1}`}
              value={item}
              depth={depth}
              nameForId={nameForId}
            />
          ))}
        </div>
      );
    }
    const kind = detectEntityArrayKind(fieldKey);
    return (
      <span className='flex flex-wrap gap-1'>
        {items.map((item, index) => (
          <span key={index} className='rounded border border-border bg-background px-1.5 py-0.5'>
            {kind && typeof item === 'string' ? (
              <EntityId kind={kind} id={item} nameForId={nameForId} />
            ) : (
              String(item)
            )}
          </span>
        ))}
      </span>
    );
  }
  if (isRow(value)) {
    return <Group label='' value={value} depth={depth} nameForId={nameForId} />;
  }
  return <span>{String(value)}</span>;
}

/** A nested object (or an array item), collapsed below the top level. */
function Group({
  label,
  value,
  depth,
  nameForId,
}: {
  label: string;
  value: unknown;
  depth: number;
  nameForId: EntityNameLookup;
}): React.ReactElement {
  if (!isRow(value)) return <Value fieldKey='' value={value} depth={depth} nameForId={nameForId} />;
  const count = Object.keys(value).length;
  return (
    <details open={depth < 1} className='group'>
      <summary className='flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden'>
        <ChevronRight
          className='size-3 transition-transform group-open:rotate-90'
          aria-hidden='true'
        />
        {label && `${label} · `}
        {count} field{count === 1 ? '' : 's'}
      </summary>
      <div className='mt-1.5 border-l-2 border-border pl-3'>
        <Fields row={value} depth={depth} nameForId={nameForId} />
      </div>
    </details>
  );
}

/** A picked id: its name (id in the tooltip) when known, else the id in monospace. */
function EntityId({
  kind,
  id,
  nameForId,
}: {
  kind: EntityKind;
  id: string;
  nameForId: EntityNameLookup;
}): React.ReactElement {
  const name = nameForId(kind, id);
  if (!name) return <span className='break-all font-mono'>{id}</span>;
  return (
    <Tooltip content={id} side='top' delayDuration={300}>
      <span>{kind === EntityKind.CHANNEL ? `#${name}` : name}</span>
    </Tooltip>
  );
}
