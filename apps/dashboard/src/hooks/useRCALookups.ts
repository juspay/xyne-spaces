import { useMemo } from 'react';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useUsers } from './useUsers';
import type { SelectOption } from '../routes/RCAScreen/RCAScreen.types';
import {
  formatRcaValue,
  getQuickFixActionValue,
  getRcaBugTypeValues,
  getRcaBugTypeOptions,
  getRcaCategoryConfigByValue,
  getRcaCategoryValues,
  getRcaCategoryValuesForBugType,
  getRcaCategoryOptions,
  getRcaCoeActionOptions,
  getRcaImpactTypeOptions,
  getRcaQuickFixOptions,
  getSharedHiddenCoeActionValues,
  type RcaCacConfig,
} from '../routes/RCAScreen/rcaCacConfig';

export interface RcaLookupContext {
  bugTypeId?: string | null;
  categoryTypeId?: string | null;
}

export interface UseRCALookupsProps {
  ticketId: string;
  selectedRecord: RcaLookupContext | null;
  config: RcaCacConfig;
}

export const useRCALookups = ({ ticketId, selectedRecord, config }: UseRCALookupsProps) => {
  const users = useUsers();
  const ownerItems = useMemo(
    () => users.map(user => ({ label: user.name || user.email, value: user.id })),
    [users],
  );

  const [releaseAttributionsData] = useCachedQuery(
    queries.releaseAttributionsByTicketId({ ticketId }),
    { enabled: !!ticketId },
  );
  const releaseTicketIds = useMemo(
    () =>
      Array.from(
        new Set(
          (releaseAttributionsData ?? [])
            .map(attribution => attribution.releaseId)
            .filter((id): id is string => !!id),
        ),
      ),
    [releaseAttributionsData],
  );
  const [releaseTicketsData] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: releaseTicketIds }),
    { enabled: releaseTicketIds.length > 0 },
  );
  const releaseApplicationIds = useMemo(
    () =>
      (releaseAttributionsData ?? [])
        .map(attribution => attribution.releaseApplicationId)
        .filter((id): id is string => !!id),
    [releaseAttributionsData],
  );
  const [releaseSubTicketsData] = useCachedQuery(
    queries.subTicketsByIds({ subTicketIds: releaseApplicationIds }),
    { enabled: releaseApplicationIds.length > 0 },
  );

  const impactTypeOptions = useMemo(() => getRcaImpactTypeOptions(config), [config]);
  const bugTypeOptions = useMemo(() => getRcaBugTypeOptions(config), [config]);

  const categoryOptions = useMemo(() => getRcaCategoryOptions(config), [config]);

  const categoryOptionsByBugTypeValue = useMemo(
    () =>
      Object.fromEntries(
        getRcaBugTypeValues(config).map(bugTypeLabel => [
          bugTypeLabel,
          getRcaCategoryValuesForBugType(config, bugTypeLabel).map(categoryLabel => ({
            label: formatRcaValue(categoryLabel),
            value: categoryLabel,
          })),
        ]),
      ) as Record<string, SelectOption[]>,
    [config],
  );

  const issueCategoryOptionsByCategoryValue = useMemo(
    () =>
      Object.fromEntries(
        getRcaCategoryValues(config).map(categoryLabel => [
          categoryLabel,
          (getRcaCategoryConfigByValue(config, categoryLabel)?.issueCategories ?? []).map(
            label => ({
              label: formatRcaValue(label),
              value: label,
            }),
          ),
        ]),
      ) as Record<string, SelectOption[]>,
    [config],
  );

  const issueCategoryRequiredByCategoryValue = useMemo(
    () =>
      Object.fromEntries(
        getRcaCategoryValues(config).map(categoryLabel => [
          categoryLabel,
          (getRcaCategoryConfigByValue(config, categoryLabel)?.issueCategories.length ?? 0) > 0,
        ]),
      ) as Record<string, boolean>,
    [config],
  );

  const bugTypeValue = selectedRecord?.bugTypeId ?? '';
  const categoryValue = selectedRecord?.categoryTypeId ?? '';
  const coeActionTypeOptions = useMemo(
    () => getRcaCoeActionOptions(config, bugTypeValue, categoryValue),
    [bugTypeValue, categoryValue, config],
  );

  const hiddenCoeActionValues = useMemo(() => getSharedHiddenCoeActionValues(config), [config]);

  const coeActionLabelByValue = useMemo(() => {
    const pairs = [
      ...coeActionTypeOptions,
      ...hiddenCoeActionValues.map(label => ({
        label: formatRcaValue(label),
        value: label,
      })),
    ];
    return new Map(pairs.map(option => [option.value, option.label]));
  }, [coeActionTypeOptions, hiddenCoeActionValues]);

  const quickFixOptions = useMemo(() => getRcaQuickFixOptions(config), [config]);
  const quickFixActionValue = useMemo(() => getQuickFixActionValue(config) ?? '', [config]);

  return {
    ownerItems,
    releaseAttributionsData,
    releaseTicketsData,
    releaseSubTicketsData,
    impactTypeOptions,
    bugTypeOptions,
    categoryOptions,
    categoryOptionsByBugTypeValue,
    issueCategoryOptionsByCategoryValue,
    issueCategoryRequiredByCategoryValue,
    coeActionTypeOptions,
    coeActionLabelByValue,
    quickFixOptions,
    quickFixActionValue,
    hiddenCoeActionValues,
  };
};
