import { ReactElement } from 'react';
import { ChipData } from './ChannelCommandMenu.types';
import { ChipIcon, chipLabelText, chipPrefixText, isSelfMentionChip } from './FilterChipNode';
import { cn } from '../../../utils/classNames';

export interface QueryFilterChipsProps {
  mentions: ChipData[];
  currentUserID: string;
  // Refresh a chip's label from live data (usersById / channels). Omit to render the
  // chip's own stored name.
  resolveName?: (chip: ChipData) => string;
}

/**
 * Read-only filter chips rendered as the same `.filter-chip` pills the search box uses. Shared by
 * both the "Show detailed results for" row (live editor chips → pass `resolveName`) and the Recent
 * Searches rows (names already resolved by the hook → omit `resolveName`).
 */
export function QueryFilterChips({
  mentions,
  currentUserID,
  resolveName,
}: QueryFilterChipsProps): ReactElement {
  return (
    <>
      {mentions.map(mention => {
        const chip: ChipData = resolveName ? { ...mention, name: resolveName(mention) } : mention;
        const prefix = chipPrefixText(chip);
        const label = chipLabelText(chip);

        return (
          <span
            key={`${mention.prefix}-${mention.id}`}
            className={cn(
              'filter-chip h-6 px-1.5',
              isSelfMentionChip(chip, currentUserID) && 'filter-chip--self-mention',
            )}
          >
            <span className='leading-tight'>{prefix}</span>
            <ChipIcon mentionData={mention} />
            <span className='leading-tight'>{label}</span>
          </span>
        );
      })}
    </>
  );
}
