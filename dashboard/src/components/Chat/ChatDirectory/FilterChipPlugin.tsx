/**
 * Demotes a filter chip to plain text the moment its label is edited (the
 * Slack-style chip → plain-text transition). Because the icon lives inside the
 * FilterChipContainerNode, replacing the container drops the pill + icon in one
 * step — no icon pairing/orphan bookkeeping needed.
 *
 *   - On label edit (text diverges from `__expectedText`) → demote.
 *   - On Backspace at the label's start → demote instead of deleting into the
 *     icon (which would leave a half-styled pill).
 */

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
} from 'lexical';
import {
  FilterChipNode,
  FilterChipContainerNode,
  $isFilterChipNode,
  $isFilterChipContainerNode,
} from './FilterChipNode';

// Replace the whole pill (container + icon + label) with its label as plain text,
// preserving the caret offset. Plain text re-arms the mention dropdown, so a demoted
// chip stays editable and re-pickable; promotion only happens on an explicit pick.
function $demoteChip(chip: FilterChipNode): void {
  const text = chip.getTextContent();
  const selection = $getSelection();
  const offset =
    $isRangeSelection(selection) && selection.anchor.getNode() === chip
      ? selection.anchor.offset
      : text.length;

  const plain = $createTextNode(text);
  const parent = chip.getParent();
  ($isFilterChipContainerNode(parent) ? parent : chip).replace(plain);
  plain.select(offset, offset);
}

export function FilterChipPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterTransform = editor.registerNodeTransform(FilterChipNode, node => {
      // `getLatest()` avoids acting on a stale handle from earlier in the chain.
      const latest = node.getLatest();
      if (latest.getTextContent() !== latest.__expectedText) {
        $demoteChip(latest);
      }
    });

    // When the chip text is fully selected and cut (cmd+x), Lexical removes the
    // FilterChipNode outright rather than mutating its text. A removed node does
    // NOT get its own transform fired, so the parent container + icon are left
    // behind as an empty blue pill (the `.filter-chip` background + padding).
    // This transform catches that orphan case.
    const unregisterContainerTransform = editor.registerNodeTransform(
      FilterChipContainerNode,
      container => {
        const latest = container.getLatest();
        const hasTextChild = latest.getChildren().some(child => $isFilterChipNode(child));
        if (!hasTextChild) {
          const empty = $createTextNode('');
          latest.replace(empty);
        }
      },
    );

    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const anchorNode = selection.anchor.getNode();
          if ($isFilterChipNode(anchorNode) && selection.anchor.offset === 0) {
            $demoteChip(anchorNode);
            handled = true;
          }
        });
        return handled;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterTransform();
      unregisterContainerTransform();
      unregisterBackspace();
    };
  }, [editor]);

  return null;
}
