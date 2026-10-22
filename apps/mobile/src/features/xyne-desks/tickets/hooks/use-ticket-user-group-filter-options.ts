import { useMemo } from 'react';

import { useUserGroups } from '@/src/hooks/useUserGroups';

import type { TicketsMultiSelectFilterOption } from '../components/tickets-multi-select-filter';

/**
 * Active user groups for the User Groups filter (mirrors dashboard UserGroupSubmenu).
 */
export function useTicketUserGroupFilterOptions(): {
  options: TicketsMultiSelectFilterOption[];
} {
  const groups = useUserGroups();

  const options = useMemo((): TicketsMultiSelectFilterOption[] => {
    return groups.map(group => {
      const label = group.name?.trim() || group.alias?.trim() || 'Untitled group';
      const subtitle =
        group.alias?.trim() && group.alias.trim() !== group.name?.trim()
          ? `@${group.alias.trim()}`
          : undefined;
      return subtitle !== undefined ? { id: group.id, label, subtitle } : { id: group.id, label };
    });
  }, [groups]);

  return { options };
}
