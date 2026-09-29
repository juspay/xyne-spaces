import Papa from 'papaparse';
import { DefaultOutlet, serializeCsv } from '@xyne/shared';
import type {
  SummaryTemplateInput,
  SummaryTemplateSection,
} from '../../../services/Recording/recordingService';
import {
  MAX_EDITABLE_SECTIONS,
  MAX_MEETING_CONTEXT_LENGTH,
  MAX_SECTION_DESCRIPTION_LENGTH,
  MAX_SECTION_TITLE_LENGTH,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_TEMPLATE_TITLE_LENGTH,
  MANDATORY_SECTIONS,
  findMandatorySection,
  withMandatorySections,
} from './summaryTemplateSectionRules';

/** Must match the backend's limit on one bulk request. */
export const BULK_TEMPLATE_LIMIT = 50;

export const SAMPLE_CSV_FILENAME = 'summary-templates-sample.csv';

const SAMPLE_SECTION_COUNT = 3;
const SECTION_HEADER = /^section_(\d+)_(title|description)$/;
const REQUIRED_HEADERS = ['name', 'meeting_context'];

export interface BulkTemplateRow {
  /** Line in the file, counting the header as line 1. */
  line: number;
  name: string;
  sectionCount: number;
  errors: string[];
  /** Decisions / Action Items the file listed; their text is fixed, not the file's. */
  standardSections: string[];
  /** Null while the row has errors. */
  input: SummaryTemplateInput | null;
}

export interface BulkTemplateParseResult {
  rows: BulkTemplateRow[];
  /** A problem with the file as a whole. */
  fileError: string | null;
}

const BYTE_ORDER_MARK = 0xfeff;

const normalizeHeader = (header: string): string =>
  (header.charCodeAt(0) === BYTE_ORDER_MARK ? header.slice(1) : header)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Trims, and undoes the apostrophe our own CSV export puts before formula characters. */
const cleanCell = (value: string | undefined): string =>
  (value ?? '').trim().replace(/^'(?=\s*[=+\-@])/, '');

export function buildSampleCsv(): string {
  const sectionHeaders = Array.from({ length: SAMPLE_SECTION_COUNT }, (_, index) => [
    `section_${index + 1}_title`,
    `section_${index + 1}_description`,
  ]).flat();

  return serializeCsv(
    ['name', 'meeting_context', ...sectionHeaders, 'default_outlet', 'system_prompt'],
    [
      [
        'Sprint planning',
        'Use for sprint planning meetings where the team commits to work for the next sprint.',
        'Sprint goal',
        'The goal the team agreed on for the sprint, in one or two sentences.',
        'Committed work',
        'Each item the team committed to, with its owner and estimate.',
        'Action Items',
        'Standard section. Its text is fixed, so this description is not used.',
        'EMAIL',
        '',
      ],
      [
        'Customer call',
        'Use for calls with a customer about their requirements, feedback or issues.',
        'Customer needs',
        'What the customer asked for and the problem behind each request.',
        'Commitments made',
        'Everything we promised the customer, with the owner and the date.',
        '',
        '',
        'MESSAGE',
        '',
      ],
    ],
  );
}

/** `existingNames` are names already used in the workspace, lower-cased. */
export function parseSummaryTemplateCsv(
  text: string,
  existingNames: ReadonlySet<string>,
  removedLines: ReadonlySet<number> = new Set(),
): BulkTemplateParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeHeader,
  });
  const headers = parsed.meta.fields ?? [];

  const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missing.length > 0) {
    return { rows: [], fileError: `Missing columns: ${missing.join(', ')}` };
  }
  if (parsed.data.length === 0) {
    return { rows: [], fileError: 'The file has no templates in it.' };
  }
  if (parsed.data.length > BULK_TEMPLATE_LIMIT) {
    return {
      rows: [],
      fileError: `The file has ${parsed.data.length} templates. Upload at most ${BULK_TEMPLATE_LIMIT} at a time.`,
    };
  }

  const sectionNumbers = [
    ...new Set(
      headers.flatMap(header => {
        const match = SECTION_HEADER.exec(header);
        return match?.[1] ? [Number(match[1])] : [];
      }),
    ),
  ].sort((left, right) => left - right);

  // Removed rows are dropped before validation, so a duplicate of one stops being a duplicate.
  const kept = parsed.data
    .map((record, index) => ({ record, line: index + 2 }))
    .filter(({ line }) => !removedLines.has(line));

  const lineByName = new Map<string, number>();
  const rows = kept.map(({ record, line }): BulkTemplateRow => {
    const errors: string[] = [];

    const name = cleanCell(record['name']);
    if (!name) errors.push('Name is required');
    else if (name.length > MAX_TEMPLATE_TITLE_LENGTH) {
      errors.push(`Name is longer than ${MAX_TEMPLATE_TITLE_LENGTH} characters`);
    }

    const nameKey = name.toLowerCase();
    const firstLine = lineByName.get(nameKey);
    if (name && firstLine !== undefined) errors.push(`Same name as line ${firstLine}`);
    else if (name && existingNames.has(nameKey)) {
      errors.push('This name is already used in this workspace');
    }
    if (name && firstLine === undefined) lineByName.set(nameKey, line);

    const meetingContext = cleanCell(record['meeting_context']);
    if (!meetingContext) errors.push('Meeting context is required');
    else if (meetingContext.length > MAX_MEETING_CONTEXT_LENGTH) {
      errors.push(`Meeting context is longer than ${MAX_MEETING_CONTEXT_LENGTH} characters`);
    }

    const sections: SummaryTemplateSection[] = [];
    const listedMandatoryIds = new Set<string>();
    for (const number of sectionNumbers) {
      const title = cleanCell(record[`section_${number}_title`]);
      const description = cleanCell(record[`section_${number}_description`]);
      if (!title && !description) continue;
      // Decisions and Action Items are reserved sections with their own fixed text.
      const mandatory = title ? findMandatorySection(title) : undefined;
      if (mandatory) {
        listedMandatoryIds.add(mandatory.id);
        continue;
      }

      if (!title || !description) {
        errors.push(`Section ${number} needs both a title and a description`);
      } else if (title.length > MAX_SECTION_TITLE_LENGTH) {
        errors.push(
          `Section ${number} title is longer than ${MAX_SECTION_TITLE_LENGTH} characters`,
        );
      } else if (description.length > MAX_SECTION_DESCRIPTION_LENGTH) {
        errors.push(
          `Section ${number} description is longer than ${MAX_SECTION_DESCRIPTION_LENGTH} characters`,
        );
      }
      sections.push({ id: crypto.randomUUID(), title, description });
    }
    const sectionCount = sections.length + listedMandatoryIds.size;
    if (sectionCount === 0) errors.push('At least one section is required');
    if (sections.length > MAX_EDITABLE_SECTIONS) {
      errors.push(`At most ${MAX_EDITABLE_SECTIONS} sections are allowed`);
    }

    const outlet = cleanCell(record['default_outlet']).toUpperCase();
    if (outlet && outlet !== DefaultOutlet.EMAIL && outlet !== DefaultOutlet.MESSAGE) {
      errors.push('Default outlet must be EMAIL or MESSAGE');
    }

    const systemPrompt = cleanCell(record['system_prompt']);
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      errors.push(`System prompt is longer than ${MAX_SYSTEM_PROMPT_LENGTH} characters`);
    }

    // Not listed in the file means switched off, the same state a Scribe admin sets in the editor.
    const switchedOff = MANDATORY_SECTIONS.filter(({ id }) => !listedMandatoryIds.has(id)).map(
      ({ id }): SummaryTemplateSection => ({ id, title: '', description: '', disabled: true }),
    );

    return {
      line,
      name,
      sectionCount,
      errors,
      standardSections: MANDATORY_SECTIONS.filter(({ id }) => listedMandatoryIds.has(id)).map(
        ({ displayTitle }) => displayTitle,
      ),
      input:
        errors.length > 0
          ? null
          : {
              name,
              autoTriggerPrompt: meetingContext,
              sections: withMandatorySections([...sections, ...switchedOff]),
              systemPrompt,
              version: 1,
              defaultOutlet:
                outlet === DefaultOutlet.MESSAGE ? DefaultOutlet.MESSAGE : DefaultOutlet.EMAIL,
            },
    };
  });

  return { rows, fileError: null };
}
