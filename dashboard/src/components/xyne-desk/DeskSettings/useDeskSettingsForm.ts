import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { EmailMergeMode, AutoDraftMode, ChannelType } from '@xyne/shared';
import { useEmailChannelPreference } from '../../../hooks/useEmailChannelPreference';
import { useDeskChannelPreferenceAutoSave } from '../../../hooks/useDeskChannelPreferenceAutoSave';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useEmailClassification } from '../../../hooks/useEmailClassification';
import { usePriorityClassification } from '../../../hooks/usePriorityClassification';
import { useVisibleChannel } from '../../../hooks/useChannels';
import { useChannelClawAgents } from '../../../hooks/useChannelClawAgents';
import type { SaveConfigPayload } from '../../../types/classification';

export const parseDefaultCc = (val: string | undefined | null): string[] =>
  val
    ? val
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];

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
  const currentInboxOwnerUserId = emailChannelPreference?.ownerUserId ?? null;
  const canManage =
    !!userID &&
    !!selectedChannelForSettings &&
    (selectedChannelForSettings.createdBy === userID || currentInboxOwnerUserId === userID);

  const savedSendAsEmail = emailChannelPreference?.sendAsEmail ?? '';
  const canViewSendAs = canManage || savedSendAsEmail.trim().length > 0;

  const [ownerId, setOwnerId] = useState(emailChannelPreference?.ownerUserId ?? '');
  const [sendAsAlias, setSendAsAlias] = useState(emailChannelPreference?.sendAsEmail ?? '');
  const [ccEmails, setCcEmails] = useState<string[]>(
    parseDefaultCc(emailChannelPreference?.defaultCc),
  );
  const [defaultAssigneeGroupId, setDefaultAssigneeGroupId] = useState(
    emailChannelPreference?.assigneeUserGroupId ?? '',
  );
  const [autoMergeEmails, setAutoMergeEmails] = useState(
    emailChannelPreference?.emailMergeMode === EmailMergeMode.ENABLED,
  );
  const [autoAIDraft, setAutoAIDraft] = useState(
    emailChannelPreference?.autoDraftMode === AutoDraftMode.DRAFT,
  );
  const [autoDraftAgentSlug, setAutoDraftAgentSlug] = useState<string | null>(
    emailChannelPreference?.autoDraftAgentSlug ?? null,
  );
  const clawAgents = useChannelClawAgents(channelId);

  const debouncedSendAs = useDebouncedValue(sendAsAlias, 500);
  const skipSendAsSave = useRef(true);
  const skipCcSave = useRef(true);
  const [aiFeatureConfig, setAiFeatureConfig] = useState<
    'none' | 'auto-classification' | 'priority'
  >('none');

  const {
    config: classificationConfig,
    saveConfig: saveClassificationConfig,
    createMapping: saveClassificationMapping,
    updateMapping: updateClassificationMapping,
    deleteMapping: deleteClassificationMapping,
    previewResult: classificationPreviewResult,
    isPreviewing: isClassificationPreviewing,
    isSaving: isClassificationSaving,
    runPreview: runClassificationPreview,
    error: classificationError,
  } = useEmailClassification(channelId ?? '', !!channelId);

  const classificationMappings = classificationConfig?.mappings ?? [];

  const {
    config: priorityConfig,
    isSaving: isPrioritySaving,
    saveConfig: savePriorityConfig,
    previewResult: priorityPreviewResult,
    isPreviewing: isPriorityPreviewing,
    runPreview: runPriorityPreview,
    error: priorityError,
  } = usePriorityClassification(channelId ?? '');

  const classificationEnabled = classificationConfig?.enabled ?? false;

  useEffect(() => {
    if (!emailChannelPreference) return;
    skipSendAsSave.current = true;
    skipCcSave.current = true;
    setOwnerId(emailChannelPreference.ownerUserId ?? '');
    setSendAsAlias(emailChannelPreference.sendAsEmail ?? '');
    setCcEmails(parseDefaultCc(emailChannelPreference.defaultCc));
    setDefaultAssigneeGroupId(emailChannelPreference.assigneeUserGroupId ?? '');
    setAutoMergeEmails(emailChannelPreference.emailMergeMode === EmailMergeMode.ENABLED);
    setAutoAIDraft(emailChannelPreference.autoDraftMode === AutoDraftMode.DRAFT);
    setAutoDraftAgentSlug(emailChannelPreference.autoDraftAgentSlug ?? null);
    const t = window.setTimeout(() => {
      skipSendAsSave.current = false;
      skipCcSave.current = false;
    }, 0);
    return () => window.clearTimeout(t);
  }, [emailChannelPreference]);

  useEffect(() => {
    if (skipSendAsSave.current || !channelId || !canManage) return;
    const saved = emailChannelPreference?.sendAsEmail ?? '';
    if (debouncedSendAs === saved) return;
    void savePreference({ sendAsEmail: debouncedSendAs || null }).catch(() => {
      setSendAsAlias(saved);
    });
  }, [debouncedSendAs, channelId, canManage, emailChannelPreference?.sendAsEmail, savePreference]);

  const persistCc = useCallback(
    (emails: string[]) => {
      if (!channelId) return;
      const saved = parseDefaultCc(emailChannelPreference?.defaultCc).join(',');
      const next = emails.join(',');
      if (next === saved) return;
      void savePreference({ defaultCc: next || null }).catch(() => {
        setCcEmails(parseDefaultCc(emailChannelPreference?.defaultCc));
      });
    },
    [channelId, emailChannelPreference?.defaultCc, savePreference],
  );

  const setCcEmailsAndSave = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setCcEmails(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (!skipCcSave.current) {
          persistCc(next);
        }
        return next;
      });
    },
    [persistCc],
  );

  const handleOwnerChange = useCallback(
    (nextOwnerId: string) => {
      if (!nextOwnerId) return;
      const prev = emailChannelPreference?.ownerUserId ?? '';
      setOwnerId(nextOwnerId);
      if (nextOwnerId === prev) return;
      void savePreference({ ownerUserId: nextOwnerId }).catch(() => {
        setOwnerId(prev);
      });
    },
    [emailChannelPreference?.ownerUserId, savePreference],
  );

  const handleAssigneeChange = useCallback(
    (nextGroupId: string) => {
      const resolvedId = nextGroupId === 'none' ? '' : nextGroupId;
      const prev = emailChannelPreference?.assigneeUserGroupId ?? '';
      setDefaultAssigneeGroupId(resolvedId);
      if (resolvedId === prev) return;
      void savePreference({ assigneeUserGroupId: resolvedId || null }).catch(() => {
        setDefaultAssigneeGroupId(prev);
      });
    },
    [emailChannelPreference?.assigneeUserGroupId, savePreference],
  );

  const handleAutoMergeChange = useCallback(
    (checked: boolean) => {
      if (!canManage) return;
      const prev = emailChannelPreference?.emailMergeMode === EmailMergeMode.ENABLED;
      setAutoMergeEmails(checked);
      if (checked === prev) return;
      void savePreference({
        emailMergeMode: checked ? EmailMergeMode.ENABLED : EmailMergeMode.DISABLED,
      }).catch(() => {
        setAutoMergeEmails(prev);
      });
    },
    [canManage, emailChannelPreference?.emailMergeMode, savePreference],
  );

  const handleAutoDraftChange = useCallback(
    (checked: boolean) => {
      if (!canManage) return;
      const prev = emailChannelPreference?.autoDraftMode === AutoDraftMode.DRAFT;
      setAutoAIDraft(checked);
      if (checked === prev) return;
      void savePreference({
        autoDraftMode: checked ? AutoDraftMode.DRAFT : AutoDraftMode.OFF,
      }).catch(() => {
        setAutoAIDraft(prev);
      });
    },
    [canManage, emailChannelPreference?.autoDraftMode, savePreference],
  );

  const handleAutoDraftAgentChange = useCallback(
    (slug: string | null) => {
      if (!canManage) return;
      const prev = emailChannelPreference?.autoDraftAgentSlug ?? null;
      setAutoDraftAgentSlug(slug);
      if (slug === prev) return;
      void savePreference({ autoDraftAgentSlug: slug }).catch(() => {
        setAutoDraftAgentSlug(prev);
      });
    },
    [canManage, emailChannelPreference?.autoDraftAgentSlug, savePreference],
  );

  const buildClassificationPayload = useCallback(
    (enabled: boolean): SaveConfigPayload => ({
      enabled,
      classificationPrompt:
        classificationConfig?.classificationPrompt ??
        emailChannelPreference?.classificationPrompt ??
        '',
      categoryField:
        classificationConfig?.categoryField ??
        emailChannelPreference?.categoryField ??
        'Query Type',
      subCategoryField:
        classificationConfig?.subCategoryField ?? emailChannelPreference?.subCategoryField ?? null,
    }),
    [classificationConfig, emailChannelPreference],
  );

  const handleClassificationToggle = useCallback(
    (checked: boolean) => {
      if (!canManage) return;
      const prompt =
        classificationConfig?.classificationPrompt ??
        emailChannelPreference?.classificationPrompt ??
        '';
      if (checked && !prompt.trim()) {
        toast.error('Configure classification first', {
          description: 'Add a classification prompt before enabling auto-classification.',
          action: {
            label: 'Configure',
            onClick: () => setAiFeatureConfig('auto-classification'),
          },
        });
        return;
      }
      void saveClassificationConfig(buildClassificationPayload(checked)).catch(() => {
        /* hook sets error */
      });
    },
    [
      canManage,
      classificationConfig,
      emailChannelPreference,
      saveClassificationConfig,
      buildClassificationPayload,
      setAiFeatureConfig,
    ],
  );

  const handlePriorityToggle = useCallback(() => {
    if (!canManage) return;
    void savePriorityConfig({
      enabled: !(priorityConfig?.enabled ?? false),
      priorityClassificationPrompt: priorityConfig?.priorityClassificationPrompt ?? null,
      priorityClassificationThreshold: priorityConfig?.priorityClassificationThreshold ?? 0.5,
    }).catch(() => {
      toast.error('Failed to update priority classification', {
        description: 'Please try again. The previous priority setting has been preserved.',
      });
    });
  }, [canManage, priorityConfig, savePriorityConfig]);

  useEffect(() => {
    if (open) {
      setAiFeatureConfig('none');
    }
  }, [open]);

  const openClassificationConfig = useCallback(() => {
    setAiFeatureConfig('auto-classification');
  }, []);

  const openPriorityConfig = useCallback(() => {
    setAiFeatureConfig('priority');
  }, []);

  return {
    canManage,
    isEmail,
    isSlack,
    canViewSendAs,
    emailChannelPreference,
    ownerId,
    sendAsAlias,
    setSendAsAlias,
    ccEmails,
    setCcEmails: setCcEmailsAndSave,
    defaultAssigneeGroupId,
    autoMergeEmails,
    autoAIDraft,
    autoDraftAgentSlug,
    handleAutoDraftAgentChange,
    clawAgents,
    classificationEnabled,
    classificationConfig,
    classificationMappings,
    saveClassificationConfig,
    saveClassificationMapping,
    updateClassificationMapping,
    deleteClassificationMapping,
    classificationPreviewResult,
    isClassificationPreviewing,
    isClassificationSaving,
    runClassificationPreview,
    classificationError,
    priorityConfig,
    isPrioritySaving,
    savePriorityConfig,
    priorityPreviewResult,
    isPriorityPreviewing,
    runPriorityPreview,
    priorityError,
    handleOwnerChange,
    handleAssigneeChange,
    handleAutoMergeChange,
    handleAutoDraftChange,
    handleClassificationToggle,
    handlePriorityToggle,
    aiFeatureConfig,
    setAiFeatureConfig,
    openClassificationConfig,
    openPriorityConfig,
  };
}
