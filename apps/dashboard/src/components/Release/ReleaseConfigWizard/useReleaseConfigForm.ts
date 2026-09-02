import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useChannelsByProjectId } from '@xyne/shared/hooks';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import {
  ReleaseTrackingMode,
  type ApplicationConfig,
  type Channel,
  type ExistingReleaseConfig,
  type ReleaseTrackingModeValue,
  type WizardStep,
} from './ReleaseConfigWizard.types';
import { buildApplicationReleaseBoardName, buildMainReleaseBoardName } from './releaseBoardNames';

const EMPTY_APP: ApplicationConfig = {
  id: '',
  boardId: '',
  boardName: '',
  name: '',
  repoUrl: '',
  regex: '',
  ownerTeam: '',
  envPaths: '',
  migrationPaths: '',
};

function csvToArray(csv: string): string[] {
  return csv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function initApplications(config: ExistingReleaseConfig | undefined): ApplicationConfig[] {
  if (config && config.applications.length > 0) return config.applications;
  return [{ ...EMPTY_APP, id: uuidv4(), boardId: uuidv4() }];
}

interface UseReleaseConfigFormOptions {
  projectId: string;
  existingConfig: ExistingReleaseConfig | undefined;
  onSave: (mainBoard: { id: string; name: string }) => void;
  /**
   * "Add service" mode: seed one blank service appended to the existing group
   * and reveal only it. The whole group stays in state so save submits every
   * service (the mutator deletes any app missing from the payload).
   */
  addServiceMode?: boolean;
}

export function useReleaseConfigForm({
  projectId,
  existingConfig,
  onSave,
  addServiceMode = false,
}: UseReleaseConfigFormOptions) {
  const zero = useZero();
  const isEditing = !!existingConfig;

  // The blank service seeded for add mode; its id lets the form filter to that
  // one row and gate save on it.
  const [addedService] = useState(() =>
    addServiceMode ? { id: uuidv4(), boardId: uuidv4() } : null,
  );

  const [currentStep, setCurrentStep] = useState<WizardStep>(2);
  const [releaseTrackingMode, setReleaseTrackingMode] = useState<ReleaseTrackingModeValue>(
    existingConfig?.releaseTrackingMode ?? ReleaseTrackingMode.COMMIT_RANGE,
  );
  const [mainBoardId] = useState(existingConfig?.mainBoardId ?? uuidv4());
  const [mainBoardName, setMainBoardName] = useState(existingConfig?.mainBoardName ?? '');

  // One main release board represents one repository, shared by its applications.
  const [sharedRepoUrl, setSharedRepoUrl] = useState(
    existingConfig?.applications[0]?.repoUrl ?? '',
  );

  const [applications, setApplications] = useState<ApplicationConfig[]>(() => {
    const base = initApplications(existingConfig);
    return addedService ? [...base, { ...EMPTY_APP, ...addedService }] : base;
  });
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Once the user edits the form we stop overriding state from Zero re-deliveries.
  // Add mode starts "touched" so the seeded blank row survives re-deliveries.
  const [userTouched, setUserTouched] = useState(addServiceMode);

  const channels = useChannelsByProjectId(projectId) as Channel[] | undefined;

  // Sync from existingConfig when Zero delivers the populated rows after initial mount.
  useEffect(() => {
    if (userTouched || !existingConfig) return;
    if (existingConfig.releaseTrackingMode)
      setReleaseTrackingMode(existingConfig.releaseTrackingMode);
    if (existingConfig.applications.length > 0) setApplications(existingConfig.applications);
    // Save writes sharedRepoUrl onto every application — leaving it at its
    // mount-time value would silently revert a concurrent repoUrl change.
    const syncedRepoUrl = existingConfig.applications[0]?.repoUrl;
    if (syncedRepoUrl) setSharedRepoUrl(syncedRepoUrl);
  }, [existingConfig, userTouched]);

  // Pre-fill the channel once the channel list loads.
  useEffect(() => {
    if (!existingConfig?.channelId || !channels || selectedChannel) return;
    const found = channels.find(c => c.id === existingConfig.channelId);
    if (found) setSelectedChannel(found);
  }, [existingConfig, channels, selectedChannel]);

  // Existing groups keep their persisted names; only new groups use the
  // repository-based naming convention.
  useEffect(() => {
    if (existingConfig) {
      setMainBoardName(existingConfig.mainBoardName);
      return;
    }
    setMainBoardName(buildMainReleaseBoardName(sharedRepoUrl));
  }, [existingConfig, sharedRepoUrl]);

  // ─── Step navigation ────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (currentStep < 2) setCurrentStep(prev => (prev + 1) as WizardStep);
  }, [currentStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) setCurrentStep(prev => (prev - 1) as WizardStep);
  }, [currentStep]);

  // ─── Application CRUD ───────────────────────────────────────────────────────

  const addApplication = useCallback(() => {
    setUserTouched(true);
    setApplications(prev => [
      ...prev,
      {
        id: uuidv4(),
        boardId: uuidv4(),
        boardName: '',
        name: '',
        repoUrl: '',
        regex: '',
        ownerTeam: '',
        envPaths: '',
        migrationPaths: '',
      },
    ]);
  }, []);

  const removeApplication = useCallback((id: string) => {
    setUserTouched(true);
    setApplications(prev => prev.filter(app => app.id !== id));
  }, []);

  const updateApplication = useCallback(
    (id: string, field: keyof ApplicationConfig, value: string) => {
      setUserTouched(true);
      setApplications(prev => prev.map(app => (app.id === id ? { ...app, [field]: value } : app)));
    },
    [],
  );

  const updateReleaseTrackingMode = useCallback((mode: ReleaseTrackingModeValue) => {
    setUserTouched(true);
    setReleaseTrackingMode(mode);
  }, []);

  // ─── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const hasNamelessContent = applications.some(
      app =>
        !app.name.trim() &&
        (app.regex.trim() ||
          app.ownerTeam.trim() ||
          app.envPaths.trim() ||
          app.migrationPaths.trim()),
    );
    if (hasNamelessContent) {
      toast.error('Every service needs a name');
      return;
    }

    const validApps = applications.filter(app => app.name.trim());

    if (validApps.length === 0) {
      toast.error('Please configure at least one service');
      return;
    }
    if (!sharedRepoUrl.trim()) {
      toast.error('Repository URL is required');
      return;
    }
    if (!mainBoardName.trim()) {
      toast.error('Repository name must produce a valid repository name');
      return;
    }
    if (validApps.some(app => !app.regex.trim())) {
      toast.error('All services must have a Service Regex');
      return;
    }
    // Fall back to the group's stored channel: edit-application mode hides the
    // channel picker, and a deleted/unsynced channel must not dead-end Save.
    const channelIdToSave = selectedChannel?.id ?? existingConfig?.channelId ?? null;
    if (!channelIdToSave) {
      toast.error('Please select a release channel');
      return;
    }

    setIsSaving(true);
    try {
      const applicationsData = validApps.map(app => ({
        id: app.id,
        boardId: app.boardId,
        boardName:
          app.boardName.trim() || buildApplicationReleaseBoardName(sharedRepoUrl, app.name),
        name: app.name,
        regex: app.regex,
        repoUrl: sharedRepoUrl,
        ownerTeam: app.ownerTeam,
        envPaths: csvToArray(app.envPaths),
        migrationPaths: csvToArray(app.migrationPaths),
      }));
      if (applicationsData.some(app => !app.boardName.trim())) {
        throw new Error('Repository and service names must produce valid repository names');
      }

      const result = zero.mutate(
        mutators.project.saveReleaseBoardConfig({
          projectId,
          mainBoardId,
          mainBoardName: mainBoardName.trim(),
          releaseTrackingMode: releaseTrackingMode as ReleaseTrackingMode,
          channelId: channelIdToSave,
          applications: applicationsData,
        }),
      );

      const res = await result.server;
      if (res.type === 'error') {
        throw new Error(res.error.message || 'Failed to save configuration');
      }

      toast.success('Release configuration saved');
      onSave({ id: mainBoardId, name: mainBoardName.trim() });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  }, [
    applications,
    existingConfig,
    selectedChannel,
    projectId,
    mainBoardId,
    mainBoardName,
    releaseTrackingMode,
    sharedRepoUrl,
    onSave,
    zero,
  ]);

  return {
    // Meta
    isEditing,
    isSaving,
    mainBoardName,
    // Step
    currentStep,
    handleNext,
    handleBack,
    // Release mode
    releaseTrackingMode,
    setReleaseTrackingMode: updateReleaseTrackingMode,
    // Shared repository
    sharedRepoUrl,
    // Editing the repo URL must also stop Zero re-deliveries from overwriting
    // form state, like every other user-driven setter here.
    setSharedRepoUrl: (value: string) => {
      setUserTouched(true);
      setSharedRepoUrl(value);
    },
    // Applications
    applications,
    addApplication,
    removeApplication,
    updateApplication,
    // Add-service mode: id of the blank service row seeded into the group.
    addedServiceId: addedService?.id ?? null,
    // Channel
    channels,
    selectedChannel,
    setSelectedChannel,
    // Save
    handleSave,
  };
}
