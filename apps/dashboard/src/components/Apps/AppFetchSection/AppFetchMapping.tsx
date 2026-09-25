import { useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Input from '../../ui/Input/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { cn } from '../../../utils/classNames';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import type { AppFetchFormValue } from './AppFetchSection.types';
import { MAPPED_FIELDS, readMapping, readNumber, readPagination } from './AppFetchSection.utils';

interface AppFetchMappingProps {
  value: AppFetchFormValue;
  onChange: (next: AppFetchFormValue) => void;
  readOnly?: boolean;
}

/**
 * Pagination mode and response mapping — the parts of the fetch config that the
 * shared webhook step form knows nothing about, because an automation reads a
 * response once while this walks pages of it and must understand the shape.
 *
 * Collapsed by default: an app returning Xyne's own shape needs none of it.
 */
export const AppFetchMapping = ({
  value,
  onChange,
  readOnly = false,
}: AppFetchMappingProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [pageSizeText, setPageSizeText] = useState(() => String(readNumber(value, 'pageSize', 50)));
  const pagination = readPagination(value);
  const mapping = readMapping(value);

  const setTop = (key: string, next: unknown): void => onChange({ ...value, [key]: next });
  const setMapping = (patch: Partial<typeof mapping>): void =>
    onChange({ ...value, response: { ...mapping, ...patch } });
  const setField = (key: string, next: string): void =>
    setMapping({ fields: { ...mapping.fields, [key]: next } });

  const mappedPaths = new Set(
    MAPPED_FIELDS.map(f => mapping.fields[f.key]).filter((p): p is string => Boolean(p)),
  );
  const unmappedIdFields = mapping.idFields.filter(p => !mappedPaths.has(p));

  // Offer the paths already mapped above — a dedup key is almost always a
  // subset of them. `allowCreate` still permits a path that is not mapped.
  const idFieldOptions: SelectorOption[] = ((): SelectorOption[] => {
    const seen = new Map<string, string>();
    for (const field of MAPPED_FIELDS) {
      const path = mapping.fields[field.key];
      if (path && !seen.has(path)) seen.set(path, field.label);
    }
    // Keep an already-selected custom path visible as a chip rather than a bare id.
    for (const path of mapping.idFields) if (!seen.has(path)) seen.set(path, 'Custom path');
    return [...seen].map(([path, label]) => ({
      value: path,
      label: path,
      subtitle: label,
      icon: null,
    }));
  })();

  return (
    <div className='rounded-md border border-border'>
      <button
        type='button'
        onClick={() => setOpen(o => !o)}
        className='flex w-full items-center gap-2 px-3 py-2 text-left'
        data-track-category='Apps'
        data-track-name='ToggleAppFetchMapping'
      >
        {open ? (
          <ChevronDown className='h-3.5 w-3.5 shrink-0' aria-hidden />
        ) : (
          <ChevronRight className='h-3.5 w-3.5 shrink-0' aria-hidden />
        )}
        <span className='text-xs font-medium'>Pagination &amp; response shape</span>
        <span className='ml-auto text-[11px] text-muted-foreground'>
          {pagination === 'offset' ? 'offset / limit' : 'cursor'}
          {mapping.messagesPath ? ` · ${mapping.messagesPath}[]` : ' · bare array'}
        </span>
      </button>

      {open && (
        <div className='flex flex-col gap-3 border-t border-border px-3 py-3'>
          <div className='grid gap-3 md:grid-cols-2'>
            <div className='flex flex-col gap-1'>
              <label className='text-xs font-medium' htmlFor='app-fetch-pagination'>
                Pagination
              </label>
              <Select
                value={pagination}
                onValueChange={next => setTop('pagination', next)}
                disabled={readOnly}
              >
                <SelectTrigger id='app-fetch-pagination' className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='cursor'>Cursor</SelectItem>
                  <SelectItem value='offset'>Offset</SelectItem>
                </SelectContent>
              </Select>
              <span className='text-[11px] text-muted-foreground'>
                {pagination === 'offset'
                  ? 'Send {{fetch.offset}} and {{fetch.limit}}; an empty page ends the export.'
                  : 'Send {{fetch.cursor}}; omitting nextCursor ends the export.'}
              </span>
            </div>

            {pagination === 'offset' && (
              <div className='flex flex-col gap-1'>
                <label className='text-xs font-medium' htmlFor='app-fetch-page-size'>
                  Page size
                </label>
                <Input
                  id='app-fetch-page-size'
                  value={pageSizeText}
                  onChange={e => {
                    const raw = e.target.value;
                    setPageSizeText(raw);
                    const parsed = Number(raw);
                    if (raw.trim() && Number.isInteger(parsed) && parsed > 0) {
                      setTop('pageSize', parsed);
                    }
                  }}
                  onBlur={() => setPageSizeText(String(readNumber(value, 'pageSize', 50)))}
                  inputMode='numeric'
                  aria-invalid={pageSizeText.trim() === '' || Number(pageSizeText) <= 0}
                  disabled={readOnly}
                />
                <span className='text-[11px] text-muted-foreground'>
                  Sent as {'{{fetch.limit}}'} and added to the offset each page — it must match what
                  the app is sent. Some apps count this in threads, not messages.
                </span>
              </div>
            )}
          </div>

          <div className='grid gap-3 md:grid-cols-2'>
            <div className='flex flex-col gap-1'>
              <label className='text-xs font-medium' htmlFor='app-fetch-messages-path'>
                Messages array path
              </label>
              <Input
                id='app-fetch-messages-path'
                value={mapping.messagesPath}
                onChange={e => setMapping({ messagesPath: e.target.value })}
                placeholder='leave empty for a bare array'
                className='font-mono text-xs'
                disabled={readOnly}
              />
            </div>
            {pagination === 'cursor' && (
              <div className='flex flex-col gap-1'>
                <label className='text-xs font-medium' htmlFor='app-fetch-cursor-path'>
                  Next-cursor path
                </label>
                <Input
                  id='app-fetch-cursor-path'
                  value={mapping.nextCursorPath}
                  onChange={e => setMapping({ nextCursorPath: e.target.value })}
                  className='font-mono text-xs'
                  disabled={readOnly}
                />
              </div>
            )}
          </div>

          <div className='flex flex-col gap-1.5'>
            <span className='text-xs font-medium'>Field paths</span>
            <div className='grid gap-2 md:grid-cols-2'>
              {MAPPED_FIELDS.map(field => (
                <div key={field.key} className='flex items-center gap-2'>
                  <label
                    className='w-32 shrink-0 text-[11px] text-muted-foreground'
                    htmlFor={`app-fetch-field-${field.key}`}
                  >
                    {field.label}
                    {field.required ? ' *' : ''}
                  </label>
                  <Input
                    id={`app-fetch-field-${field.key}`}
                    value={mapping.fields[field.key] ?? ''}
                    onChange={e => setField(field.key, e.target.value)}
                    className={cn('h-8 flex-1 min-w-0 font-mono text-xs')}
                    disabled={readOnly}
                  />
                </div>
              ))}
            </div>
            <span className='text-[11px] text-muted-foreground'>
              Dot paths into each item, e.g.{' '}
              <code className='font-mono'>additionalFormFields.messageCreatedAt</code>. Only the
              starred fields are required.
            </span>
          </div>

          <div className='flex flex-col gap-1'>
            <span className='text-xs font-medium'>Deduplication key</span>
            {readOnly ? (
              <p className='text-xs font-mono text-muted-foreground'>
                {mapping.idFields.length > 0 ? mapping.idFields.join(' | ') : 'message id alone'}
              </p>
            ) : (
              <EntityMultiSelector
                options={idFieldOptions}
                selectedValues={mapping.idFields}
                onMultiSelect={next => setMapping({ idFields: next })}
                placeholder='Message id alone'
                searchPlaceholder='Search or type a path'
                showSearch
                allowCreate
                onCreateOption={path => {
                  const trimmed = path.trim();
                  if (trimmed && !mapping.idFields.includes(trimmed)) {
                    setMapping({ idFields: [...mapping.idFields, trimmed] });
                  }
                }}
                collapseSelectedAfter={0}
                collapsedLabel='paths'
              />
            )}

            {mapping.idFields.length > 0 && (
              <div className='flex flex-col gap-0.5'>
                <span className='text-[11px] text-muted-foreground'>
                  Key:{' '}
                  {mapping.idFields.map((path, i) => (
                    <span key={path}>
                      {i > 0 && <span className='text-muted-foreground'> | </span>}
                      <code
                        className={cn(
                          'font-mono',
                          unmappedIdFields.includes(path) && 'text-destructive underline',
                        )}
                      >
                        {path}
                      </code>
                    </span>
                  ))}
                </span>
                {unmappedIdFields.length > 0 && (
                  <span className='text-[11px] text-destructive'>
                    {unmappedIdFields.map(p => `"${p}"`).join(', ')} match no field path above. If
                    you renamed a field, update this key to match.
                  </span>
                )}
              </div>
            )}
            <span className='text-[11px] text-muted-foreground'>
              Paths combined into one id, in the order chosen. Needed when the app&apos;s own id is
              not unique on its own. Listing the jointly-unique fields keeps those messages from
              being discarded as duplicates.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
