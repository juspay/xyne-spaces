import { useMemo } from 'react';
import { LookupType, RCAStatus } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useUsers } from './useUsers';
import { formatEnumLabel } from '../routes/RCAScreen/RCAScreen.utils';
import type { Phase } from '../routes/RCAScreen/RCAScreen.types';

export interface UseRCALookupsProps {
  ticketId: string;
  activePhase: Phase;
  selectedRecord: {
    status?: RCAStatus;
    bugTypeId?: string | null;
    categoryTypeId?: string | null;
    issueCategoryId?: string | null;
  } | null;
  pendingRCA: { bugTypeId?: string; categoryTypeId?: string; issueCategoryId?: string } | null;
  bugLookupsLoaded: boolean;
  impactLookupsLoaded: boolean;
  coeLookupsLoaded: boolean;
}

export const useRCALookups = ({
  ticketId,
  activePhase,
  selectedRecord,
  pendingRCA,
  bugLookupsLoaded,
  impactLookupsLoaded,
  coeLookupsLoaded,
}: UseRCALookupsProps) => {
  const users = useUsers();
  const ownerItems = useMemo(
    () => users.map(user => ({ label: user.name || user.email, value: user.id })),
    [users],
  );

  const isClosedRca = selectedRecord?.status === RCAStatus.CLOSED;

  const shouldLoadBugLookups =
    isClosedRca ||
    bugLookupsLoaded ||
    activePhase === 'rca' ||
    activePhase === 'coe' ||
    !selectedRecord;
  const shouldLoadImpactLookups = isClosedRca || impactLookupsLoaded || activePhase === 'impact';

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

  const [impactTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.IMPACT_TYPE }),
    { enabled: shouldLoadImpactLookups },
  );
  const impactTypesData = impactTypesDataRaw ?? [];
  const impactTypeOptions = useMemo(
    () =>
      impactTypesData.map((lt: { id: string; value: string }) => ({
        label: formatEnumLabel(lt.value),
        value: lt.id,
      })),
    [impactTypesData],
  );

  const [bugTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_TYPE }),
    { enabled: shouldLoadBugLookups },
  );
  const bugTypesData = bugTypesDataRaw ?? [];
  const bugTypeOptions = useMemo(
    () =>
      bugTypesData.map((lt: { id: string; value: string }) => ({
        label: lt.value,
        value: lt.id,
      })),
    [bugTypesData],
  );
  const bugTypeValueById = useMemo(
    () => new Map(bugTypesData.map((lt: { id: string; value: string }) => [lt.id, lt.value])),
    [bugTypesData],
  );

  const [categoryTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_CATEGORY_TYPE }),
    { enabled: shouldLoadBugLookups },
  );
  const categoryTypesData = categoryTypesDataRaw ?? [];
  const categoryTypeOptions = useMemo(
    () =>
      categoryTypesData.map((lt: { id: string; value: string }) => ({
        label: lt.value,
        value: lt.id,
      })),
    [categoryTypesData],
  );
  const categoryValueById = useMemo(
    () => new Map(categoryTypesData.map((lt: { id: string; value: string }) => [lt.id, lt.value])),
    [categoryTypesData],
  );

  const effectiveBugTypeId = pendingRCA?.bugTypeId ?? selectedRecord?.bugTypeId ?? '';
  const effectiveCategoryTypeId =
    pendingRCA?.categoryTypeId ?? selectedRecord?.categoryTypeId ?? '';

  const bugTypeValue = bugTypeValueById.get(effectiveBugTypeId) ?? '';
  const categoryValue = categoryValueById.get(effectiveCategoryTypeId) ?? '';
  const isBugTypeSelected = !!bugTypeValue;
  const isCategorySelected = !!categoryValue;
  const isReliabilityBug = bugTypeValue === 'Reliability';
  const shouldLoadIssueLookups = shouldLoadBugLookups && isBugTypeSelected && isCategorySelected;
  const shouldLoadCoeLookups =
    isClosedRca ||
    coeLookupsLoaded ||
    (activePhase === 'coe' && isBugTypeSelected && (!isReliabilityBug || isCategorySelected));

  const coeLookupType = useMemo(() => {
    if (bugTypeValue === 'Reliability') {
      if (categoryValue === 'Change') return LookupType.COE_ACTION_TYPE_RELIABILITY_CHANGE;
      if (categoryValue === 'Capacity') return LookupType.COE_ACTION_TYPE_RELIABILITY_CAPACITY;
      if (categoryValue === 'Fault') return LookupType.COE_ACTION_TYPE_RELIABILITY_FAULT;
    }
    if (bugTypeValue === 'Performance') return LookupType.COE_ACTION_TYPE_PERF;
    if (bugTypeValue === 'UI/UX') return LookupType.COE_ACTION_TYPE_UIUX;
    return LookupType.COE_ACTION_TYPE;
  }, [bugTypeValue, categoryValue]);

  const [coeActionTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: coeLookupType }),
    { enabled: shouldLoadCoeLookups },
  );
  const coeActionTypesData = coeActionTypesDataRaw ?? [];
  const coeActionTypeOptions = useMemo(
    () =>
      coeActionTypesData.map((ct: { id: string; value: string }) => ({
        label: formatEnumLabel(ct.value),
        value: ct.id,
      })),
    [coeActionTypesData],
  );
  const coeActionTypeValueById = useMemo(
    () => new Map(coeActionTypesData.map((ct: { id: string; value: string }) => [ct.id, ct.value])),
    [coeActionTypesData],
  );

  const [baseCoeActionTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.COE_ACTION_TYPE }),
    { enabled: shouldLoadCoeLookups },
  );
  const baseCoeActionTypesData = baseCoeActionTypesDataRaw ?? [];
  const quickFixActionTypeId = useMemo(() => {
    for (const entry of baseCoeActionTypesData) {
      if (entry.value === 'QUICK_FIXES_DONE') return entry.id;
    }
    return '';
  }, [baseCoeActionTypesData]);

  const excludedCoeActionTypeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, value] of coeActionTypeValueById.entries()) {
      if (value === 'QUICK_FIXES_DONE' || value === 'PREVENTION_PRINCIPLE') {
        ids.add(id);
      }
    }
    return ids;
  }, [coeActionTypeValueById]);

  const [issueCategoryCapacityData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_CAPACITY }),
    { enabled: shouldLoadIssueLookups },
  );
  const [issueCategoryChangeData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_CHANGE }),
    { enabled: shouldLoadIssueLookups },
  );
  const [issueCategoryFaultData] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_ISSUE_CATEGORY_FAULT }),
    { enabled: shouldLoadIssueLookups },
  );

  const issueCategoryOptionsByCategoryValue = useMemo(() => {
    const toOptions = (data?: Array<{ id: string; value: string }>) =>
      (data ?? []).map(item => ({ label: item.value, value: item.id }));
    return {
      Capacity: toOptions(issueCategoryCapacityData),
      Change: toOptions(issueCategoryChangeData),
      Fault: toOptions(issueCategoryFaultData),
    };
  }, [issueCategoryCapacityData, issueCategoryChangeData, issueCategoryFaultData]);

  const issueCategoryOptions = useMemo(
    () => Object.values(issueCategoryOptionsByCategoryValue).flat(),
    [issueCategoryOptionsByCategoryValue],
  );
  const issueCategoryValueById = useMemo(
    () => new Map(issueCategoryOptions.map(option => [option.value, option.label])),
    [issueCategoryOptions],
  );

  return {
    ownerItems,
    releaseAttributionsData,
    releaseTicketsData,
    releaseSubTicketsData,
    impactTypeOptions,
    bugTypeOptions,
    bugTypeValueById,
    categoryTypeOptions,
    categoryValueById,
    coeActionTypeOptions,
    coeActionTypeValueById,
    quickFixActionTypeId,
    excludedCoeActionTypeIds,
    issueCategoryOptionsByCategoryValue,
    issueCategoryValueById,
    bugTypeValue, // Extracted for form
  };
};
