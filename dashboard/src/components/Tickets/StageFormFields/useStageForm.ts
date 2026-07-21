import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import {
  FormEntityType,
  FormFieldType,
  isFieldActive,
  ReenterMode,
  TicketStageRequestStatus,
} from '@xyne/shared';
import type { FormEntityValues, Ticket, TicketStageRequest } from '@xyne/shared';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { apiInstance } from '../../../services/clients/apiClient';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import type { StageFormDocLocalChange } from './StageFormFields';
import {
  resolveDisplayFormFields,
  type ResolvedDisplayFormField,
} from '../../../utils/board/resolveDisplayFormFields';
import { buildLatestEntityWideValueByField } from '../../../utils/board/boardFormEntityValues';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

export type PersistMode = 'save' | 'submit' | 'move' | 'review';

export type StageVisitEta = {
  readonly id: string;
  readonly stageId: string;
  readonly version?: number | null;
  readonly stageEnteredAt: number;
};

export interface UseStageFormParams {
  ticket: Ticket;
  targetStage: Stage;
  formId: string;
  hasApprovers: boolean;
  isNonLinearBoard: boolean;
  reenterMode?: ReenterMode | null | undefined;
  targetStageEtas?: readonly StageVisitEta[] | undefined;
}

const serializeFormData = (formData: Record<string, string[]>): string =>
  JSON.stringify(
    Object.keys(formData)
      .sort()
      .reduce<Record<string, string[]>>((acc, key) => {
        acc[key] = formData[key] ?? [];
        return acc;
      }, {}),
  );

export const areFieldValuesEqual = (
  left: readonly string[] = [],
  right: readonly string[] = [],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

/** Visit version for the next write: max(ETA versions, stage form versions), then RESET/CONTINUE. */
export const computeFreshVisitVersion = (
  etas: readonly StageVisitEta[],
  maxFormVersion: number,
  reenterMode: ReenterMode,
): number => {
  const maxFromEtas = etas.length > 0 ? Math.max(...etas.map(eta => eta.version ?? 1)) : 0;
  const base = Math.max(maxFromEtas, maxFormVersion);
  if (base === 0) return 1;
  if (reenterMode === ReenterMode.CONTINUE) return base;
  return base + 1;
};

const asArray = <T>(value: T[] | readonly T[] | undefined | null): T[] =>
  Array.isArray(value) ? [...value] : [];

export interface UseStageFormResult {
  fields: ResolvedDisplayFormField[];
  valuesForRender: FormEntityValues[];
  isFieldsLoading: boolean;
  hydrated: boolean;
  formData: Record<string, string[]>;
  setFormData: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  localDocChanges: Map<string, StageFormDocLocalChange>;
  setLocalDocChanges: React.Dispatch<React.SetStateAction<Map<string, StageFormDocLocalChange>>>;
  isSaving: boolean;
  isUploadingDocs: boolean;
  isDirty: boolean;
  missingRequiredFields: ResolvedDisplayFormField[];
  isApproved: boolean;
  isSubmitted: boolean;
  hasActiveRequestForDocPrefill: boolean;
  getContentConflicts: () => StageFormFieldConflict[];
  applyConflictResolution: (resolution: Map<string, ConflictResolution>) => StageFormResolvedInputs;
  persistForm: (
    mode: PersistMode,
    overrides?: StageFormPersistOverrides,
  ) => Promise<Record<string, string[]> | null>;
  commitMove: (effectiveFormData?: Record<string, string[]>) => Promise<void>;
}

export type ConflictResolution = 'mine' | 'theirs';

export type StageFormFieldConflict = {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly fieldType: FormFieldType;
  readonly base: string[];
  readonly mine: string[];
  readonly theirs: string[];
  readonly theirsUpdatedAt: number | null;
  readonly localDocChange?: StageFormDocLocalChange;
};

export type StageFormResolvedInputs = {
  readonly formData: Record<string, string[]>;
  readonly localDocChanges: Map<string, StageFormDocLocalChange>;
};

type StageFormPersistOverrides = Partial<StageFormResolvedInputs>;

const toFieldValue = (actualFieldValue: unknown): string[] => {
  if (Array.isArray(actualFieldValue)) return actualFieldValue as string[];
  if (
    typeof actualFieldValue === 'string' ||
    typeof actualFieldValue === 'number' ||
    typeof actualFieldValue === 'boolean'
  ) {
    return [String(actualFieldValue)];
  }
  return [];
};

export const useStageForm = ({
  ticket,
  targetStage,
  formId,
  hasApprovers,
  isNonLinearBoard,
  reenterMode,
  targetStageEtas,
}: UseStageFormParams): UseStageFormResult => {
  const zero = useZero();
  const { user } = useAuth();

  const [membershipRows, formFieldsDetails] = useCachedQuery(
    queries.getFormFieldsByFormId({ formId }),
    { enabled: !!formId },
  );
  const resolvedFields = useMemo((): ResolvedDisplayFormField[] => {
    if (!formId) {
      return [];
    }

    return resolveDisplayFormFields(formId, asArray(membershipRows));
  }, [formId, membershipRows]);
  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticket.id }),
  );
  const [ticketStageRequestsForTicket] = useCachedQuery(
    queries.getTicketStageRequests({ ticketId: ticket.id }),
  );

  const [formData, setFormData] = useState<Record<string, string[]>>({});
  const [localDocChanges, setLocalDocChanges] = useState<Map<string, StageFormDocLocalChange>>(
    () => new Map(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [persistedSignature, setPersistedSignature] = useState('');

  const hydratedKeyRef = useRef<string | null>(null);
  const lastPersistedFormDataRef = useRef<Record<string, string[]>>({});
  const persistInFlightRef = useRef(false);
  const draftValueIdsRef = useRef<Map<string, string>>(new Map());
  const draftVersionRef = useRef(1);

  const fields = useMemo(() => resolvedFields, [resolvedFields]);
  const values = useMemo(
    () => (Array.isArray(formEntityValues) ? formEntityValues : []),
    [formEntityValues],
  );
  const requests = useMemo(
    () =>
      Array.isArray(ticketStageRequestsForTicket)
        ? (ticketStageRequestsForTicket as TicketStageRequest[])
        : [],
    [ticketStageRequestsForTicket],
  );

  const requestForStage = useMemo(
    () => requests.find(request => request.stageId === targetStage.id) ?? null,
    [requests, targetStage.id],
  );
  const existingRequest = useMemo(
    () =>
      requestForStage?.status === TicketStageRequestStatus.DRAFT ||
      requestForStage?.status === TicketStageRequestStatus.SUBMITTED
        ? requestForStage
        : null,
    [requestForStage],
  );
  const hasActiveRequest =
    existingRequest?.status === TicketStageRequestStatus.DRAFT ||
    existingRequest?.status === TicketStageRequestStatus.SUBMITTED;

  const maxStageVersion = useMemo(() => {
    const fieldIds = new Set(fields.map(field => field.id));
    return values
      .filter(value => value.contextId === targetStage.id && fieldIds.has(value.fieldId))
      .reduce((max, value) => Math.max(max, value.version ?? 1), 0);
  }, [fields, values, targetStage.id]);

  const isContinueReentry =
    isNonLinearBoard && reenterMode === ReenterMode.CONTINUE && maxStageVersion > 0;
  const shouldReuseExistingValueIds = !isNonLinearBoard || hasActiveRequest || isContinueReentry;
  const latestValueRowByField = useMemo(() => {
    const fieldIds = new Set(fields.map(field => field.id));
    const map = new Map<string, FormEntityValues>();
    values
      .filter(value => value.contextId === targetStage.id && fieldIds.has(value.fieldId))
      .forEach(value => {
        const current = map.get(value.fieldId);
        if (!current || (value.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
          map.set(value.fieldId, value);
        }
      });
    return map;
  }, [fields, targetStage.id, values]);

  const latestEntityWideValueByField = useMemo(() => {
    const fieldIds = new Set(fields.map(field => field.id));
    return buildLatestEntityWideValueByField(values, fieldIds);
  }, [fields, values]);
  const currentSavedFormData = useMemo(() => {
    const result: Record<string, string[]> = {};
    latestEntityWideValueByField.forEach((row, fieldId) => {
      result[fieldId] = toFieldValue(row.actualFieldValue);
    });
    return result;
  }, [latestEntityWideValueByField]);

  const stageEtasForTarget = useMemo(
    () => (targetStageEtas ?? []).filter(eta => eta.stageId === targetStage.id),
    [targetStage.id, targetStageEtas],
  );

  const resolveDraftVisitVersion = useCallback((): number => {
    const mode = (reenterMode as ReenterMode | undefined) ?? ReenterMode.RESET;
    // ID-reuse paths (CONTINUE / active request / linear) write at current max — do not bump.
    const versionMode = shouldReuseExistingValueIds ? ReenterMode.CONTINUE : mode;
    return computeFreshVisitVersion(stageEtasForTarget, maxStageVersion, versionMode);
  }, [maxStageVersion, reenterMode, shouldReuseExistingValueIds, stageEtasForTarget]);

  useEffect(() => {
    if (!Array.isArray(formEntityValues)) return;
    if (ticketStageRequestsForTicket === undefined) return;

    const hydrateKey = `${ticket.id}:${targetStage.id}:${formId}`;
    if (hydratedKeyRef.current === hydrateKey) {
      // Form values arrived before ETAs (common on StagePicker). Keep formData; bump version only.
      draftVersionRef.current = resolveDraftVisitVersion();
      return;
    }

    const prefilled: Record<string, string[]> = {};
    const draftIds = new Map<string, string>();

    fields.forEach(field => {
      const entityWideValue = latestEntityWideValueByField.get(field.id);
      if (shouldReuseExistingValueIds) {
        const stageValue = latestValueRowByField.get(field.id);
        if (stageValue) {
          draftIds.set(field.id, stageValue.id);
        }
      }
      if (!entityWideValue) return;
      const parsed = toFieldValue(entityWideValue.actualFieldValue);
      if (parsed.length > 0) prefilled[field.id] = parsed;
    });

    draftValueIdsRef.current = draftIds;
    draftVersionRef.current = resolveDraftVisitVersion();
    setFormData(prefilled);
    setLocalDocChanges(new Map());
    const signature = serializeFormData(prefilled);
    lastPersistedFormDataRef.current = prefilled;
    setPersistedSignature(signature);
    hydratedKeyRef.current = hydrateKey;
  }, [
    latestValueRowByField,
    latestEntityWideValueByField,
    fields,
    formEntityValues,
    formId,
    resolveDraftVisitVersion,
    shouldReuseExistingValueIds,
    targetStage.id,
    ticket.id,
    ticketStageRequestsForTicket,
  ]);

  useEffect(() => {
    if (hydratedKeyRef.current === null) return;
    let changed = false;
    const nextFormData = { ...formData };
    fields.forEach(field => {
      if (localDocChanges.has(field.id)) return;
      const base = lastPersistedFormDataRef.current[field.id] ?? [];
      const mine = formData[field.id] ?? [];
      if (!areFieldValuesEqual(mine, base)) return;
      const theirs = currentSavedFormData[field.id] ?? [];
      if (areFieldValuesEqual(theirs, base)) return;
      nextFormData[field.id] = theirs;
      lastPersistedFormDataRef.current = {
        ...lastPersistedFormDataRef.current,
        [field.id]: theirs,
      };
      changed = true;
    });
    if (changed) {
      setFormData(nextFormData);
      setPersistedSignature(serializeFormData(lastPersistedFormDataRef.current));
    }
  }, [currentSavedFormData, fields, formData, localDocChanges]);

  const isFieldFilled = useCallback(
    (field: ResolvedDisplayFormField): boolean => {
      const change = localDocChanges.get(field.id);
      if (change && 'file' in change) return true;
      if (change && 'removed' in change) return false;
      const value = formData[field.id];
      return !!(value && value.length > 0 && value[0] !== '');
    },
    [formData, localDocChanges],
  );

  const missingRequiredFields = useMemo(() => {
    const getFieldEffectiveValue = (fieldId: string): string | undefined => formData[fieldId]?.[0];
    return fields.filter(
      field =>
        !field.isOptional &&
        isFieldActive(field, fields, getFieldEffectiveValue) &&
        !isFieldFilled(field),
    );
  }, [fields, formData, isFieldFilled]);

  const resolveExistingValueId = useCallback(
    (fieldId: string): string | undefined => {
      const localId = draftValueIdsRef.current.get(fieldId);
      if (localId) return localId;
      if (!shouldReuseExistingValueIds) return undefined;
      return values
        .filter(value => value.fieldId === fieldId && value.contextId === targetStage.id)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id;
    },
    [shouldReuseExistingValueIds, targetStage.id, values],
  );

  const persistForm = useCallback(
    async (
      mode: PersistMode,
      overrides: StageFormPersistOverrides = {},
    ): Promise<Record<string, string[]> | null> => {
      if (!user?.id || fields.length === 0) return null;
      if (persistInFlightRef.current) return null;

      const formDataToPersist = overrides.formData ?? formData;
      const localDocChangesToPersist = overrides.localDocChanges ?? localDocChanges;
      persistInFlightRef.current = true;
      setIsSaving(true);
      try {
        // Recompute immediately before write so empty-ETA hydrate cannot leave version stuck at 1.
        draftVersionRef.current = resolveDraftVisitVersion();
        const timestamp = Date.now();
        const docUploadsByField = new Map<
          string,
          { file: File; formEntityValueId: string; existingValueId?: string }
        >();
        const docRemovedFields = new Set<string>();

        const getFormDataEffectiveValue = (fieldId: string): string | undefined =>
          formDataToPersist[fieldId]?.[0];

        fields.forEach(field => {
          if (field.fieldType !== FormFieldType.DOC) return;
          if (!isFieldActive(field, fields, getFormDataEffectiveValue)) return;
          const change = localDocChangesToPersist.get(field.id);
          if (!change) return;
          if ('file' in change) {
            const existingValueId = resolveExistingValueId(field.id);
            docUploadsByField.set(field.id, {
              file: change.file,
              formEntityValueId: existingValueId ?? uuidv4(),
              ...(existingValueId && { existingValueId }),
            });
          } else {
            docRemovedFields.add(field.id);
          }
        });
        setIsUploadingDocs(docUploadsByField.size > 0);
        const uploadedAttachmentIdByField = new Map<string, string>();
        for (const [fieldId, plan] of docUploadsByField) {
          const uploadForm = new FormData();
          uploadForm.append('files', plan.file);
          uploadForm.append('entityId', plan.formEntityValueId);
          uploadForm.append('entityType', 'FORM_ENTITY_VALUE');
          uploadForm.append(
            'fileMetadata',
            JSON.stringify([{ fileIndex: 0, hasThumbnail: false }]),
          );
          const response = await apiInstance.post('/attachments/upload', uploadForm, {
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'multipart/form-data',
            },
          });
          const attachmentId = (response.data as { attachments?: Array<{ id: string }> })
            ?.attachments?.[0]?.id;
          if (!attachmentId) {
            throw new Error('Upload succeeded but no attachment id returned');
          }
          uploadedAttachmentIdByField.set(fieldId, attachmentId);
        }
        setIsUploadingDocs(false);

        const effectiveFormData: Record<string, string[]> = { ...formDataToPersist };
        uploadedAttachmentIdByField.forEach((attachmentId, fieldId) => {
          effectiveFormData[fieldId] = [attachmentId];
        });
        docRemovedFields.forEach(fieldId => {
          effectiveFormData[fieldId] = [];
        });

        const getFieldEffectiveValue = (fieldId: string): string | undefined =>
          effectiveFormData[fieldId]?.[0];

        const mutationPromises: Promise<unknown>[] = [];
        fields.forEach(field => {
          if (!isFieldActive(field, fields, getFieldEffectiveValue)) return;
          const fieldValue = effectiveFormData[field.id] ?? [];
          const uploadPlan = docUploadsByField.get(field.id);
          const existingValueId = uploadPlan?.existingValueId ?? resolveExistingValueId(field.id);
          const previousFieldValue = lastPersistedFormDataRef.current[field.id] ?? [];
          const hasDocChange = docUploadsByField.has(field.id) || docRemovedFields.has(field.id);
          const hasFieldChange = !areFieldValuesEqual(fieldValue, previousFieldValue);
          if (!hasDocChange && !hasFieldChange) {
            return;
          }

          if (existingValueId) {
            draftValueIdsRef.current.set(field.id, existingValueId);
            const mutationResult = zero.mutate(
              mutators.formEntityValue.update({
                formEntityValueId: existingValueId,
                newValue: fieldValue,
                updatedAt: timestamp,
                expectedValueUpdatedAt:
                  values.find(v => v.id === existingValueId)?.updatedAt ?? null,
              }),
            );
            mutationPromises.push(mutationResult.server);
          } else {
            // Safety net: if a row already exists at this visit version (e.g. wrong create
            // path after reusable-field prefill), update it instead of colliding on unique key.
            const existingAtVersion = values.find(
              value =>
                value.fieldId === field.id &&
                value.contextId === targetStage.id &&
                (value.version ?? 1) === draftVersionRef.current &&
                // Ignore synthetic UI rows if they ever appear in the values list.
                !value.id.startsWith('placeholder-') &&
                !value.id.startsWith('prefill-'),
            );
            if (existingAtVersion) {
              draftValueIdsRef.current.set(field.id, existingAtVersion.id);
              const mutationResult = zero.mutate(
                mutators.formEntityValue.update({
                  formEntityValueId: existingAtVersion.id,
                  newValue: fieldValue,
                  updatedAt: timestamp,
                  expectedValueUpdatedAt: existingAtVersion.updatedAt ?? null,
                }),
              );
              mutationPromises.push(mutationResult.server);
            } else {
              const formEntityValueId =
                docUploadsByField.get(field.id)?.formEntityValueId ?? uuidv4();
              draftValueIdsRef.current.set(field.id, formEntityValueId);
              const mutationResult = zero.mutate(
                mutators.formEntityValue.createV2({
                  id: formEntityValueId,
                  entityId: ticket.id,
                  entityType: FormEntityType.TICKET,
                  fieldId: field.id,
                  formId,
                  newValue: fieldValue,
                  timestamp,
                  contextId: targetStage.id,
                  version: draftVersionRef.current,
                }),
              );
              mutationPromises.push(mutationResult.server);
            }
          }
        });

        if (hasApprovers && mode !== 'review') {
          const requestStatus =
            mode === 'submit' ? TicketStageRequestStatus.SUBMITTED : TicketStageRequestStatus.DRAFT;
          const requestId = existingRequest?.id ?? requestForStage?.id ?? uuidv4();
          const mutationResult = zero.mutate(
            mutators.ticketStageRequest.upsert({
              id: requestId,
              ticketId: ticket.id,
              stageId: targetStage.id,
              formId,
              status: requestStatus,
              updatedBy: user.id,
              updatedAt: timestamp,
              ...(mode === 'submit' &&
                existingRequest?.status !== TicketStageRequestStatus.SUBMITTED && {
                  requestActivityId: uuidv4(),
                }),
            }),
          );
          mutationPromises.push(mutationResult.server);
        }

        const mutationResults = await Promise.all(mutationPromises);
        const errorResult = mutationResults.find(
          (result): result is { type: 'error'; error?: { message?: string } } =>
            typeof result === 'object' &&
            result !== null &&
            'type' in result &&
            (result as { type?: string }).type === 'error',
        );
        if (errorResult) {
          throw new Error(errorResult.error?.message ?? 'Failed to save form');
        }

        const signature = serializeFormData(effectiveFormData);
        lastPersistedFormDataRef.current = effectiveFormData;
        setPersistedSignature(signature);
        setFormData(current => {
          let next = current;
          Object.entries(effectiveFormData).forEach(([fieldId, savedValue]) => {
            const startValue = formDataToPersist[fieldId] ?? [];
            const currentValue = current[fieldId] ?? [];
            if (
              areFieldValuesEqual(currentValue, startValue) &&
              !areFieldValuesEqual(currentValue, savedValue)
            ) {
              if (next === current) next = { ...current };
              next[fieldId] = savedValue;
            }
          });
          return next;
        });
        setLocalDocChanges(current => {
          let next = current;
          localDocChangesToPersist.forEach((change, fieldId) => {
            if (current.get(fieldId) === change) {
              if (next === current) next = new Map(current);
              next.delete(fieldId);
            }
          });
          return next;
        });
        return effectiveFormData;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save form');
        return null;
      } finally {
        persistInFlightRef.current = false;
        setIsUploadingDocs(false);
        setIsSaving(false);
      }
    },
    [
      existingRequest?.id,
      existingRequest?.status,
      fields,
      formData,
      formId,
      hasApprovers,
      localDocChanges,
      requestForStage?.id,
      resolveDraftVisitVersion,
      resolveExistingValueId,
      targetStage.id,
      ticket.id,
      user?.id,
      values,
      zero,
    ],
  );

  const commitMove = useCallback(
    async (effectiveFormData?: Record<string, string[]>): Promise<void> => {
      const timestamp = Date.now();
      if (isNonLinearBoard) {
        const source = effectiveFormData ?? formData;
        const formValuesByName: Record<string, unknown> = {};
        fields.forEach(field => {
          const value = source[field.id];
          if (value !== undefined) {
            formValuesByName[field.fieldName] = value.length === 1 ? value[0] : value;
          }
        });
        const mutationResult = zero.mutate(
          mutators.nonLinear.transition({
            ticketId: ticket.id,
            toStageName: targetStage.name,
            now: timestamp,
            formValuesJson: JSON.stringify(formValuesByName),
          }),
        );
        await mutationResult.client;
      } else {
        const mutationResult = zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            stageName: targetStage.name,
            ...(targetStage.defaultTicketStatusV2 && {
              statusV2: targetStage.defaultTicketStatusV2,
            }),
            updatedAt: timestamp,
          }),
        );
        await mutationResult.client;
      }
    },
    [
      fields,
      formData,
      isNonLinearBoard,
      targetStage.defaultTicketStatusV2,
      targetStage.name,
      ticket.id,
      zero,
    ],
  );

  const isApproved = requestForStage?.status === TicketStageRequestStatus.APPROVED;
  const isSubmitted = requestForStage?.status === TicketStageRequestStatus.SUBMITTED;
  const isDirty = localDocChanges.size > 0 || serializeFormData(formData) !== persistedSignature;

  const getContentConflicts = useCallback((): StageFormFieldConflict[] => {
    return fields.flatMap(field => {
      const base = lastPersistedFormDataRef.current[field.id] ?? [];
      const theirs = currentSavedFormData[field.id] ?? [];
      const mine = formData[field.id] ?? [];
      const localDocChange = localDocChanges.get(field.id);
      const iEdited = localDocChange !== undefined || !areFieldValuesEqual(mine, base);
      const dbChanged = !areFieldValuesEqual(theirs, base);
      const valuesClash = localDocChange !== undefined || !areFieldValuesEqual(mine, theirs);
      if (!(iEdited && dbChanged && valuesClash)) return [];
      return [
        {
          fieldId: field.id,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          base,
          mine,
          theirs,
          theirsUpdatedAt: latestEntityWideValueByField.get(field.id)?.updatedAt ?? null,
          ...(localDocChange && { localDocChange }),
        },
      ];
    });
  }, [fields, formData, currentSavedFormData, latestEntityWideValueByField, localDocChanges]);

  const applyConflictResolution = useCallback(
    (resolution: Map<string, ConflictResolution>): StageFormResolvedInputs => {
      const nextFormData = { ...formData };
      const nextDocChanges = new Map(localDocChanges);
      resolution.forEach((choice, fieldId) => {
        const latestRow = latestValueRowByField.get(fieldId);
        const theirs = currentSavedFormData[fieldId] ?? [];
        if (latestRow) draftValueIdsRef.current.set(fieldId, latestRow.id);
        lastPersistedFormDataRef.current = {
          ...lastPersistedFormDataRef.current,
          [fieldId]: theirs,
        };
        if (choice === 'theirs') {
          nextFormData[fieldId] = theirs;
          nextDocChanges.delete(fieldId);
        }
      });
      setFormData(nextFormData);
      setLocalDocChanges(nextDocChanges);
      return { formData: nextFormData, localDocChanges: nextDocChanges };
    },
    [formData, localDocChanges, currentSavedFormData, latestValueRowByField],
  );

  return {
    fields,
    valuesForRender: values,
    isFieldsLoading: formFieldsDetails.type !== 'complete',
    hydrated: hydratedKeyRef.current !== null,
    formData,
    setFormData,
    localDocChanges,
    setLocalDocChanges,
    isSaving,
    isUploadingDocs,
    isDirty,
    missingRequiredFields,
    isApproved,
    isSubmitted,
    hasActiveRequestForDocPrefill: !isNonLinearBoard || hasActiveRequest,
    getContentConflicts,
    applyConflictResolution,
    persistForm,
    commitMove,
  };
};
