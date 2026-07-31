import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
import { whiteboardBlockSpecs } from 'blocknote-layout-extensions';
import { mentionInlineContentSpec } from './CanvasMentionSpec';
import { knownBlockTypesOf } from '../../utils/canvasUtils';
import { canvasCommentThreadStyleSpec } from './CanvasCommentStyleSpec/CanvasCommentStyleSpec';

// Default blocks + whiteboard, then extended with mention inline content.
// Shared by the canvas editors and the read-only previews: a preview built on a
// different schema silently drops blocks the editor can render, so the two must
// come from one place.
// Helper isolates the type assertion so ESLint no-unsafe-assignment does not trigger at call site.
function createCanvasSchema() {
  return BlockNoteSchema.create({
    blockSpecs: Object.assign({}, defaultBlockSpecs, whiteboardBlockSpecs),
  } as Parameters<typeof BlockNoteSchema.create>[0]).extend({
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: mentionInlineContentSpec,
    },
    styleSpecs: {
      canvasCommentThread: canvasCommentThreadStyleSpec,
    },
  });
}

export const canvasSchema = createCanvasSchema();

export const knownCanvasBlockTypes = knownBlockTypesOf(canvasSchema);
