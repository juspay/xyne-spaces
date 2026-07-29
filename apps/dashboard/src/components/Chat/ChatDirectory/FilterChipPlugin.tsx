/**
 * Demotes a filter chip to plain text the moment its label is edited (the
 * Slack-style chip → plain-text transition). Because the prefix and icon live inside
 * the FilterChipContainerNode, replacing the container drops the whole pill in one
 * step — no pairing/orphan bookkeeping needed.
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

// Replace the whole pill (container + prefix + icon + label) with its FULL text as plain
// text, preserving the caret offset. The `from:`/`in:` prefix lives in its own node, so the
// text is read off the container (`from: alice`), not the label alone (`alice`) — dropping
// the prefix would turn an author/scope filter into a bare word search. Plain text re-arms
// the mention dropdown, so a demoted chip stays editable and re-pickable; promotion only
// happens on an explicit pick.
function $demoteChip(chip: FilterChipNode): void {
  const label = chip.getTextContent();
  const parent = chip.getParent();
  const container = $isFilterChipContainerNode(parent) ? parent : null;
  const text = container ? container.getTextContent() : label;
  // The label is always the container's last child, so everything before it is the prefix —
  // shift the caret by that much to keep it on the same character.
  const prefixLength = text.length - label.length;

  const selection = $getSelection();
  const offset =
    $isRangeSelection(selection) && selection.anchor.getNode() === chip
      ? prefixLength + selection.anchor.offset
      : text.length;

  const plain = $createTextNode(text);
  (container ?? chip).replace(plain);
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
