import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';

/** How the typing bar draws a draft attachment: a picture tile, a video tile or a file chip. */
export type ComposerAttachmentKind = 'image' | 'video' | 'file';

/** Where its upload is; a chip still on the device counts as uploading. */
export type ComposerAttachmentPhase = 'uploading' | 'failed' | 'ready';

export function composerAttachmentKind(mimetype: string): ComposerAttachmentKind {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
}

export function composerAttachmentPhase(
  status: ComposerAttachment['status'],
): ComposerAttachmentPhase {
  if (status === 'failed') return 'failed';
  return status === 'uploaded' ? 'ready' : 'uploading';
}

const KIND_LABEL: Readonly<Record<ComposerAttachmentKind, string>> = {
  image: 'Photo',
  video: 'Video',
  file: 'File',
};

/** A screen reader's name for a tile: "Photo, beach.jpg", then whether it is still going up. */
export function composerAttachmentLabel(
  kind: ComposerAttachmentKind,
  phase: ComposerAttachmentPhase,
  name: string,
): string {
  const base = `${KIND_LABEL[kind]}, ${name}`;
  if (phase === 'failed') return `${base}, upload failed`;
  return phase === 'uploading' ? `${base}, uploading` : base;
}
