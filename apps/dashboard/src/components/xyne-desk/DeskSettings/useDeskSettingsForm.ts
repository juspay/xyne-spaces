import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { EmailMergeMode, AutoDraftMode, ChannelType, ChannelRole } from '@xyne/shared';
import { useEmailChannelPreference } from '../../../hooks/useEmailChannelPreference';
import {
  useDeskChannelPreferenceAutoSave,
  type ChannelPreferencePatch,
} from '../../../hooks/useDeskChannelPreferenceAutoSave';
import { useEmailClassification } from '../../../hooks/useEmailClassification';
import { usePriorityClassification } from '../../../hooks/usePriorityClassification';
import { useDeskTagsConfig } from '../../../hooks/useDeskTagsConfig';
import { useVisibleChannel } from '../../../hooks/useChannels';
import { useChannelClawAgents } from '../../../hooks/useChannelClawAgents';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { DEFAULT_PRIORITY_PROMPT } from './constants';
import type { SaveMappingPayload, ClassificationMapping } from '../../../types/classification';

export const parseDefaultCc = (val: string | undefined | null): string[] =>
  val
    ? val
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];

const parseFrtStageNames = (val: string | undefined | null): string[] => {
  if (!val) return [];
  try {
    const parsed: unknown = JSON.parse(val);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

type DraftShape = Record<string, string | number | boolean | null>;

function useDraft<T extends DraftShape>(server: T) {
  const [draft, setDraft] = useState<T>(server);
  const [syncedServer, setSyncedServer] = useState<T>(server);
  const serverKey = JSON.stringify(server);
  const syncedKey = JSON.stringify(syncedServer);

  if (serverKey !== syncedKey) {
    setDraft(current => {
      let changed = false;
      const next = { ...current };
      (Object.keys(server) as (keyof T)[]).forEach(key => {
        const userEdited = !Object.is(current[key], syncedServer[key]);
        if (!userEdited && !Object.is(current[key], server[key])) {
          next[key] = server[key];
          changed = true;
        }
      });
      return changed ? next : current;
    });
    setSyncedServer(server);
  }

  const setField = useCallback(
    <K extends keyof T>(key: K, value: T[K] | ((prev: T[K]) => T[K])) => {
      setDraft(current => {
        const nextVal =
          typeof value === 'function' ? (value as (prev: T[K]) => T[K])(current[key]) : value;
        return Object.is(current[key], nextVal) ? current : { ...current, [key]: nextVal };
      });
    },
    [],
  );

  const reset = () => setDraft(server);

  const dirty = (Object.keys(server) as (keyof T)[]).some(k => !Object.is(draft[k], server[k]));

  return { draft, server, setField, reset, dirty };
}

const mappingsKey = (list: ClassificationMapping[]): string =>
  list
    .map(m => `${m.id} ${m.category} ${m.subCategory ?? ''} ${m.userGroupId}`)
    .sort()
    .join('');

export function useDeskSettingsForm(
  channelId: string | null,
  userID: string | null | undefined,
  open: boolean,
) {
  const emailChannelPreference = useEmailChannelPreference(channelId);
  const { savePreference } = useDeskChannelPreferenceAutoSave(channelId);
  const selectedChannelForSettings = useVisibleChannel(channelId ?? '');
  const channelType = selectedChannelForSettings?.type;
  const isEmail = channelType === ChannelType.EMAIL;
  const isSlack = channelType === ChannelType.SLACK;
  const isApp = channelType === ChannelType.APP;
  const isSocial = channelType === ChannelType.SOCIAL_MEDIA;
  const isCall = channelType === ChannelType.CALL;
  const currentInboxOwnerUserId = emailChannelPreference?.ownerUserId ?? null;
  const [channelParticipants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    { enabled: !!channelId },
  );
  const isChannelAdmin =
    !!userID &&
    (channelParticipants ?? []).some(p => p.userId === userID && p.role === ChannelRole.ADMIN);
  const isDeskOwner = !!userID && currentInboxOwnerUserId === userID;

  const canManage = isDeskOwner || isChannelAdmin;

  const clawAgents = useChannelClawAgents(channelId);
  const [aiFeatureConfig, setAiFeatureConfig] = useState<
    'none' | 'auto-classification' | 'priority' | 'tag-generation'
  >('none');
  const [saving, setSaving] = useState(false);

  const {
    categories: tagCategories,
    isLoading: isTagConfigLoading,
    isSaving: isTagConfigSaving,
    error: tagConfigError,
    saveCategories: saveTagCategories,
  } = useDeskTagsConfig(channelId, !!channelId);

  const {
    config: classificationConfig,
    saveConfig: saveClassificationConfig,
    createMapping: persistCreateMapping,
    updateMapping: persistUpdateMapping,
    deleteMapping: persistDeleteMapping,
    previewResult: classificationPreviewResult,
    isPreviewing: isClassificationPreviewing,
    runPreview: runClassificationPreview,
    error: classificationError,
  } = useEmailClassification(channelId ?? '', !!channelId);

  const serverMappings: ClassificationMapping[] = classificationConfig?.mappings ?? [];
  const serverMappingsKey = mappingsKey(serverMappings);
  const [mappingsDraft, setMappingsDraft] = useState<ClassificationMapping[]>(serverMappings);
  const [syncedMappingsKey, setSyncedMappingsKey] = useState(serverMappingsKey);
  if (serverMappingsKey !== syncedMappingsKey) {
    if (mappingsKey(mappingsDraft) === syncedMappingsKey) setMappingsDraft(serverMappings);
    setSyncedMappingsKey(serverMappingsKey);
  }
  const mappingsDirty = mappingsKey(mappingsDraft) !== serverMappingsKey;

  const addMapping = (payload: SaveMappingPayload) => {
    if (!canManage) return;
    setMappingsDraft(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        channelId: channelId ?? '',
        category: payload.category,
        subCategory: payload.subCategory ?? null,
        userGroupId: payload.userGroupId,
        createdAt: Date.now(),
      },
    ]);
  };
  const updateMappingDraft = (id: string, payload: Partial<SaveMappingPayload>) => {
    if (!canManage) return;
    setMappingsDraft(prev =>
      prev.map(m =>
        m.id === id
          ? {
              ...m,
              ...(payload.category !== undefined ? { category: payload.category } : {}),
              ...(payload.subCategory !== undefined
                ? { subCategory: payload.subCategory ?? null }
                : {}),
              ...(payload.userGroupId !== undefined ? { userGroupId: payload.userGroupId } : {}),
            }
          : m,
      ),
    );
  };
  const deleteMappingDraft = (id: string) => {
    if (!canManage) return;
    setMappingsDraft(prev => prev.filter(m => m.id !== id));
  };

  const {
    config: priorityConfig,
    saveConfig: savePriorityConfig,
    previewResult: priorityPreviewResult,
    isPreviewing: isPriorityPreviewing,
    runPreview: runPriorityPreview,
    error: priorityError,
  } = usePriorityClassification(channelId ?? '');

  const pref = useDraft({
    ownerUserId: emailChannelPreference?.ownerUserId ?? '',
    sendAsEmail: emailChannelPreference?.sendAsEmail ?? '',
    defaultCc: parseDefaultCc(emailChannelPreference?.defaultCc).join(','),
    assigneeUserGroupId: emailChannelPreference?.assigneeUserGroupId ?? '',
    autoMergeEmails: emailChannelPreference?.emailMergeMode === EmailMergeMode.ENABLED,
    twoStepSendEnabled: emailChannelPreference?.twoStepSendEnabled ?? false,
    autoAIDraft: emailChannelPreference?.autoDraftMode === AutoDraftMode.DRAFT,
    autoDraftAgentSlug: emailChannelPreference?.autoDraftAgentSlug ?? null,
    metricsEnabled: emailChannelPreference?.metricsEnabled ?? false,
    frtStageNames: emailChannelPreference?.frtStageNames ?? '[]',
    appWebhookDeliveryEnabled: emailChannelPreference?.appWebhookDeliveryEnabled ?? true,
    deskReportEnabled: emailChannelPreference?.deskReportEnabled ?? false,
    deskReportAgentSlug: emailChannelPreference?.deskReportAgentSlug ?? null,
    deskReportRangeDays: emailChannelPreference?.deskReportRangeDays ?? 1,
  });
  const cls = useDraft({
    enabled: classificationConfig?.enabled ?? false,
    classificationPrompt: classificationConfig?.classificationPrompt ?? '',
    categoryField: classificationConfig?.categoryField ?? '',
    subCategoryField: classificationConfig?.subCategoryField ?? '',
  });
  const pri = useDraft({
    enabled: priorityConfig?.enabled ?? false,
    prompt: priorityConfig?.priorityClassificationPrompt ?? DEFAULT_PRIORITY_PROMPT,
    threshold: priorityConfig?.priorityClassificationThreshold ?? 0.5,
  });

  useEffect(() => {
    if (open) setAiFeatureConfig('none');
  }, [open]);

  const ownerId = pref.draft.ownerUserId;
  const sendAsAlias = pref.draft.sendAsEmail;
  const ccEmails = parseDefaultCc(pref.draft.defaultCc);
  const defaultAssigneeGroupId = pref.draft.assigneeUserGroupId;
  const autoMergeEmails = pref.draft.autoMergeEmails;
  const twoStepSend = pref.draft.twoStepSendEnabled;
  const autoAIDraft = pref.draft.autoAIDraft;
  const autoAIDraftSaved = emailChannelPreference?.autoDraftMode === AutoDraftMode.DRAFT;
  const autoDraftAgentSlug = pref.draft.autoDraftAgentSlug;
  const metricsEnabled = pref.draft.metricsEnabled;
  const frtStageNames = parseFrtStageNames(pref.draft.frtStageNames);
  const appWebhookDeliveryEnabled = pref.draft.appWebhookDeliveryEnabled;
  const deskReportEnabled = pref.draft.deskReportEnabled;
  const deskReportAgentSlug = pref.draft.deskReportAgentSlug;
  const deskReportRangeDays = pref.draft.deskReportRangeDays;
  const boardId = emailChannelPreference?.boardId ?? null;
  const classificationEnabledDraft = cls.draft.enabled;
  const classificationEnabledSaved = classificationConfig?.enabled ?? false;
  const classificationPromptDraft = cls.draft.classificationPrompt;
  const categoryFieldDraft = cls.draft.categoryField;
  const subCategoryFieldDraft = cls.draft.subCategoryField;
  const priorityEnabledDraft = pri.draft.enabled;
  const priorityEnabledSaved = priorityConfig?.enabled ?? false;
  const priorityPromptDraft = pri.draft.prompt;
  const priorityThresholdDraft = pri.draft.threshold;

  const setOwner = (next: string) => {
    if (!canManage || !next) return;
    pref.setField('ownerUserId', next);
  };
  const setSendAsAlias = (next: string) => pref.setField('sendAsEmail', next);
  const setCcEmails = (updater: string[] | ((prev: string[]) => string[])) => {
    pref.setField('defaultCc', prevStr => {
      const prevArr = parseDefaultCc(prevStr);
      const nextArr = typeof updater === 'function' ? updater(prevArr) : updater;
      return nextArr.join(',');
    });
  };
  const setAssigneeGroup = (next: string) =>
    pref.setField('assigneeUserGroupId', next === 'none' ? '' : next);
  const setAutoMergeEmails = (checked: boolean) => pref.setField('autoMergeEmails', checked);
  const setTwoStepSend = (checked: boolean) => pref.setField('twoStepSendEnabled', checked);
  const setAutoAIDraft = (checked: boolean) => pref.setField('autoAIDraft', checked);
  const setAutoDraftAgentSlug = (slug: string | null) => pref.setField('autoDraftAgentSlug', slug);
  const setMetricsEnabled = (checked: boolean) => {
    if (!canManage) return;
    pref.setField('metricsEnabled', checked);
  };
  const setAppWebhookDeliveryEnabled = (checked: boolean) => {
    if (!canManage) return;
    pref.setField('appWebhookDeliveryEnabled', checked);
  };
  const setDeskReportEnabled = (checked: boolean) => {
    if (!canManage) return;
    pref.setField('deskReportEnabled', checked);
  };
  const setDeskReportAgentSlug = (slug: string | null) =>
    pref.setField('deskReportAgentSlug', slug);
  const setDeskReportRangeDays = (days: number) => pref.setField('deskReportRangeDays', days);
  const setFrtStageNames = (updater: string[] | ((prev: string[]) => string[])) => {
    if (!canManage) return;
    pref.setField('frtStageNames', prevStr => {
      const prevArr = parseFrtStageNames(prevStr);
      const nextArr = typeof updater === 'function' ? updater(prevArr) : updater;
      return JSON.stringify(nextArr);
    });
  };

  const setClassificationEnabled = (checked: boolean) => {
    if (!canManage) return;
    if (checked && !(classificationPromptDraft.trim() && categoryFieldDraft.trim())) {
      toast.error('Configure classification first', {
        description: 'Add a classification prompt and category before enabling.',
        action: { label: 'Configure', onClick: () => setAiFeatureConfig('auto-classification') },
      });
      return;
    }
    cls.setField('enabled', checked);
  };
  const setClassificationPromptDraft = (next: string) => cls.setField('classificationPrompt', next);
  const setCategoryFieldDraft = (next: string) => cls.setField('categoryField', next);
  const setSubCategoryFieldDraft = (next: string) => cls.setField('subCategoryField', next);

  const setPriorityEnabled = (checked: boolean) => {
    if (!canManage) return;
    pri.setField('enabled', checked);
  };
  const setPriorityPromptDraft = (next: string) => pri.setField('prompt', next);
  const setPriorityThresholdDraft = (next: number) => pri.setField('threshold', next);
  const isDirty = pref.dirty || cls.dirty || pri.dirty || mappingsDirty;

  const trimmedSendAs = sendAsAlias.trim();
  const sendAsAliasError =
    trimmedSendAs.length > 0 && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(trimmedSendAs)
      ? 'Enter a single valid email address (e.g. support@company.com).'
      : null;

  const classificationConfigError =
    classificationEnabledDraft && !(categoryFieldDraft.trim() && classificationPromptDraft.trim())
      ? 'Add a category and a prompt before enabling auto-classification.'
      : null;

  const save = async () => {
    if (!channelId || !isDirty) return;
    if (sendAsAliasError) {
      toast.error('Invalid send-as alias', { description: sendAsAliasError });
      return;
    }
    if (classificationConfigError) {
      toast.error('Incomplete classification config', { description: classificationConfigError });
      return;
    }
    setSaving(true);
    try {
      const d = pref.draft;
      const s = pref.server;
      const patch: ChannelPreferencePatch = {};
      if (d.ownerUserId !== s.ownerUserId && d.ownerUserId) patch.ownerUserId = d.ownerUserId;
      if (d.sendAsEmail !== s.sendAsEmail) patch.sendAsEmail = d.sendAsEmail.trim() || null;
      if (d.defaultCc !== s.defaultCc) patch.defaultCc = d.defaultCc || null;
      if (d.assigneeUserGroupId !== s.assigneeUserGroupId) {
        patch.assigneeUserGroupId = d.assigneeUserGroupId || null;
      }
      if (d.autoMergeEmails !== s.autoMergeEmails) {
        patch.emailMergeMode = d.autoMergeEmails ? EmailMergeMode.ENABLED : EmailMergeMode.DISABLED;
      }
      if (d.twoStepSendEnabled !== s.twoStepSendEnabled) {
        patch.twoStepSendEnabled = d.twoStepSendEnabled;
      }
      if (d.autoAIDraft !== s.autoAIDraft) {
        patch.autoDraftMode = d.autoAIDraft ? AutoDraftMode.DRAFT : AutoDraftMode.OFF;
      }
      if (d.autoDraftAgentSlug !== s.autoDraftAgentSlug) {
        patch.autoDraftAgentSlug = d.autoDraftAgentSlug;
      }
      if (d.metricsEnabled !== s.metricsEnabled) {
        patch.metricsEnabled = d.metricsEnabled;
      }
      if (d.appWebhookDeliveryEnabled !== s.appWebhookDeliveryEnabled) {
        patch.appWebhookDeliveryEnabled = d.appWebhookDeliveryEnabled;
      }
      if (d.frtStageNames !== s.frtStageNames) {
        const names = parseFrtStageNames(d.frtStageNames);
        patch.frtStageNames = names.length > 0 ? JSON.stringify(names) : null;
      }
      if (d.deskReportEnabled !== s.deskReportEnabled) {
        patch.deskReportEnabled = d.deskReportEnabled;
      }
      if (d.deskReportAgentSlug !== s.deskReportAgentSlug) {
        patch.deskReportAgentSlug = d.deskReportAgentSlug;
      }
      if (d.deskReportRangeDays !== s.deskReportRangeDays) {
        patch.deskReportRangeDays = d.deskReportRangeDays;
      }

      if (cls.dirty) {
        await saveClassificationConfig({
          enabled: cls.draft.enabled,
          classificationPrompt: cls.draft.classificationPrompt,
          categoryField: cls.draft.categoryField,
          subCategoryField: cls.draft.subCategoryField || null,
        });
      }

      if (pri.dirty) {
        const trimmedPrompt = pri.draft.prompt.trim();
        const promptToSave =
          trimmedPrompt && trimmedPrompt !== DEFAULT_PRIORITY_PROMPT.trim()
            ? pri.draft.prompt
            : null;
        await savePriorityConfig({
          enabled: pri.draft.enabled,
          priorityClassificationPrompt: promptToSave,
          priorityClassificationThreshold: pri.draft.threshold,
        });
      }

      if (mappingsDirty) {
        const serverById = new Map(serverMappings.map(m => [m.id, m]));
        const draftIds = new Set(mappingsDraft.map(m => m.id));
        for (const m of mappingsDraft) {
          const existing = serverById.get(m.id);
          if (!existing) {
            await persistCreateMapping({
              id: m.id,
              category: m.category,
              subCategory: m.subCategory,
              userGroupId: m.userGroupId,
              createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
            });
          } else if (
            existing.category !== m.category ||
            (existing.subCategory ?? null) !== (m.subCategory ?? null) ||
            existing.userGroupId !== m.userGroupId
          ) {
            await persistUpdateMapping(m.id, {
              category: m.category,
              subCategory: m.subCategory,
              userGroupId: m.userGroupId,
            });
          }
        }
        for (const m of serverMappings) {
          if (!draftIds.has(m.id)) await persistDeleteMapping(m.id);
        }
      }

      if (Object.keys(patch).length > 0) await savePreference(patch);
    } catch {
      toast.error('Failed to save desk settings', { description: 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    pref.reset();
    cls.reset();
    pri.reset();
    setMappingsDraft(serverMappings);
  };

  const openClassificationConfig = useCallback(() => setAiFeatureConfig('auto-classification'), []);
  const openPriorityConfig = useCallback(() => setAiFeatureConfig('priority'), []);

  const openTagGenerationConfig = useCallback(() => {
    setAiFeatureConfig('tag-generation');
  }, []);

  return {
    canManage,
    isEmail,
    isSlack,
    isApp,
    isSocial,
    isCall,
    isDirty,
    saving,
    save,
    cancel,
    ownerId,
    setOwner,
    sendAsAlias,
    setSendAsAlias,
    sendAsAliasError,
    classificationConfigError,
    ccEmails,
    setCcEmails,
    defaultAssigneeGroupId,
    setAssigneeGroup,
    autoMergeEmails,
    setAutoMergeEmails,
    twoStepSend,
    setTwoStepSend,
    autoAIDraft,
    autoAIDraftSaved,
    setAutoAIDraft,
    autoDraftAgentSlug,
    setAutoDraftAgentSlug,
    metricsEnabled,
    setMetricsEnabled,
    frtStageNames,
    setFrtStageNames,
    appWebhookDeliveryEnabled,
    setAppWebhookDeliveryEnabled,
    deskReportEnabled,
    setDeskReportEnabled,
    deskReportAgentSlug,
    setDeskReportAgentSlug,
    deskReportRangeDays,
    setDeskReportRangeDays,
    boardId,
    clawAgents,
    classificationEnabledDraft,
    classificationEnabledSaved,
    setClassificationEnabled,
    priorityEnabledDraft,
    priorityEnabledSaved,
    setPriorityEnabled,
    classificationPromptDraft,
    setClassificationPromptDraft,
    categoryFieldDraft,
    setCategoryFieldDraft,
    subCategoryFieldDraft,
    setSubCategoryFieldDraft,
    classificationMappings: mappingsDraft,
    saveClassificationMapping: addMapping,
    updateClassificationMapping: updateMappingDraft,
    deleteClassificationMapping: deleteMappingDraft,
    classificationPreviewResult,
    isClassificationPreviewing,
    runClassificationPreview,
    classificationError,
    priorityPromptDraft,
    setPriorityPromptDraft,
    priorityThresholdDraft,
    setPriorityThresholdDraft,
    priorityPreviewResult,
    isPriorityPreviewing,
    runPriorityPreview,
    priorityError,
    aiFeatureConfig,
    setAiFeatureConfig,
    openClassificationConfig,
    openPriorityConfig,
    openTagGenerationConfig,
    tagCategories,
    isTagConfigLoading,
    isTagConfigSaving,
    tagConfigError,
    saveTagCategories,
    channelId,
  };
}
