import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useChannelsByProjectId } from '@xyne/shared/hooks';
import { v4 as uuidv4 } from 'uuid';
import {
  ReleaseTrackingMode,
  type ApplicationConfig,
  type Channel,
  type ExistingReleaseConfig,
  type ReleaseTrackingModeValue,
  type WizardStep,
} from './ReleaseConfigWizard.types';
import { buildMainReleaseBoardName } from './releaseBoardNames';

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
  addServiceMode = false,
}: UseReleaseConfigFormOptions) {
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
  const isSaving = false;

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

  // Apply AI-suggested services (envPaths/migrationPaths arrive as arrays; form
  // state holds them as CSV strings). 'replace' swaps all rows; 'add' keeps your
  // named rows and appends suggestions not already present by name.
  const applyServiceSuggestions = useCallback(
    (
      services: { name: string; regex: string; envPaths: string[]; migrationPaths: string[] }[],
      mode: 'replace' | 'add',
    ) => {
      if (services.length === 0) return;
      setUserTouched(true);
      const norm = (name: string): string => name.trim().toLowerCase();
      // Keep the existing row's id/boardId for a same-named service: on save, an app missing
      // from the payload is deleted (board, stages, approvers, mappings), so reseeding ids for
      // a service that already exists would tear its board down and recreate it.
      const toRow = (
        service: (typeof services)[number],
        existing?: ApplicationConfig,
      ): ApplicationConfig => ({
        ...(existing ?? { ...EMPTY_APP, id: uuidv4(), boardId: uuidv4() }),
        name: service.name,
        regex: service.regex,
        envPaths: service.envPaths.join(', '),
        migrationPaths: service.migrationPaths.join(', '),
      });
      setApplications(prev => {
        const kept = prev.filter(app => app.name.trim());
        const byName = new Map(kept.map(app => [norm(app.name), app]));
        if (mode === 'replace') return services.map(s => toRow(s, byName.get(norm(s.name))));
        const additions = services.filter(s => !byName.has(norm(s.name))).map(s => toRow(s));
        return [...kept, ...additions];
      });
    },
    [],
  );

  // ─── Save ───────────────────────────────────────────────────────────────────

  // Release configs belong to an SDLC hub now and are saved from its Releases tab;
  // this project-level wizard can no longer create or edit one.
  const handleSave = useCallback((): Promise<void> => {
    toast.error(
      "Release configuration has moved to SDLC hubs. Set this repository up from its hub's Releases tab.",
    );
    return Promise.resolve();
  }, []);

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
    applyServiceSuggestions,
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
