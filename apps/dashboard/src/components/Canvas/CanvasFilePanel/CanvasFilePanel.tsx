import { type FilePanelProps, useBlockNoteEditor } from '@blocknote/react';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { classifyMediaKind } from '@xyne/shared';
import { type FC, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { editorView } from '../canvasEditorView';

const ACCEPT_BY_BLOCK: Readonly<Record<string, string>> = {
  file: '*/*',
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
};

const promptForFile = (accept: string): Promise<File | null> =>
  new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    // Cancelling a file dialog fires no event, so focus returning to the window is
    // what tells us it closed; without it the promise would never settle.
    const settle = (file: File | null): void => {
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    const onFocus = (): void => {
      window.setTimeout(() => settle(input.files?.[0] ?? null), 300);
    };

    input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true });
    window.addEventListener('focus', onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });

interface CanvasBlock {
  type: string;
  props?: { url?: unknown };
}

interface UploadingEditor {
  uploadFile?: (file: File, blockId?: string) => Promise<string | Record<string, unknown>>;
  getBlock: (blockId: string) => CanvasBlock | undefined;
  updateBlock: (blockId: string, update: { type?: string; props: Record<string, unknown> }) => void;
  removeBlocks: (blockIds: string[]) => void;
}

/**
 * Moves the cursor off the block the panel selected.
 *
 * The panel leaves a node selection on the block; replacing the node under it
 * makes Yjs throw when it later tries to restore that selection.
 */
const releaseNodeSelection = (editor: unknown, blockId: string): void => {
  const view = editorView(editor);
  if (!view) return;
  const { selection } = view.state;
  // Only this block's own selection: by now the upload may have taken long enough
  // for the reader to have selected something else, which is not ours to move.
  if (!(selection instanceof NodeSelection) || selection.node.attrs['id'] !== blockId) return;
  view.dispatch(view.state.tr.setSelection(Selection.near(selection.$to, 1)));
};

/** An empty file block is only ever a placeholder for the picker, so drop it. */
const discardIfEmpty = (api: UploadingEditor, blockId: string): void => {
  if (api.getBlock(blockId)?.props?.url) return;
  try {
    api.removeBlocks([blockId]);
  } catch {
    // The block is already gone; nothing to discard.
  }
};

/**
 * Stands in for BlockNote's file dialog and opens the file picker instead.
 *
 * Upload and embed both ended in the same place for a file, image, video or audio
 * block, so with embed gone the dialog was a panel whose only content was a button
 * that opened the picker. Being the panel rather than a separate watcher covers
 * every way BlockNote asks for a file: inserting the block, and its add-file button.
 *
 * With one Upload item rather than four, the block becomes whatever the chosen
 * file turns out to be; a block that already knows its type keeps it.
 */
export const CanvasFilePanel: FC<FilePanelProps> = ({ blockId }): null => {
  const editor = useBlockNoteEditor();
  const promptedFor = useRef<string | null>(null);

  useEffect(() => {
    const api = editor as unknown as UploadingEditor | null;
    const upload = api?.uploadFile;
    if (!api || !upload || !blockId || promptedFor.current === blockId) return;
    promptedFor.current = blockId;

    void (async (): Promise<void> => {
      const file = await promptForFile(ACCEPT_BY_BLOCK[api.getBlock(blockId)?.type ?? ''] ?? '*/*');
      if (!file) {
        discardIfEmpty(api, blockId);
        return;
      }

      try {
        // Named before the upload starts so the uploading card can show which file.
        api.updateBlock(blockId, { props: { name: file.name } });

        const uploaded = await upload(file, blockId);
        const url = typeof uploaded === 'string' ? uploaded : uploaded['url'];
        if (typeof url !== 'string' || !url) throw new Error('upload returned no url');

        // Read again rather than reusing the type from before the picker: an upload
        // is long enough for a collaborator to have changed the block underneath.
        const blockType = api.getBlock(blockId)?.type ?? '';
        // Only the generic block is undecided.
        const kind = blockType === 'file' ? classifyMediaKind(file.type, file.name) : blockType;
        const converts = kind !== blockType;

        if (converts) releaseNodeSelection(editor, blockId);

        api.updateBlock(blockId, {
          ...(converts ? { type: kind } : {}),
          props: { url, name: file.name },
        });
      } catch {
        toast.error('Upload failed', { description: file.name });
        discardIfEmpty(api, blockId);
      }
    })();
  }, [editor, blockId]);

  return null;
};
