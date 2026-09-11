import { JSX, useMemo } from 'react';
import { parseAppliedTags, visibleTags } from '@xyne/shared';
import { useThreadTypeVocabulary } from '../../hooks/useThreadTypeVocabulary';
import { colorForTagName } from './tagColors';

interface MessageTagsProps {
  /** `messages.messageActs` — the thread types this message was cited as evidence for. */
  messageActs: string | null | undefined;
  /**
   * The tag being inspected from the thread header. Only that one renders, and only on the
   * messages that carry it — so clicking a header chip answers "which messages made this an
   * ISSUE" without marking up every message that happens to carry some other tag.
   */
  inspectedTag: string | null;
}

/**
 * Marks this message as evidence for the tag being inspected.
 *
 * The classifier cites the messages behind each type it returns, and that citation is stored
 * on the messages themselves — so clicking a chip in the thread header and seeing which
 * messages sprout one is the answer to "why is this thread an ISSUE".
 *
 * Renders nothing unless a tag is being inspected: a chip on every classified message, all
 * the time, is noise on the threads that need reading most.
 *
 * Read-only. A thread's tags are edited from the header, not per message — the tag belongs
 * to the thread, and this only shows where it came from.
 */
export const MessageTags = ({
  messageActs,
  inspectedTag,
}: MessageTagsProps): JSX.Element | null => {
  const { entry: vocabularyEntry } = useThreadTypeVocabulary();
  const tags = useMemo(
    () =>
      inspectedTag
        ? visibleTags(parseAppliedTags(messageActs)).filter(tag => tag.name === inspectedTag)
        : [],
    [messageActs, inspectedTag],
  );

  if (tags.length === 0) return null;

  return (
    <span className='inline-flex flex-wrap items-center gap-1 align-middle ml-1'>
      {tags.map(tag => {
        // Undefined for a free-form tag, or a name from a vocabulary that has since changed
        // — both keep rendering from the stored name rather than disappearing.
        const entry = vocabularyEntry(tag.name);
        const color = entry?.color ?? colorForTagName(tag.name);
        return (
          <span
            key={tag.name}
            title={entry?.description ?? tag.name}
            className='inline-flex items-center rounded-full px-1.5 text-[10px] font-medium leading-[15px] whitespace-nowrap align-middle'
            style={{ backgroundColor: `${color}1f`, color }}
          >
            {entry?.label ?? tag.name}
          </span>
        );
      })}
    </span>
  );
};
