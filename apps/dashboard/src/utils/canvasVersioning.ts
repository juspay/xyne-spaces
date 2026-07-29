import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { diffWordsWithSpace, type Change } from 'diff';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../hooks/useZero';
import { mutators } from '../zero/mutators';

export type CanvasContentDiffPart = {
  type: 'same' | 'added' | 'removed';
  value: string;
};

type RenameableCanvasVersion = {
  id: string;
  name?: string | null;
};

type CopyableCanvasVersion = {
  id: string;
  name?: string | null;
  content: unknown;
  updatedAt: number;
};

type CopyableCanvas = {
  title?: string | null;
  channelId?: string | null;
  folderId?: string | null;
  projectId?: string | null;
  visibility?: CanvasVisibility;
  channel?: { projectId?: string | null } | null;
  folder?: { project?: { id?: string | null } | null } | null;
  project?: unknown;
};

interface UseCanvasVersionRenameOptions<TVersion extends RenameableCanvasVersion> {
  canEdit: boolean;
  previewVersionRef: { current: TVersion | null };
  setPreviewVersion: Dispatch<SetStateAction<TVersion | null>>;
  setRenamingVersionId: Dispatch<SetStateAction<string | undefined>>;
}

interface UseCanvasVersionCopyOptions {
  canvas: CopyableCanvas | null | undefined;
  isBlocked?: boolean;
  onBlocked?: () => void;
  onCreated: (copy: CanvasVersionCopyResult) => void;
}

export type CanvasVersionCopyResult = {
  id: string;
  title: string;
  content: unknown;
  channelId?: string;
  folderId?: string;
  projectId?: string;
  visibility?: CanvasVisibility;
  createdAt: number;
};

interface UseCanvasVersionCopyCreatedHandlerOptions<TCanvas, TContent, TPreviewVersion> {
  sourceCanvas: (CopyableCanvas & TCanvas) | null | undefined;
  userId?: string | undefined;
  navigate: (path: string, options?: { state?: unknown }) => void | Promise<void>;
  getCanvasRoute: (canvasId: string) => string;
  getNavigationState?: ((canvas: TCanvas) => unknown) | undefined;
  setCanvas: Dispatch<SetStateAction<TCanvas | null>>;
  canvasRef: MutableRefObject<TCanvas | null>;
  editorRef: MutableRefObject<unknown>;
  setCurrentTitle: Dispatch<SetStateAction<string>>;
  titleRef: MutableRefObject<string>;
  setCurrentContent: Dispatch<SetStateAction<TContent | undefined>>;
  latestContentRef: MutableRefObject<TContent | undefined>;
  lastSavedContentRef: MutableRefObject<string>;
  currentCanvasIdRef: MutableRefObject<string | null>;
  initializedCanvasIdRef?: MutableRefObject<string | null> | undefined;
  previewVersionRef: MutableRefObject<TPreviewVersion | null>;
  setPreviewVersion: Dispatch<SetStateAction<TPreviewVersion | null>>;
  setShowVersionDiff: Dispatch<SetStateAction<boolean>>;
  setShowVersionHistory: Dispatch<SetStateAction<boolean>>;
}

interface UseCanvasVersionSaveOptions<TCanvas extends { id?: string }> {
  canEditRef: MutableRefObject<boolean>;
  getDefaultCanvas: () => TCanvas | null;
}

interface ReadableRef<T> {
  readonly current: T;
}

interface UseCanvasExitSnapshotOptions<
  TCanvas extends { id?: string; isCollaborative?: boolean },
  TContent,
> {
  canvasRef: ReadableRef<TCanvas | null>;
  previewVersionRef: ReadableRef<unknown>;
  latestContentRef: MutableRefObject<TContent | undefined>;
  editorRef: ReadableRef<{ getBlocks: () => TContent } | null>;
  lastSavedContentRef: MutableRefObject<string>;
  currentCanvasIdRef: ReadableRef<string | null>;
  pendingSnapshotsRef: MutableRefObject<Set<string>>;
  persistCanvasContent: (content: TContent, canvas: TCanvas) => void;
  saveCanvasVersion: (content: TContent, canvas: TCanvas) => Promise<void>;
}

interface UseCanvasVersionRestoreOptions<
  TCanvas,
  TContent,
  TVersion extends { id: string; content: unknown },
> {
  canEdit: boolean;
  userId?: string | undefined;
  setRestoringVersionId: Dispatch<SetStateAction<string | undefined>>;
  previewVersionRef: MutableRefObject<TVersion | null>;
  setPreviewVersion: Dispatch<SetStateAction<TVersion | null>>;
  setShowVersionDiff: Dispatch<SetStateAction<boolean>>;
  setCurrentContent: Dispatch<SetStateAction<TContent | undefined>>;
  latestContentRef: MutableRefObject<TContent | undefined>;
  lastSavedContentRef: MutableRefObject<string>;
  setCanvas: Dispatch<SetStateAction<TCanvas | null>>;
  editorRef: ReadableRef<{ replaceContent: (content: TContent) => void } | null>;
}

export const formatCanvasVersionName = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const useCanvasVersionRename = <TVersion extends RenameableCanvasVersion>({
  canEdit,
  previewVersionRef,
  setPreviewVersion,
  setRenamingVersionId,
}: UseCanvasVersionRenameOptions<TVersion>): ((
  version: TVersion,
  name: string,
) => Promise<void>) => {
  const z = useZero();

  return useCallback(
    async (version: TVersion, name: string): Promise<void> => {
      if (!canEdit) return;

      const trimmedName = name.trim();
      if (!trimmedName) {
        toast.info('Version name cannot be empty');
        return;
      }

      setRenamingVersionId(version.id);
      try {
        const result = z.mutate(
          mutators.canvasVersion.rename({
            id: version.id,
            name: trimmedName,
          }),
        );
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to rename canvas version');
        }

        const currentPreview = previewVersionRef.current;
        if (currentPreview?.id === version.id) {
          setPreviewVersion(prev => (prev ? ({ ...prev, name: trimmedName } as TVersion) : prev));
          previewVersionRef.current = {
            ...currentPreview,
            name: trimmedName,
          } as TVersion;
        }

        toast.success('Version renamed');
      } catch {
        toast.error('Rename failed', {
          description: 'Could not rename this canvas version.',
        });
      } finally {
        setRenamingVersionId(undefined);
      }
    },
    [canEdit, previewVersionRef, setPreviewVersion, setRenamingVersionId, z],
  );
};

export const useCanvasVersionSave = <TCanvas extends { id?: string }>({
  canEditRef,
  getDefaultCanvas,
}: UseCanvasVersionSaveOptions<TCanvas>): ((
  blocks: unknown,
  canvasToVersion?: TCanvas | null,
  showSuccessToast?: boolean,
) => Promise<void>) => {
  const z = useZero();

  return useCallback(
    async (
      blocks: unknown,
      canvasToVersion: TCanvas | null = getDefaultCanvas(),
      showSuccessToast = false,
    ): Promise<void> => {
      if (!canvasToVersion?.id || !canEditRef.current) return;

      const normalizedBlocks = normalizeCanvasContent(blocks);
      if (isCanvasContentEmpty(normalizedBlocks)) {
        if (showSuccessToast) {
          toast.info('Add content before saving a version');
        }
        return;
      }

      const timestamp = Date.now();
      const contentHash = await createCanvasContentHash(normalizedBlocks);
      const result = z.mutate(
        mutators.canvasVersion.save({
          id: uuidv4(),
          canvasId: canvasToVersion.id,
          name: formatCanvasVersionName(timestamp),
          content: normalizedBlocks as ReadonlyJSONValue,
          contentHash,
          timestamp,
        }),
      );
      const serverResult = await result.server;

      if (serverResult.type === 'error') {
        throw new Error(serverResult.error.message || 'Failed to save canvas version');
      }

      if (showSuccessToast) {
        toast.success('Version saved');
      }
    },
    [canEditRef, getDefaultCanvas, z],
  );
};

export const useCanvasExitSnapshot = <
  TCanvas extends { id?: string; isCollaborative?: boolean },
  TContent,
>({
  canvasRef,
  previewVersionRef,
  latestContentRef,
  editorRef,
  lastSavedContentRef,
  currentCanvasIdRef,
  pendingSnapshotsRef,
  persistCanvasContent,
  saveCanvasVersion,
}: UseCanvasExitSnapshotOptions<TCanvas, TContent>): (() => void) =>
  useCallback((): void => {
    const canvasToSave = canvasRef.current;
    const contentToSave = previewVersionRef.current
      ? latestContentRef.current
      : latestContentRef.current || editorRef.current?.getBlocks();

    if (!contentToSave || !canvasToSave?.id) return;
    if (currentCanvasIdRef.current && currentCanvasIdRef.current !== canvasToSave.id) return;

    latestContentRef.current = contentToSave;
    if (
      !canvasToSave.isCollaborative &&
      JSON.stringify(contentToSave) !== lastSavedContentRef.current
    ) {
      persistCanvasContent(contentToSave, canvasToSave);
    }

    const snapshotKey = `${canvasToSave.id}:${JSON.stringify(contentToSave)}`;
    if (pendingSnapshotsRef.current.has(snapshotKey)) return;

    pendingSnapshotsRef.current.add(snapshotKey);
    void saveCanvasVersion(contentToSave, canvasToSave)
      .catch(() => undefined)
      .finally(() => {
        pendingSnapshotsRef.current.delete(snapshotKey);
      });
  }, [
    canvasRef,
    currentCanvasIdRef,
    editorRef,
    lastSavedContentRef,
    latestContentRef,
    pendingSnapshotsRef,
    persistCanvasContent,
    previewVersionRef,
    saveCanvasVersion,
  ]);

export const useCanvasVersionRestore = <
  TCanvas,
  TContent,
  TVersion extends { id: string; content: unknown },
>({
  canEdit,
  userId,
  setRestoringVersionId,
  previewVersionRef,
  setPreviewVersion,
  setShowVersionDiff,
  setCurrentContent,
  latestContentRef,
  lastSavedContentRef,
  setCanvas,
  editorRef,
}: UseCanvasVersionRestoreOptions<TCanvas, TContent, TVersion>): ((
  version: TVersion,
) => Promise<void>) => {
  const z = useZero();

  return useCallback(
    async (version: TVersion): Promise<void> => {
      if (!canEdit) return;

      const restoredContent = normalizeCanvasContent(version.content) as TContent;
      const timestamp = Date.now();

      setRestoringVersionId(version.id);
      try {
        const result = z.mutate(
          mutators.canvasVersion.restore({
            id: version.id,
            timestamp,
          }),
        );
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to restore canvas version');
        }

        previewVersionRef.current = null;
        setPreviewVersion(null);
        setShowVersionDiff(false);
        setCurrentContent(restoredContent);
        latestContentRef.current = restoredContent;
        lastSavedContentRef.current = JSON.stringify(restoredContent);
        setCanvas(prev =>
          prev
            ? ({
                ...prev,
                content: restoredContent,
                updatedAt: timestamp,
                lastEditedAt: timestamp,
                ...(userId ? { lastEditedBy: userId } : {}),
              } as TCanvas)
            : prev,
        );

        window.setTimeout(() => {
          editorRef.current?.replaceContent(restoredContent);
        }, 0);

        toast.success('Version restored');
      } catch {
        toast.error('Restore failed', {
          description: 'Could not restore this canvas version.',
        });
      } finally {
        setRestoringVersionId(undefined);
      }
    },
    [
      canEdit,
      editorRef,
      lastSavedContentRef,
      latestContentRef,
      previewVersionRef,
      setCanvas,
      setCurrentContent,
      setPreviewVersion,
      setRestoringVersionId,
      setShowVersionDiff,
      userId,
      z,
    ],
  );
};

export const useCanvasVersionCopy = <TVersion extends CopyableCanvasVersion>({
  canvas,
  isBlocked = false,
  onBlocked,
  onCreated,
}: UseCanvasVersionCopyOptions): {
  copyingVersionId: string | undefined;
  handleMakeCopyVersion: (version: TVersion) => Promise<void>;
} => {
  const z = useZero();
  const [copyingVersionId, setCopyingVersionId] = useState<string | undefined>(undefined);

  const handleMakeCopyVersion = useCallback(
    async (version: TVersion): Promise<void> => {
      if (isBlocked) {
        onBlocked?.();
        return;
      }
      if (!canvas) return;

      const newCanvasId = uuidv4();
      const canvasTitle = canvas.title?.trim() || 'Untitled Canvas';
      const versionName = version.name?.trim() || formatCanvasVersionName(version.updatedAt);
      const resolvedProjectId =
        canvas.projectId ?? canvas.channel?.projectId ?? canvas.folder?.project?.id;
      const title = `${canvasTitle} ${versionName}`;
      const timestamp = Date.now();

      setCopyingVersionId(version.id);
      try {
        const result = z.mutate(
          mutators.canvas.create({
            id: newCanvasId,
            title,
            content: version.content as ReadonlyJSONValue,
            ...(canvas.visibility ? { visibility: canvas.visibility } : {}),
            ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
            ...(canvas.folderId ? { folderId: canvas.folderId } : {}),
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            timestamp,
            participantId: uuidv4(),
          }),
        );
        const serverResult = await result.server;

        if (serverResult.type === 'error') {
          throw new Error(serverResult.error.message || 'Failed to copy canvas version');
        }

        toast.success('Canvas copy created');
        onCreated({
          id: newCanvasId,
          title,
          content: version.content,
          ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
          ...(canvas.folderId ? { folderId: canvas.folderId } : {}),
          ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
          ...(canvas.visibility ? { visibility: canvas.visibility } : {}),
          createdAt: timestamp,
        });
      } catch {
        toast.error('Copy failed', {
          description: 'Could not create a canvas copy from this version.',
        });
      } finally {
        setCopyingVersionId(undefined);
      }
    },
    [canvas, isBlocked, onBlocked, onCreated, z],
  );

  return { copyingVersionId, handleMakeCopyVersion };
};

export const useCanvasVersionCopyCreatedHandler = <TCanvas, TContent, TPreviewVersion>({
  sourceCanvas,
  userId,
  navigate,
  getCanvasRoute,
  getNavigationState,
  setCanvas,
  canvasRef,
  editorRef,
  setCurrentTitle,
  titleRef,
  setCurrentContent,
  latestContentRef,
  lastSavedContentRef,
  currentCanvasIdRef,
  initializedCanvasIdRef,
  previewVersionRef,
  setPreviewVersion,
  setShowVersionDiff,
  setShowVersionHistory,
}: UseCanvasVersionCopyCreatedHandlerOptions<TCanvas, TContent, TPreviewVersion>): ((
  copy: CanvasVersionCopyResult,
) => void) =>
  useCallback(
    (copy: CanvasVersionCopyResult): void => {
      const copiedContent = normalizeCanvasContent(copy.content) as TContent;
      const newCanvas = {
        id: copy.id,
        title: copy.title,
        content: copiedContent,
        ...(copy.channelId ? { channelId: copy.channelId } : {}),
        ...(copy.folderId ? { folderId: copy.folderId } : {}),
        ...(copy.projectId ? { projectId: copy.projectId } : {}),
        createdBy: userId || '',
        visibility: copy.visibility || CanvasVisibility.PRIVATE,
        isTemplate: false,
        isCollaborative: false,
        isStarred: false,
        createdAt: copy.createdAt,
        updatedAt: copy.createdAt,
        lastEditedAt: copy.createdAt,
        ...(userId ? { lastEditedBy: userId } : {}),
        accessLevel: CanvasRole.OWNER,
        ...(sourceCanvas?.folder ? { folder: sourceCanvas.folder } : {}),
        ...(sourceCanvas?.channel ? { channel: sourceCanvas.channel } : {}),
        ...(sourceCanvas?.project ? { project: sourceCanvas.project } : {}),
      } as TCanvas;

      editorRef.current = null;
      canvasRef.current = newCanvas;
      setCanvas(newCanvas);
      setCurrentTitle(copy.title);
      titleRef.current = copy.title;
      setCurrentContent(copiedContent);
      latestContentRef.current = copiedContent;
      lastSavedContentRef.current = JSON.stringify(copiedContent);
      currentCanvasIdRef.current = copy.id;
      if (initializedCanvasIdRef) {
        initializedCanvasIdRef.current = copy.id;
      }
      previewVersionRef.current = null;
      setPreviewVersion(null);
      setShowVersionDiff(false);
      setShowVersionHistory(false);

      void navigate(getCanvasRoute(copy.id), {
        state: getNavigationState ? getNavigationState(newCanvas) : { canvas: newCanvas },
      });
    },
    [
      canvasRef,
      currentCanvasIdRef,
      editorRef,
      getCanvasRoute,
      getNavigationState,
      initializedCanvasIdRef,
      latestContentRef,
      lastSavedContentRef,
      navigate,
      previewVersionRef,
      setCanvas,
      setCurrentContent,
      setCurrentTitle,
      setPreviewVersion,
      setShowVersionDiff,
      setShowVersionHistory,
      sourceCanvas?.channel,
      sourceCanvas?.folder,
      sourceCanvas?.project,
      titleRef,
      userId,
    ],
  );

export const isVisibleCanvasContentDiffPart = (part: CanvasContentDiffPart): boolean =>
  part.type !== 'same' && part.value.trim().length > 0;

const normalizeCanvasValue = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => normalizeCanvasValue(item));

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    normalized[key] = normalizeCanvasValue((value as Record<string, unknown>)[key]);
  }
  return normalized;
};

export const stableStringifyCanvasContent = (content: unknown): string =>
  JSON.stringify(normalizeCanvasValue(content));

export const normalizeCanvasContent = <T>(content: T): T =>
  JSON.parse(stableStringifyCanvasContent(content)) as T;

const isInlineContentEmpty = (content: unknown): boolean => {
  if (content === undefined || content === null) return true;
  if (typeof content === 'string') return content.trim().length === 0;
  if (Array.isArray(content)) return content.every(item => isInlineContentEmpty(item));
  if (typeof content !== 'object') return false;

  const contentRecord = content as Record<string, unknown>;
  if (typeof contentRecord['text'] === 'string') {
    return contentRecord['text'].trim().length === 0;
  }

  if ('content' in contentRecord) {
    return isInlineContentEmpty(contentRecord['content']);
  }

  return false;
};

const textLikeBlockTypes = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
]);

const isCanvasBlockEmpty = (block: unknown): boolean => {
  if (block === undefined || block === null) return true;
  if (typeof block !== 'object' || Array.isArray(block)) return isInlineContentEmpty(block);

  const blockRecord = block as Record<string, unknown>;
  const blockType = typeof blockRecord['type'] === 'string' ? blockRecord['type'] : 'paragraph';
  const children = Array.isArray(blockRecord['children']) ? blockRecord['children'] : [];

  if (!textLikeBlockTypes.has(blockType)) return false;
  if (!isInlineContentEmpty(blockRecord['content'])) return false;

  return children.every(child => isCanvasBlockEmpty(child));
};

export const isCanvasContentEmpty = (content: unknown): boolean => {
  const normalizedContent = normalizeCanvasValue(content);

  if (!Array.isArray(normalizedContent)) {
    return isInlineContentEmpty(normalizedContent);
  }

  return (
    normalizedContent.length === 0 || normalizedContent.every(block => isCanvasBlockEmpty(block))
  );
};

const extractInlineContentText = (content: unknown): string => {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  if (Array.isArray(content)) return content.map(item => extractInlineContentText(item)).join('');
  if (typeof content !== 'object') return '';

  const contentRecord = content as Record<string, unknown>;
  if (typeof contentRecord['text'] === 'string') return contentRecord['text'];
  if ('content' in contentRecord) return extractInlineContentText(contentRecord['content']);

  return '';
};

const getCanvasBlockLabel = (blockType: string): string => {
  switch (blockType) {
    case 'image':
      return '[Image]';
    case 'video':
      return '[Video]';
    case 'audio':
      return '[Audio]';
    case 'file':
      return '[File]';
    case 'table':
      return '[Table]';
    default:
      return `[${blockType}]`;
  }
};

const canvasBlockToPlainText = (block: unknown, depth = 0): string => {
  if (block === undefined || block === null) return '';
  if (typeof block !== 'object' || Array.isArray(block)) return extractInlineContentText(block);

  const blockRecord = block as Record<string, unknown>;
  const blockType = typeof blockRecord['type'] === 'string' ? blockRecord['type'] : 'paragraph';
  const propsValue = blockRecord['props'];
  const props =
    propsValue && typeof propsValue === 'object' && !Array.isArray(propsValue)
      ? (propsValue as Record<string, unknown>)
      : {};
  const contentText = extractInlineContentText(blockRecord['content']).trimEnd();
  const indent = '  '.repeat(depth);
  const children = Array.isArray(blockRecord['children']) ? blockRecord['children'] : [];

  let prefix = '';
  if (blockType === 'bulletListItem') prefix = '- ';
  if (blockType === 'numberedListItem') prefix = '1. ';
  if (blockType === 'checkListItem') prefix = props['checked'] ? '[x] ' : '[ ] ';

  const ownText =
    contentText || textLikeBlockTypes.has(blockType)
      ? `${indent}${prefix}${contentText}`
      : `${indent}${getCanvasBlockLabel(blockType)}`;
  const childText = children
    .map(child => canvasBlockToPlainText(child, depth + 1))
    .filter(Boolean)
    .join('\n');

  return [ownText.trimEnd(), childText].filter(Boolean).join('\n');
};

export const canvasContentToPlainText = (content: unknown): string => {
  const normalizedContent = normalizeCanvasValue(content);

  if (!Array.isArray(normalizedContent)) {
    return extractInlineContentText(normalizedContent).trim();
  }

  return normalizedContent
    .map(block => canvasBlockToPlainText(block))
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

export const createCanvasContentTextDiff = (
  currentContent: unknown,
  versionContent: unknown,
): CanvasContentDiffPart[] => {
  const currentText = canvasContentToPlainText(currentContent);
  const versionText = canvasContentToPlainText(versionContent);

  return diffWordsWithSpace(currentText, versionText)
    .map(
      (change: Change): CanvasContentDiffPart => ({
        type: change.added ? 'added' : change.removed ? 'removed' : 'same',
        value: change.value,
      }),
    )
    .filter(part => part.value.length > 0);
};

export const createCanvasContentHash = async (content: unknown): Promise<string> => {
  const serialized = stableStringifyCanvasContent(content);

  if (globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(serialized);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = (hash * 31 + serialized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};
