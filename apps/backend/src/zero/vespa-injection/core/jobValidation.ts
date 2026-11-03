import { fileSchema, samTranscriptSchema, SubApp, VESPA_SCHEMAS } from '@/vespa/src/types';
import type { VespaJob, VespaJobType } from './types';

const JOB_TYPES: readonly VespaJobType[] = ['feed', 'update', 'delete'];
const SUB_APPS = new Set<string>(Object.values(SubApp));
const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@+=-]{0,255}$/;

export const isValidVespaDocId = (docId: unknown): docId is string =>
  typeof docId === 'string' && DOC_ID_PATTERN.test(docId);

export const validateVespaJob = (
  job: unknown,
  options: { allowFileSchema: boolean },
): string | null => {
  if (!job || typeof job !== 'object') return 'job data is not an object';
  const { schema, jobType, docId, app, data, fields } = job as Partial<VespaJob>;

  if (typeof schema !== 'string' || !(VESPA_SCHEMAS as string[]).includes(schema)) return 'unknown schema';
  if (schema === fileSchema && !options.allowFileSchema) return 'file schema not accepted here';
  if (typeof jobType !== 'string' || !JOB_TYPES.includes(jobType as VespaJobType)) return 'unknown jobType';
  if (!isValidVespaDocId(docId)) return 'invalid docId';
  if (app !== undefined && app !== null && !SUB_APPS.has(app)) return 'unknown app';
  if (fields !== undefined && (!Array.isArray(fields) || fields.some((f) => typeof f !== 'string'))) {
    return 'invalid fields';
  }

  if (schema === samTranscriptSchema && jobType !== 'delete') {
    if (!data || typeof data !== 'object') return 'SAM transcript job missing data';
    if ((data as { docId?: unknown }).docId !== docId) return 'SAM transcript data.docId does not match docId';
  }

  return null;
};
