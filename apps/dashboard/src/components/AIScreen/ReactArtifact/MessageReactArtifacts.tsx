import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Message } from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import { ReactArtifactView } from './ReactArtifactView';
import { ReactArtifactDialog } from './ReactArtifactDialog';
import { toArtifactRef, type ReactArtifactRef } from './ReactArtifact.types';
import { useAppCreationModeSignal, useIsShownInPane } from './appCreationModeContext';
import { ArtifactPaneReference } from './ArtifactPaneReference';
import { saveArtifactApp } from '../../../services/claw/artifactAppsService';
import { clawErrorText } from '../../../services/claw/clawRequest';

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Renders each agent-generated React app attached to an assistant message,
 * running inline in the thread the way a code block does, with expand opening
 * the same app full-screen in a dialog and save promoting it into a durable,
 * publishable app. Assistant attachments are otherwise not rendered on this
 * surface, so this is additive — anything that isn't an artifact is left alone.
 */
export function MessageReactArtifacts({ message }: { message: Message }): ReactElement | null {
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

  // Anything generated since session-scoping is ALREADY an app — the thread owns
  // one and each generation versioned it — so Save would create a confusing
  // duplicate. The button survives only for pre-scoping artifacts and for the
  // rare case where materialization failed. Publishing stays explicit either way.
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

  if (artifacts.length === 0) return null;

  return (
    <>
      {artifacts.map(artifact => (
        <ArtifactCard
          key={artifact.attachmentId}
          artifact={artifact}
          onExpand={handleExpand}
          {...(artifact.savedAppId ? {} : { onSave: handleSave })}
          saveState={saveStates[artifact.attachmentId] ?? 'idle'}
        />
      ))}
      {saveError && <p className='mb-2 text-xs text-destructive'>{saveError}</p>}
      <ReactArtifactDialog artifact={expanded} onClose={handleClose} />
    </>
  );
}

/**
 * One artifact in the transcript — live, or a reference when App Creation mode
 * is already running this app in the pane. Split into its own component because
 * the decision needs a hook, and hooks cannot be called inside a `.map`.
 *
 * This card is also what OPENS the mode. It mounts exactly when a build appears
 * in the thread — on history load and on every new generation — so a
 * mount-once request here fires at precisely the moments the pane should open,
 * with the app id and version in hand and nothing to infer. Once per mount is
 * what lets a close stick: an existing card never asks again, and only the
 * next build's fresh card reopens the pane.
 *
 * Expand follows the same logic. For an app this thread owns, "expand" means
 * the pane — that is the full-size surface — so it enters the mode rather than
 * opening a second copy in a dialog. The dialog survives only for artifacts
 * that predate session-scoping and have no app to open.
 */
function ArtifactCard({
  artifact,
  onExpand,
  onSave,
  saveState,
}: {
  artifact: ReactArtifactRef;
  onExpand: (a: ReactArtifactRef) => void;
  onSave?: (a: ReactArtifactRef) => void;
  saveState: SaveState;
}): ReactElement {
  const shownInPane = useIsShownInPane(artifact.savedAppId);
  const { active, enterForApp } = useAppCreationModeSignal();
  const { savedAppId, versionId } = artifact;

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (!savedAppId || active) return;
    enterForApp(savedAppId, versionId ?? null);
  }, [savedAppId, versionId, active, enterForApp]);

  if (shownInPane) return <ArtifactPaneReference artifact={artifact} />;

  const expand = savedAppId ? (): void => enterForApp(savedAppId, versionId ?? null) : onExpand;

  return (
    <ReactArtifactView
      artifact={artifact}
      onExpand={expand}
      expandLabel={savedAppId ? 'Open in the app panel' : 'Open full screen'}
      {...(onSave ? { onSave } : {})}
      saveState={saveState}
    />
  );
}
