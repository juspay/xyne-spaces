import { ReactElement, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from '@xyne/icons';

/**
 * Shared form-submission rendering + matching used by BOTH the Details activity timeline
 * (TicketActivity) and the Messages thread (TicketActivityMessage → StageMoveFormBlock), so the
 * "Form submission · N fields" block stays visually and behaviourally identical in both places.
 */

export type FormValueEntry = {
  id: string;
  fieldId: string;
  fieldValue?: unknown;
  actualFieldValue?: unknown;
  formField?: { fieldName?: string | null } | null;
  globalField?: { fieldName?: string | null } | null;
  // Used by buildStageVisitFormValues (grouping/timestamps); not needed for rendering.
  contextId?: string | null;
  version?: number | null;
  createdAt?: number | string | null;
};

export type StageVisitFormValues<T extends FormValueEntry = FormValueEntry> = {
  stageName: string;
  stageId: string;
  version: number;
  enteredAt: number;
  formValues: T[];
};

/**
 * Group persisted form values into per-stage-visit submissions, keyed by contextId (stageId) +
 * version. Stage names are resolved from the board's stages; entered-at is the earliest value's
 * createdAt. Mirrors the grouping the Details page computes.
 */
export const buildStageVisitFormValues = <T extends FormValueEntry>(
  formEntityValues: T[] | undefined,
  stages: ReadonlyArray<{ id: string; name: string }> | undefined,
): StageVisitFormValues<T>[] => {
  // Only values scoped to a stage of this board are stage-visit submissions. Board-level custom
  // fields (contextId = boardId) are excluded here, matching the Details page.
  const stageIds = new Set((stages ?? []).map(s => s.id));
  const withStage = (formEntityValues ?? []).filter(
    fv => typeof fv.contextId === 'string' && stageIds.has(fv.contextId),
  );

  const groups = new Map<string, T[]>();
  for (const fv of withStage) {
    const key = `${fv.contextId}:${fv.version ?? 1}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(fv);
    groups.set(key, bucket);
  }

  return Array.from(groups.entries())
    .map(([key, fvs]) => {
      const stageId = key.split(':')[0] ?? '';
      const version = fvs[0]?.version ?? 1;
      const stage = stages?.find(s => s.id === stageId);
      const enteredAt = Math.min(...fvs.map(fv => new Date(fv.createdAt ?? Date.now()).getTime()));
      return {
        stageName: stage?.name ?? stageId,
        stageId,
        version,
        enteredAt,
        formValues: fvs,
      };
    })
    .sort((a, b) => a.enteredAt - b.enteredAt);
};

/**
 * Match a stage-move event to its form submission: same target stage, submitted at/around the
 * move (60s tolerance), most recent first. Identical to the Details page's matching so both
 * surfaces resolve the same submission for a given move.
 */
export const matchFormVisit = (
  stageVisitFormValues: StageVisitFormValues[],
  toStageName: string | undefined,
  activityTimestamp: number | string | Date,
): StageVisitFormValues | undefined => {
  if (!toStageName) return undefined;
  return stageVisitFormValues
    .filter(sv => sv.stageName === toStageName)
    .filter(sv => sv.enteredAt <= new Date(activityTimestamp).getTime() + 60_000)
    .sort((a, b) => b.enteredAt - a.enteredAt)[0];
};

const renderFormFieldValue = (fv: FormValueEntry): string => {
  const raw = fv.actualFieldValue ?? fv.fieldValue;
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw as string | number | boolean);
};

/**
 * The collapsible "Form submission · N fields" block. Collapsed by default; expands on click.
 * Rendering lives here so the Details timeline and the Messages thread share one implementation.
 */
export const FormSubmissionBlock = ({
  formValues,
  version,
  defaultExpanded = false,
}: {
  formValues: FormValueEntry[];
  version: number;
  defaultExpanded?: boolean;
}): ReactElement | null => {
  const [formExpanded, setFormExpanded] = useState(defaultExpanded);

  if (formValues.length === 0) return null;

  return (
    <div className='mt-2'>
      <button
        type='button'
        onClick={() => setFormExpanded(prev => !prev)}
        data-track-category='ticket_activity'
        data-track-name='toggle_form_submission'
        className='inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors'
      >
        {formExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <FileText size={11} />
        <span>
          Form submission
          {version > 1 && ` (visit #${version})`}
          {' · '}
          {formValues.length} field
          {formValues.length !== 1 ? 's' : ''}
        </span>
      </button>
      {formExpanded && (
        <div className='mt-1.5 rounded-md border border-border bg-muted/30 divide-y divide-border overflow-hidden'>
          {formValues.map(fv => (
            <div key={fv.id} className='px-3 py-2 flex items-start justify-between gap-4'>
              <span className='text-[11px] text-muted-foreground shrink-0'>
                {fv.globalField?.fieldName ?? fv.formField?.fieldName ?? fv.fieldId}
              </span>
              <span className='text-[11px] text-foreground text-right break-words min-w-0'>
                {renderFormFieldValue(fv)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
