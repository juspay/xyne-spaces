import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useCacConfig } from '@xyne/shared/hooks';
import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { ReactArtifactView } from './ReactArtifactView';
import { ReactArtifactDialog } from './ReactArtifactDialog';
import { toArtifactRef, type ReactArtifactRef } from './ReactArtifact.types';
import { saveArtifactApp } from '../../../services/claw/artifactAppsService';
import { clawErrorText } from '../../../services/claw/clawRequest';
import {
  REACT_ARTIFACT_CAC_KEY,
  DEFAULT_REACT_ARTIFACT_CAC_CONFIG,
  type ReactArtifactCacConfig,
} from './reactArtifactCacConfig';
import {
  REACT_ARTIFACT_PUBLISH_CAC_KEY,
  DEFAULT_REACT_ARTIFACT_PUBLISH_CAC_CONFIG,
  type ReactArtifactPublishCacConfig,
} from './reactArtifactPublishCacConfig';

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Renders each agent-generated React app attached to an assistant message,
 * running inline in the thread the way a code block does, with expand opening
 * the same app full-screen in a dialog and save promoting it into a durable,
 * publishable app. Assistant attachments are otherwise not rendered on this
 * surface, so this is additive — anything that isn't an artifact is left alone.
 */
export function MessageReactArtifacts({ message }: { message: Message }): ReactElement | null {
  const { config } = useCacConfig<ReactArtifactCacConfig>({
    key: REACT_ARTIFACT_CAC_KEY,
    fallbackConfig: DEFAULT_REACT_ARTIFACT_CAC_CONFIG,
  });
  const { config: publishConfig } = useCacConfig<ReactArtifactPublishCacConfig>({
    key: REACT_ARTIFACT_PUBLISH_CAC_KEY,
    fallbackConfig: DEFAULT_REACT_ARTIFACT_PUBLISH_CAC_CONFIG,
  });

  const [expanded, setExpanded] = useState<ReactArtifactRef | null>(null);
  // Keyed by attachmentId: one message can carry several artifacts, and each
  // saves independently.
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleExpand = useCallback((artifact: ReactArtifactRef): void => {
    setExpanded(artifact);
  }, []);
  const handleClose = useCallback((): void => {
    setExpanded(null);
  }, []);

  const saveMutation = useMutation({
    mutationFn: (artifact: ReactArtifactRef) =>
      saveArtifactApp({
        attachmentId: artifact.attachmentId,
        title: artifact.manifest.title,
      }),
  });

  const handleSave = useCallback(
    (artifact: ReactArtifactRef): void => {
      setSaveError(null);
      setSaveStates(prev => ({ ...prev, [artifact.attachmentId]: 'saving' }));
      saveMutation.mutate(artifact, {
        onSuccess: () => setSaveStates(prev => ({ ...prev, [artifact.attachmentId]: 'saved' })),
        onError: (err: unknown) => {
          setSaveStates(prev => ({ ...prev, [artifact.attachmentId]: 'idle' }));
          setSaveError(clawErrorText(err, 'Could not save this app.'));
        },
      });
    },
    [saveMutation],
  );

  // `toArtifactRef` allocates, so without memoizing, every thread re-render
  // (scrolling included) would hand ReactArtifactView a new `artifact` object.
  const artifacts = useMemo(
    () =>
      (message.attachments ?? [])
        .map(toArtifactRef)
        .filter((ref): ref is ReactArtifactRef => ref !== null),
    [message.attachments],
  );

  if (!config.enabled) return null;
  if (artifacts.length === 0) return null;

  return (
    <>
      {artifacts.map(artifact => (
        <ReactArtifactView
          key={artifact.attachmentId}
          artifact={artifact}
          onExpand={handleExpand}
          {...(publishConfig.enabled ? { onSave: handleSave } : {})}
          saveState={saveStates[artifact.attachmentId] ?? 'idle'}
        />
      ))}
      {saveError && <p className='mb-2 text-xs text-destructive'>{saveError}</p>}
      <ReactArtifactDialog artifact={expanded} onClose={handleClose} />
    </>
  );
}
