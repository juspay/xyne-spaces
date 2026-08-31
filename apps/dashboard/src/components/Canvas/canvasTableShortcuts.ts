import { Extension } from '@tiptap/core';
import type { Command, EditorState } from '@tiptap/pm/state';
import {
  addColumnBefore,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  isInTable,
  selectionCell,
} from '@tiptap/pm/tables';

/**
 * Excel's table keys, which the canvas had none of.
 *
 * Tab already walks the cells and Enter adds a row off the last one; reshaping
 * the table had nothing at all. Excel needs only two editing keys because the
 * selection says whether a row or a column is meant, and insert puts the new one
 * above or to the left of it. Its modifier is Control, which leaves Cmd-plus and
 * Cmd-minus to the browser's zoom.
 */
export const TABLE_SHORTCUTS = {
  selectRow: 'Shift-Space',
  selectColumn: 'Ctrl-Space',
  insert: 'Ctrl-Shift-=',
  delete: 'Ctrl--',
} as const;

/** Labels for the table handle menu, keyed by what the menu calls each action. */
export const TABLE_SHORTCUT_HINTS: Readonly<Record<string, string>> = {
  row: TABLE_SHORTCUTS.selectRow,
  column: TABLE_SHORTCUTS.selectColumn,
  insert: TABLE_SHORTCUTS.insert,
  delete: TABLE_SHORTCUTS.delete,
};

const isColumnSelected = (state: EditorState): boolean =>
  state.selection instanceof CellSelection && state.selection.isColSelection();

/** Selects the whole row or column the caret is in, the way Excel does. */
const selectAcross = (orientation: 'row' | 'column'): Command =>
  function selectRowOrColumn(state, dispatch): boolean {
    const cell = selectionCell(state);
    if (!cell) return false;
    if (dispatch) {
      const selection =
        orientation === 'row'
          ? CellSelection.rowSelection(cell, cell)
          : CellSelection.colSelection(cell, cell);
      dispatch(state.tr.setSelection(selection));
    }
    return true;
  };

/** Insert and delete read the selection to know which way round they act. */
const acrossSelection = (row: Command, column: Command): Command =>
  function actOnSelection(state, dispatch, view): boolean {
    return isColumnSelected(state) ? column(state, dispatch, view) : row(state, dispatch, view);
  };

export const canvasTableShortcutsExtension = Extension.create({
  name: 'canvasTableShortcuts',

  addKeyboardShortcuts() {
    const run = (command: Command) => (): boolean => {
      const view = this.editor.view;
      if (!isInTable(view.state)) return false;
      return command(view.state, view.dispatch.bind(view), view);
    };

    return {
      [TABLE_SHORTCUTS.selectRow]: run(selectAcross('row')),
      [TABLE_SHORTCUTS.selectColumn]: run(selectAcross('column')),
      [TABLE_SHORTCUTS.insert]: run(acrossSelection(addRowBefore, addColumnBefore)),
      [TABLE_SHORTCUTS.delete]: run(acrossSelection(deleteRow, deleteColumn)),
    };
  },
});
