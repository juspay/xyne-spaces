/**
 * Promotes a completed typed date filter (`before:`/`after:`/`on:`/`range:`) into
 * a colored chip — but ONLY while the AI Chats tab is active. Everywhere else in
 * Cmd+K date filters stay as plain text (their existing behavior). The chip is a
 * MentionType.FILTER pill: excluded from the query text and carried in the
 * mention list (the command menu reads the date bounds off it).
 *
 * A token promotes once its value is complete AND followed by a space, so partial
 * typing (`before:2026-0`) is left alone. Multi-word values (`range:last 3 days`,
 * `before:15 jan 24`) are matched whole, mirroring the shared searchFilterParser.
 */
import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createTextNode, TextNode } from 'lexical';
import { $createFilterChip } from './FilterChipNode';
import { MentionType } from './ChannelCommandMenu.types';

// A completed date/range token preceded by start-or-space and followed by a space.
// Groups: 1 = leading ws, 2 = prefix word, 3 = value.
const DATE_TOKEN_REGEX =
  /(^|\s)(before|after|on):(\d{4}-\d{1,2}-\d{1,2}|today|yesterday|\d{1,2}\s+[a-z]{3,}\s+\d{2,4})(?=\s)/i;
const RANGE_TOKEN_REGEX =
  /(^|\s)(range):(last\s+\d+\s+days?|last\s+\d+\s+hours?|last\s+24\s+hours|last\s+hour|this\s+week|last\s+week|this\s+month|last\s+month|today|yesterday)(?=\s)/i;

function firstMatch(text: string): { index: number; leadWs: string; prefix: string; value: string } | null {
  const d = DATE_TOKEN_REGEX.exec(text);
  const r = RANGE_TOKEN_REGEX.exec(text);
  // Prefer whichever appears earliest so tokens promote left-to-right.
  const pick = !d ? r : !r ? d : d.index <= r.index ? d : r;
  if (!pick) return null;
  return { index: pick.index, leadWs: pick[1] ?? '', prefix: pick[2]!.toLowerCase(), value: pick[3]!.trim() };
}

export function AiChatFilterChipPlugin({ enabled }: { enabled: boolean }): null {
  const [editor] = useLexicalComposerContext();
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    // A node transform runs on every TextNode mutation; the ref gates it to the
    // AI Chats tab without re-registering.
    return editor.registerNodeTransform(TextNode, node => {
      if (!enabledRef.current) return;
      // Don't touch a chip's own label node (it's a FilterChipNode subclass, not a
      // plain TextNode — registerNodeTransform(TextNode) already excludes subclasses,
      // but guard defensively against future changes).
      if (node.constructor !== TextNode) return;

      const text = node.getTextContent();
      const m = firstMatch(text);
      if (!m) return;

      const tokenStart = m.index + m.leadWs.length;
      const tokenLen = m.prefix.length + 1 + m.value.length; // "before:" + value
      const before = text.slice(0, tokenStart);
      const after = text.slice(tokenStart + tokenLen); // starts with the trailing space

      const chip = $createFilterChip({
        id: m.value,
        name: m.value,
        type: MentionType.FILTER,
        prefix: `${m.prefix}:` as 'before:' | 'after:' | 'on:' | 'range:',
      });
      // Ensure a trailing space so the caret sits after the pill and the next token
      // can be typed/parsed.
      const afterNode = $createTextNode(after.length > 0 ? after : ' ');

      if (before.length > 0) {
        const beforeNode = $createTextNode(before);
        node.replace(beforeNode);
        beforeNode.insertAfter(chip);
      } else {
        node.replace(chip);
      }
      chip.insertAfter(afterNode);
      afterNode.selectStart();
    });
  }, [editor]);

  return null;
}
