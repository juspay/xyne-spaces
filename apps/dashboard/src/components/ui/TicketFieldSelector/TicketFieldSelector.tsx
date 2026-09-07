import { useMemo, useState } from 'react';
import { useTicketFieldSearch } from '../../../hooks/useTicketFieldSearch';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuth } from '../../../hooks/useAuth';
import { queries } from '../../../zero/queries';
import { EntitySelector } from '../EntitySelector/EntitySelector';
import type { SelectorOption } from '../EntitySelector/EntitySelector.types';
import { looksLikeXyneId } from '../../Tickets/TicketLinkField/ticketLinkUtils';
import { cn } from '../../../utils/classNames';

export interface TicketFieldSelectorProps {
  /** Selected ticket xyneId ("TOKEN-4127") — the value stored for the form field. */
  selectedValue?: string | null;
  /** Emits the selected ticket's xyneId, or null when the selection is cleared. */
  onSelect: (ticketXyneId: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Scope the search to a project; omit to search across the workspace. */
  projectId?: string | undefined;
  disabled?: boolean;
  className?: string;
  testId?: string | undefined;
}

/**
 * TicketFieldSelector - a form-field control that searches tickets via Vespa
 * and stores the selected ticket's xyneId (what users search and see) as the
 * field's string value. Built on EntitySelector; search is fully server-side.
 */
export const TicketFieldSelector: React.FC<TicketFieldSelectorProps> = ({
  selectedValue,
  onSelect,
  placeholder,
  searchPlaceholder,
  projectId,
  disabled = false,
  className,
  testId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { results, isLoading, hasMore, handleSearchChange, handleScrollEnd } = useTicketFieldSearch(
    { isActive: isOpen, projectId },
  );

  // Resolve the selected ticket so the closed trigger can display its title.
  // Values are xyneIds; legacy stored values (ticket uuids) still resolve by id.
  const { user } = useAuth();
  const workspaceId = user?.workspaceId ?? '';
  const selectedIsXyneId = selectedValue ? looksLikeXyneId(selectedValue) : false;
  const [selectedTicketById] = useCachedQuery(
    queries.ticketRowById({ ticketId: !selectedIsXyneId ? (selectedValue ?? '') : '' }),
    { enabled: Boolean(selectedValue) && !selectedIsXyneId },
  );
  const [selectedTicketByXyneId] = useCachedQuery(
    queries.ticketByXyneIdV3({
      xyneId: selectedIsXyneId ? (selectedValue ?? '') : '',
      workspaceId,
    }),
    { enabled: selectedIsXyneId && Boolean(workspaceId) },
  );
  const selectedTicket = selectedIsXyneId ? selectedTicketByXyneId : selectedTicketById;

  const options = useMemo<SelectorOption[]>(() => {
    const base: SelectorOption[] = results.map(ticket => ({
      value: ticket.xyneId || ticket.id,
      label: ticket.title || ticket.xyneId || ticket.id,
      subtitle: ticket.xyneId || ticket.id,
      icon: null,
    }));

    if (selectedValue && selectedTicket && !base.some(option => option.value === selectedValue)) {
      base.unshift({
        value: selectedValue,
        label: selectedTicket.title || selectedTicket.xyneId || selectedTicket.id,
        subtitle: selectedTicket.xyneId || selectedTicket.id,
        icon: null,
      });
    }

    return base;
  }, [results, selectedValue, selectedTicket]);

  return (
    <div className={cn(disabled && 'pointer-events-none opacity-70', className)}>
      <EntitySelector
        options={options}
        selectedValue={selectedValue ?? null}
        onSelect={onSelect}
        placeholder={placeholder ?? 'Select a ticket'}
        searchPlaceholder={searchPlaceholder ?? 'Search by ticket ID or name'}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onSearchChange={handleSearchChange}
        onScrollEnd={handleScrollEnd}
        hasMore={hasMore}
        isLoading={isLoading}
        disableClientFiltering
        width='100%'
        showClearButton
        {...(testId ? { testId } : {})}
      />
    </div>
  );
};
