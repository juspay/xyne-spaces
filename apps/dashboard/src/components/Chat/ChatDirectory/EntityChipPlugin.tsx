/**
 * Turns typed `entity:<name>` text into an entity filter chip.
 *
 * Every other chip in the palette is picked from a candidate list (people, channels,
 * boards, priorities, dates), so `MentionPlugin` drives them all through one
 * trigger → typeahead → insert path. Entity names have no such list — the backend matches
 * the name itself — so the value can only come from what the user typed, and the chip is
 * committed by a keystroke instead of a selection. That is a different mechanism, hence a
 * separate plugin rather than another branch in MentionPlugin.
 *
 * The chip needs no callback: `LexicalSearchInput`'s change handler walks the tree and
 * reports every FilterChipNode, so inserting the node is what puts it in the palette's
 * selected filters.
 *
 * Commit keys:
 *   `,`      handled here, via Lexical's KEY_DOWN_COMMAND.
 *   `Enter`  NOT handled here. The palette owns Enter on an ancestor `onKeyDownCapture`,
 *            which runs before the event reaches Lexical at all, so a command listener
 *            would never see it. Instead `onCommitEntityReady` hands the commit function
 *            up to the palette, which calls it from its own handler — the same shape
 *            MentionPlugin uses for `onInsertMentionReady`.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  TextNode,
} from 'lexical';

import { $createFilterChip } from './FilterChipNode';
import { ChipType, type ChipData } from './ChannelCommandMenu.types';

export interface EntityChipPluginProps {
  /**
   * Receives the commit function, for callers that own a key the editor never sees.
   * Returns true when a pending `entity:<value>` was turned into a chip.
   */
  onCommitEntityReady?: (commitEntity: () => boolean) => void;
  currentUserID?: string;
}

export function EntityChipPlugin({
  onCommitEntityReady,
  currentUserID,
}: EntityChipPluginProps): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Command listeners already run inside an editor.update(), so `$`-functions read the
    // in-flight state directly. Reading via editor.getEditorState() here would see the
    // PREVIOUS state and miss the value the user just finished typing.
    const commitPendingEntity = (reArm: boolean): boolean => {
      const pending = findPendingEntity();
      if (!pending) return false;

      const { node, start, caret, value } = pending;
      const text = node.getTextContent();
      const textAfter = text.slice(caret);

      const chipData: ChipData = {
        id: value,
        name: value,
        type: ChipType.ENTITY,
        prefix: ENTITY_PREFIX,
      };

      node.setTextContent(text.slice(0, start));
      const chip = $createFilterChip(chipData, currentUserID);
      // Re-arming leaves the next trigger already typed, so the caret can keep going.
      const trailing = $createTextNode(reArm ? ` ${ENTITY_PREFIX}` : ' ');
      node.insertAfter(chip);
      chip.insertAfter(trailing);
      if (textAfter) trailing.insertAfter($createTextNode(textAfter));
      trailing.selectEnd();

      return true;
    };

    const removeKeyDownCommand = editor.registerCommand(
      KEY_DOWN_COMMAND,
      event => {
        if (event.key !== ',' || event.metaKey || event.ctrlKey || event.altKey) return false;
        if (!commitPendingEntity(true)) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Called from the palette's capture handler, i.e. outside any editor context — so
    // unlike the command listeners above this has to open its own update.
    onCommitEntityReady?.((): boolean => {
      let committed = false;
      editor.update(() => {
        committed = commitPendingEntity(false);
      });
      return committed;
    });

    return (): void => {
      removeKeyDownCommand();
    };
  }, [editor, currentUserID, onCommitEntityReady]);

  return null;
}

const ENTITY_PREFIX = 'entity:';

interface PendingEntity {
  node: TextNode;
  start: number;
  caret: number;
  value: string;
}

/**
 * The uncommitted `entity:<value>` run the caret sits in, or null. Reads only the text
 * BEFORE the caret so a caret parked mid-word doesn't swallow the rest of the line.
 */
function findPendingEntity(): PendingEntity | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const node = selection.anchor.getNode();
  if (!(node instanceof TextNode)) return null;

  const caret = selection.anchor.offset;
  const beforeCaret = node.getTextContent().slice(0, caret);
  const start = beforeCaret.toLowerCase().lastIndexOf(ENTITY_PREFIX);
  if (start === -1) return null;
  // Must start a word, or `identity:foo` would arm on the `entity:` inside it.
  if (start > 0 && /[A-Za-z0-9_]/.test(beforeCaret[start - 1] ?? '')) return null;

  const value = beforeCaret.slice(start + ENTITY_PREFIX.length).trim();
  if (!value) return null;

  return { node, start, caret, value };
}
