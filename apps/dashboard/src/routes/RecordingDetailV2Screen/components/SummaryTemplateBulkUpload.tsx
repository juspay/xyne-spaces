import { useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { DownloadDown, MultipleCrossCancelDefault, UploadUp } from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import { downloadTextFile } from '../../../components/Tickets/TicketTable/ticketTableExport';
import {
  recordingService,
  type SummaryTemplate,
} from '../../../services/Recording/recordingService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { cn } from '../../../utils/classNames';
import {
  BULK_TEMPLATE_LIMIT,
  SAMPLE_CSV_FILENAME,
  buildSampleCsv,
  parseSummaryTemplateCsv,
  type BulkTemplateParseResult,
} from './summaryTemplateBulkCsv';

const UNREADABLE_FILE_ERROR = 'Unable to read this file. Upload a CSV file.';
const ROW_GRID_CLASS =
  'grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem_minmax(0,1.4fr)_1.75rem] items-start gap-3 px-3 py-2';

interface SummaryTemplateBulkUploadProps {
  templates: SummaryTemplate[];
  onClose: () => void;
}

/** Taken names from the server; the API client keeps the response body on `responseData`. */
const readTakenNames = (error: unknown): string[] => {
  const names = (error as { responseData?: { takenNames?: unknown } } | null)?.responseData
    ?.takenNames;
  return Array.isArray(names)
    ? names.filter((name): name is string => typeof name === 'string')
    : [];
};

/** Scribe admins only: creates templates from a CSV, all of them or none. */
export function SummaryTemplateBulkUpload({
  templates,
  onClose,
}: SummaryTemplateBulkUploadProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [removedLines, setRemovedLines] = useState<ReadonlySet<number>>(new Set());
  const [takenNames, setTakenNames] = useState<readonly string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Names are unique across the workspace, not per owner.
  const usedNames = useMemo(
    () =>
      new Set(
        [...templates.map(template => template.name), ...takenNames].map(name =>
          name.trim().toLowerCase(),
        ),
      ),
    [takenNames, templates],
  );

  // Re-validated on every removal: dropping a row can clear another row's duplicate error.
  const result = useMemo<BulkTemplateParseResult | null>(() => {
    if (readError) return { rows: [], fileError: readError };
    if (csvText === null) return null;
    try {
      return parseSummaryTemplateCsv(csvText, usedNames, removedLines);
    } catch {
      return { rows: [], fileError: UNREADABLE_FILE_ERROR };
    }
  }, [csvText, readError, removedLines, usedNames]);

  const rows = result?.rows ?? [];
  const invalidCount = rows.filter(row => row.errors.length > 0).length;
  const canCreate = rows.length > 0 && invalidCount === 0 && !result?.fileError && !creating;
  const allRowsRemoved = result !== null && !result.fileError && rows.length === 0;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again after fixing it still fires.
    event.target.value = '';
    if (!file) return;

    setFileName(file.name);
    setRemovedLines(new Set());
    setCreateError(null);
    try {
      setCsvText(await file.text());
      setReadError(null);
    } catch {
      setCsvText(null);
      setReadError(UNREADABLE_FILE_ERROR);
    }
  };

  const handleRemove = (line: number): void => {
    setRemovedLines(current => new Set(current).add(line));
    setCreateError(null);
  };

  const handleCreate = async (): Promise<void> => {
    if (!canCreate) return;
    const inputs = rows.flatMap(row => (row.input ? [row.input] : []));

    setCreating(true);
    setCreateError(null);
    try {
      const created = await recordingService.bulkCreateSummaryTemplates(inputs);
      toast.success(
        created.length === 1 ? '1 template created' : `${created.length} templates created`,
      );
      onClose();
    } catch (error) {
      const taken = readTakenNames(error);
      if (taken.length > 0) {
        // Marks those rows in the list, where they can be removed.
        setTakenNames(current => [...current, ...taken]);
        setCreateError(
          `Nothing was created. ${taken.length === 1 ? '1 name is' : `${taken.length} names are`} already used in this workspace; the rows are marked below.`,
        );
        return;
      }
      setCreateError(`Nothing was created. ${getApiErrorMessage(error, 'Please try again.')}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col bg-background text-foreground'>
      <header className='flex h-14 shrink-0 items-center justify-between border-b border-border px-4'>
        <h2 className='text-sm font-semibold'>Bulk upload templates</h2>
        <Button
          type='button'
          variant='ghost'
          size='iconSm'
          onClick={onClose}
          disabled={creating}
          className='rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close bulk upload'
          data-track-category='SummaryTemplates'
          data-track-name='CloseBulkUpload'
        >
          <MultipleCrossCancelDefault className='size-4' />
        </Button>
      </header>

      <div className='thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5'>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          Upload a CSV with one template per row. Each row needs a name, a meeting context and at
          least one section. Decisions and Action Items are included only when the file lists them
          as sections. Up to {BULK_TEMPLATE_LIMIT} templates per file.
        </p>

        <div className='mt-4 flex flex-wrap items-center gap-2.5'>
          <Button
            type='button'
            variant='outline'
            onClick={() =>
              downloadTextFile(SAMPLE_CSV_FILENAME, buildSampleCsv(), 'text/csv;charset=utf-8')
            }
            className='h-9 gap-2 rounded-lg border-border px-3 shadow-none hover:bg-muted'
            data-track-category='SummaryTemplates'
            data-track-name='DownloadSampleCsv'
          >
            <DownloadDown className='size-4' />
            Download sample CSV
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
            disabled={creating}
            className='h-9 gap-2 rounded-lg border-border px-3 shadow-none hover:bg-muted'
            data-track-category='SummaryTemplates'
            data-track-name='ChooseBulkUploadCsv'
          >
            <UploadUp className='size-4' />
            {fileName ? 'Choose another file' : 'Choose CSV file'}
          </Button>
          <input
            ref={fileInputRef}
            type='file'
            accept='.csv,text/csv'
            className='hidden'
            onChange={event => void handleFile(event)}
            data-testid='summary-template-bulk-upload-input'
          />
          {fileName && <span className='truncate text-sm text-muted-foreground'>{fileName}</span>}
        </div>

        {result?.fileError && (
          <p className='mt-4 text-sm text-destructive' role='alert'>
            {result.fileError}
          </p>
        )}

        {createError && (
          <p
            className='mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
            role='alert'
          >
            {createError}
          </p>
        )}

        {allRowsRemoved && (
          <p className='mt-4 text-sm text-muted-foreground'>
            Every row was removed. Choose a file to start again.
          </p>
        )}

        {rows.length > 0 && (
          <div className='mt-5 overflow-hidden rounded-lg border border-border'>
            <div
              className={cn(
                ROW_GRID_CLASS,
                'border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
              )}
            >
              <span>Line</span>
              <span>Name</span>
              <span>Sections</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map(row => (
              <div
                key={row.line}
                className={cn(ROW_GRID_CLASS, 'border-b border-border text-sm last:border-b-0')}
              >
                <span className='text-muted-foreground'>{row.line}</span>
                <span className='truncate' title={row.name}>
                  {row.name || '—'}
                </span>
                <span className='text-muted-foreground'>{row.sectionCount}</span>
                <span className='min-w-0'>
                  <span
                    className={cn(
                      row.errors.length > 0 ? 'text-destructive' : 'text-status-success',
                    )}
                  >
                    {row.errors.length > 0 ? row.errors.join('. ') : 'Ready'}
                  </span>
                  {row.standardSections.length > 0 && (
                    <span className='block text-xs text-muted-foreground'>
                      {row.standardSections.join(' and ')} included with the standard text
                    </span>
                  )}
                </span>
                <button
                  type='button'
                  onClick={() => handleRemove(row.line)}
                  disabled={creating}
                  className='flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                  aria-label={`Remove ${row.name || `line ${row.line}`}`}
                  data-track-category='SummaryTemplates'
                  data-track-name='RemoveBulkUploadRow'
                >
                  <MultipleCrossCancelDefault className='size-3.5' />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className='flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3'>
        <p className='min-w-0 truncate text-sm text-muted-foreground'>
          {invalidCount > 0
            ? `${invalidCount} of ${rows.length} rows have problems. Remove them, or fix the file and upload it again.`
            : ''}
        </p>
        <div className='flex shrink-0 items-center gap-2.5'>
          <Button
            type='button'
            variant='outline'
            onClick={onClose}
            disabled={creating}
            className='h-9 rounded-lg px-4 text-sm font-medium text-muted-foreground'
          >
            Cancel
          </Button>
          <Button
            type='button'
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className='h-9 rounded-lg px-4 text-sm font-semibold'
            data-track-category='SummaryTemplates'
            data-track-name='BulkCreateTemplates'
          >
            {creating
              ? 'Creating…'
              : rows.length > 0 && invalidCount === 0
                ? `Create ${rows.length} ${rows.length === 1 ? 'template' : 'templates'}`
                : 'Create templates'}
          </Button>
        </div>
      </footer>
    </div>
  );
}

export default SummaryTemplateBulkUpload;
