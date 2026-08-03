import { JSX } from 'react';
import { PROJECT_TAG_TYPE, vocabularyEntry } from '@xyne/shared';
import { colorForTagName } from './tagColors';

interface ThreadTypeChipProps {
  /** `conversations.threadType` — ISSUE, REQUEST, DISCUSSION, … or null when unclassified. */
  threadType: string | null | undefined;
}

/**
 * What kind of thread this is, for a channel-list row.
 *
 * Reads the value straight off the conversation row the list already renders — no query,
 * no join. That is the whole reason threadType is a column rather than a mapping table.
 *
 * Read-only by design: a thread's type is one value set by the classifier, and a list row
 * has neither the space nor the right affordance for editing it.
 */
export const ThreadTypeChip = ({ threadType }: ThreadTypeChipProps): JSX.Element | null => {
  if (!threadType) {
    return null;
  }

  const entry = vocabularyEntry(PROJECT_TAG_TYPE.THREAD_TYPE, threadType);
  const color = entry?.color ?? colorForTagName(threadType);

  return (
    <span
      className='inline-flex items-center px-1.5 py-[1px] rounded-full text-[11px] font-medium leading-[16px] whitespace-nowrap align-middle'
      style={{ backgroundColor: `${color}1f`, color }}
      title={entry?.description ?? threadType}
    >
      {entry?.label ?? threadType}
    </span>
  );
};
