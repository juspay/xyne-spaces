import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
import { createReactInlineMathSpec } from '@blocknote/math-block';
import { Extension, type EditorOptions } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { addRowAfter, deleteRow, goToNextCell, isInTable, selectedRect } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { whiteboardBlockSpecs } from 'blocknote-layout-extensions';
import { mentionInlineContentSpec } from './CanvasMentionSpec';
import { citationInlineContentSpec } from './CanvasCitationSpec';
import { knownBlockTypesOf } from '../../utils/canvasUtils';
import { canvasCommentThreadStyleSpec } from './CanvasCommentStyleSpec/CanvasCommentStyleSpec';
import { canvasCodeBlockSpec } from './CanvasCodeBlockSpec';
import { canvasDiagramBlockSpec } from './CanvasDiagramSpec';
import { canvasMathBlockSpec } from './CanvasMathBlockSpec';
import { CANVAS_EMBED_TYPE, canvasEmbedSpec } from './CanvasEmbedSpec';
import { canvasFileBlockSpec } from './CanvasFileBlockSpec';
import { canvasLinkShortcutsExtension } from './canvasLinkShortcuts';
import { canvasPastedLinkExtension } from './canvasPastedLink';
import { canvasSourceBlockShortcutsExtension } from './canvasSourceBlockShortcuts';
import { canvasTableShortcutsExtension } from './canvasTableShortcuts';

// Default blocks + whiteboard, then extended with mention and citation inline content.
// Shared by the canvas editors and the read-only previews: a preview built on a
// different schema silently drops blocks the editor can render, so the two must
// come from one place.
// Helper isolates the type assertion so ESLint no-unsafe-assignment does not trigger at call site.
function createCanvasSchema() {
  return BlockNoteSchema.create({
    blockSpecs: Object.assign({}, defaultBlockSpecs, whiteboardBlockSpecs, {
      diagram: canvasDiagramBlockSpec,
      mathBlock: canvasMathBlockSpec,
      codeBlock: canvasCodeBlockSpec,
      [CANVAS_EMBED_TYPE]: canvasEmbedSpec,
      file: canvasFileBlockSpec,
    }),
  } as Parameters<typeof BlockNoteSchema.create>[0]).extend({
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      math: createReactInlineMathSpec(),
      mention: mentionInlineContentSpec,
      citation: citationInlineContentSpec,
    },
    styleSpecs: {
      canvasCommentThread: canvasCommentThreadStyleSpec,
    },
  });
}

export const canvasSchema = createCanvasSchema();

export const knownCanvasBlockTypes = knownBlockTypesOf(canvasSchema);

export const canvasTableOptions = {
  splitCells: true,
  cellBackgroundColor: true,
  cellTextColor: true,
  headers: true,
} as const;

const pendingExitRowPluginKey = new PluginKey<number | null>('canvasTablePendingExitRow');

const canvasTablePendingExitRowExtension = Extension.create({
  name: 'canvasTablePendingExitRow',
  addProseMirrorPlugins: () => [
    new Plugin<number | null>({
      key: pendingExitRowPluginKey,
      state: {
        init: () => null,
        apply: (transaction, pendingRowPosition) => {
          const nextPosition = transaction.getMeta(pendingExitRowPluginKey) as
            | number
            | null
            | undefined;
          if (nextPosition !== undefined) return nextPosition;
          if (pendingRowPosition === null) return null;

          const mappedPosition = transaction.mapping.mapResult(pendingRowPosition, -1);
          return mappedPosition.deleted ? null : mappedPosition.pos;
        },
      },
    }),
  ],
});

const dispatchSelection =
  (view: EditorView, pendingRowPosition?: number | null) =>
  (transaction: Transaction): void => {
    if (pendingRowPosition !== undefined) {
      transaction.setMeta(pendingExitRowPluginKey, pendingRowPosition);
    }

    view.dispatch(transaction.setMeta('addToHistory', false).scrollIntoView());
  };

const clearPendingExitRow = (view: EditorView): void => {
  const pendingRowPosition = pendingExitRowPluginKey.getState(view.state);
  if (pendingRowPosition === null || pendingRowPosition === undefined) return;

  view.dispatch(
    view.state.tr.setMeta(pendingExitRowPluginKey, null).setMeta('addToHistory', false),
  );
};

const getTableRowPosition = (
  tableStart: number,
  table: ProseMirrorNode,
  rowIndex: number,
): number => {
  let rowPosition = tableStart;

  for (let index = 0; index < rowIndex; index += 1) {
    rowPosition += table.child(index).nodeSize;
  }

  return rowPosition;
};

const getCurrentTableCellContext = (
  view: EditorView,
): {
  insertedRowPosition: number;
  isLastCell: boolean;
  isRowEmpty: boolean;
  rowEndPosition: number;
  rowPosition: number;
  tablePosition: number;
} | null => {
  if (!isInTable(view.state)) return null;

  const { bottom, map, right, table, tableStart, top: rowIndex } = selectedRect(view.state);
  const rowPosition = getTableRowPosition(tableStart, table, rowIndex);
  const row = table.child(rowIndex);

  return {
    insertedRowPosition: getTableRowPosition(tableStart, table, bottom),
    isLastCell: bottom === map.height && right === map.width,
    isRowEmpty: row.textContent.trim().length === 0,
    rowEndPosition: rowPosition + row.nodeSize,
    rowPosition,
    tablePosition: tableStart - 1,
  };
};

type TableCellContext = NonNullable<ReturnType<typeof getCurrentTableCellContext>>;

const isPendingExitRow = (view: EditorView, context: TableCellContext): boolean => {
  const pendingRowPosition = pendingExitRowPluginKey.getState(view.state);

  return (
    pendingRowPosition !== null &&
    pendingRowPosition !== undefined &&
    pendingRowPosition > context.rowPosition &&
    pendingRowPosition < context.rowEndPosition &&
    context.isRowEmpty
  );
};

const getAfterTableBlockPosition = (
  transaction: Transaction,
  tablePosition: number,
): number | null => {
  const resolvedTablePosition = transaction.doc.resolve(tablePosition);

  for (let depth = resolvedTablePosition.depth; depth > 0; depth -= 1) {
    if (resolvedTablePosition.node(depth).type.name === 'blockContainer') {
      return resolvedTablePosition.after(depth);
    }
  }

  return null;
};

const exitTable = (
  view: EditorView,
  tablePosition: number,
  transaction = view.state.tr,
): boolean => {
  const nextBlockPosition = getAfterTableBlockPosition(transaction, tablePosition);
  if (nextBlockPosition === null) return false;

  const blockContainer = view.state.schema.nodes['blockContainer'];
  const paragraph = view.state.schema.nodes['paragraph'];
  if (!blockContainer || !paragraph) return false;

  const paragraphNode = paragraph.createAndFill();
  if (!paragraphNode) return false;

  const nextBlock = blockContainer.createAndFill(undefined, paragraphNode);
  if (!nextBlock) return false;

  transaction.insert(nextBlockPosition, nextBlock);

  view.dispatch(
    transaction
      .setMeta(pendingExitRowPluginKey, null)
      .setSelection(TextSelection.create(transaction.doc, nextBlockPosition + 2))
      .scrollIntoView(),
  );

  return true;
};

const deleteCurrentRowAndExitTable = (view: EditorView, tablePosition: number): boolean => {
  let didExit = false;

  deleteRow(view.state, transaction => {
    didExit = exitTable(view, tablePosition, transaction);
  });

  return didExit;
};

const addRowOrExitTable = (view: EditorView): boolean => {
  const context = getCurrentTableCellContext(view);
  if (!context) return false;

  if (isPendingExitRow(view, context)) {
    return deleteCurrentRowAndExitTable(view, context.tablePosition);
  }

  if (!context.isLastCell) {
    clearPendingExitRow(view);
    return true;
  }

  if (
    addRowAfter(view.state, transaction =>
      view.dispatch(
        transaction
          .setMeta(pendingExitRowPluginKey, context.insertedRowPosition + 1)
          .scrollIntoView(),
      ),
    )
  ) {
    goToNextCell(1)(view.state, dispatchSelection(view), view);
    return true;
  }

  return false;
};

const handleCanvasTableKeyDown = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key === 'Enter') {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) {
      return false;
    }

    return addRowOrExitTable(view);
  }

  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey) {
    if (event.key !== 'Tab') {
      clearPendingExitRow(view);
    }
    return false;
  }

  const context = getCurrentTableCellContext(view);
  if (!context) return false;

  if (event.shiftKey) {
    goToNextCell(-1)(view.state, dispatchSelection(view, null), view);
    return true;
  }

  if (isPendingExitRow(view, context)) {
    return addRowOrExitTable(view);
  }

  if (context.isLastCell) {
    return addRowOrExitTable(view);
  }

  goToNextCell(1)(view.state, dispatchSelection(view, null), view);
  return true;
};

export const canvasTiptapOptions = {
  extensions: [
    canvasTablePendingExitRowExtension,
    canvasPastedLinkExtension,
    canvasLinkShortcutsExtension,
    canvasTableShortcutsExtension,
    canvasSourceBlockShortcutsExtension,
  ],
  editorProps: {
    handleKeyDown: handleCanvasTableKeyDown,
  },
} satisfies Partial<EditorOptions>;
