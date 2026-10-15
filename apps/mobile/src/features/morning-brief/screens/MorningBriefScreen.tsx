import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { showMessageToast } from '@/src/utils/toast';

import { dailyBriefApi, type BriefCitation, type BriefSwitchSource } from '../api/dailyBriefApi';
import {
  useBriefConfig,
  useBriefDates,
  useBriefHistory,
  useBriefByDate,
  useLatestBrief,
} from '../hooks/useBriefQueries';
import { useBriefConfigMutation } from '../hooks/useBriefConfigMutation';
import { useBriefForegroundRefresh } from '../hooks/useBriefForegroundRefresh';
import { useBriefIntroSeen } from '../hooks/useBriefIntroSeen';
import {
  useBriefLinkHandler,
  useBriefRenderContext,
  useOpenCitation,
} from '../hooks/useBriefRenderContext';
import { useRegenerateBrief } from '../hooks/useRegenerateBrief';
import {
  briefActionLabel,
  computeSections,
  selectBrief,
  type SelectedBrief,
} from '../utils/selectors';
import { BriefBody } from '../components/BriefBody';
import { BriefHeader } from '../components/BriefHeader';
import { BriefHistorySheet } from '../components/BriefHistorySheet';
import { BriefIntroBanner } from '../components/BriefIntroBanner';
import {
  BriefErrorBanner,
  BriefNotice,
  GeneratingElsewhereNotice,
} from '../components/BriefNotices';
import { BriefSettingsSheet } from '../components/BriefSettingsSheet';
import { BriefTitle } from '../components/BriefTitle';
import { CitationSourcesSheet } from '../components/CitationSourcesSheet';

/**
 * Morning Brief — the mobile counterpart of the dashboard's DailyBriefScreen.
 * Functionality mirrors the web: structured sections with citations/mentions,
 * history + calendar, settings (enable / instructions), regenerate, and the
 * 10s poll + foreground refresh while a generation runs.
 */
export default function MorningBriefScreen(): ReactElement {
  // null = the today/latest view. Unlike the web, the selection is screen
  // state, not a route param — history taps don't churn the nav stack.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [citationGroup, setCitationGroup] = useState<BriefCitation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const backgroundColor = useCSSVariable('--color-card') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  const { regenerating, error: regenerateError, regenerate } = useRegenerateBrief();
  const { introSeen, markIntroSeen } = useBriefIntroSeen();

  const latestQuery = useLatestBrief(regenerating);
  const historyQuery = useBriefHistory();
  const datesQuery = useBriefDates();
  const configQuery = useBriefConfig();
  const configMutation = useBriefConfigMutation();
  useBriefForegroundRefresh();

  const latest = latestQuery.data ?? null;
  const history = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);
  const availableDates = useMemo(
    () => (datesQuery.data ?? []).map(item => item.date),
    [datesQuery.data],
  );

  const inHistory = selectedDate !== null && history.some(item => item.date === selectedDate);
  const byDateQuery = useBriefByDate(selectedDate !== null && !inHistory ? selectedDate : null);

  // A picked date outside the loaded window resolves through /by-date; a day
  // with no brief bounces back to today (mirrors the web's URL normalization).
  useEffect(() => {
    if (selectedDate === null || inHistory) return;
    if (byDateQuery.data?.status === 'none') {
      setSelectedDate(null);
    }
    if (byDateQuery.isError) {
      setLoadError('Failed to load that brief.');
      setSelectedDate(null);
    }
  }, [byDateQuery.data, byDateQuery.isError, inHistory, selectedDate]);

  const fetched = useMemo((): SelectedBrief | null => {
    const res = byDateQuery.data;
    if (!res || res.status === 'none' || selectedDate === null) return null;
    return {
      date: res.date ?? selectedDate,
      status: res.status,
      content: res.content ?? '',
      data: res.data ?? null,
    };
  }, [byDateQuery.data, selectedDate]);

  const selected = useMemo(
    () => selectBrief(selectedDate, history, latest, fetched),
    [selectedDate, history, latest, fetched],
  );

  const todayBucket = latest?.isToday ? (latest.date ?? null) : null;
  const viewingToday = selectedDate === null || selectedDate === todayBucket;
  const briefGenerating = selected?.status === 'generating';
  const latestGenerating = latest?.status === 'generating';
  const generationInFlight = regenerating || latestGenerating || briefGenerating;
  const hasBrief = selected !== null;
  const briefEnabled = configQuery.data?.enabled;

  const loadingWithoutBrief = latestQuery.isLoading && !selected;
  const fetching = selectedDate !== null && !inHistory && byDateQuery.isLoading;
  const isBusy =
    loadingWithoutBrief || fetching || (viewingToday && regenerating) || briefGenerating;

  const renderContext = useBriefRenderContext(selected?.data ?? null);
  const openCitation = useOpenCitation();
  const onLinkPress = useBriefLinkHandler();
  const lineHandlers = useMemo(
    () => ({
      onLinkPress,
      onPressCitation: openCitation,
      onPressGroup: setCitationGroup,
    }),
    [onLinkPress, openCitation],
  );

  const sections = useMemo(() => computeSections(selected?.data), [selected?.data]);

  const handleRegenerate = useCallback(async () => {
    if (generationInFlight) return;
    const result = await regenerate();
    if (result === 'ready') {
      setSelectedDate(null);
      showMessageToast('Your daily brief is ready', 'success');
    } else if (result === 'failed') {
      showMessageToast('Regeneration failed.', 'error');
    }
    // 'pending': the run is still going server-side; the poll finishes the UX.
  }, [generationInFlight, regenerate]);

  const handleSelectDate = useCallback(
    (date: string, source: BriefSwitchSource) => {
      const current = selected?.date ?? null;
      if (date !== current) {
        void dailyBriefApi.trackSwitch(source);
      }
      setLoadError(null);
      setSelectedDate(date === todayBucket ? null : date);
    },
    [selected?.date, todayBucket],
  );

  const handleEnableBrief = useCallback(() => {
    configMutation.mutate({ enabled: true });
  }, [configMutation]);

  const actionLabel = briefActionLabel({
    loadingWithoutBrief,
    fetching,
    regenerating,
    briefGenerating,
    hasBrief,
  });

  const error =
    loadError ?? regenerateError ?? (latestQuery.isError ? 'Failed to load daily brief.' : null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor }} edges={['top']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor } }} />
      <BriefHeader
        actionLabel={actionLabel}
        actionDisabled={isBusy || generationInFlight}
        onRegenerate={() => void handleRegenerate()}
        onSelectMenuOption={option => {
          if (option === 'settings') setSettingsOpen(true);
          else setHistoryOpen(true);
        }}
        mutedColor={renderContext.palette.foregroundMuted}
        borderColor={borderColor}
      />
      {error !== null && <BriefErrorBanner message={error} />}
      <ScrollView
        className='flex-1'
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
      >
        {!introSeen && !isBusy && (
          <View className='pt-4'>
            <BriefIntroBanner
              briefEnabled={briefEnabled}
              enabling={configMutation.isPending}
              onEnableBrief={handleEnableBrief}
              onDismiss={markIntroSeen}
              mutedColor={renderContext.palette.foregroundMuted}
              borderColor={borderColor}
            />
          </View>
        )}
        {hasBrief && !isBusy && <BriefTitle date={selected?.date} />}
        {generationInFlight && !viewingToday && (
          <GeneratingElsewhereNotice
            label='Today’s brief is generating…'
            mutedColor={renderContext.palette.foregroundMuted}
            onView={() => setSelectedDate(null)}
          />
        )}
        {!isBusy &&
          selected?.status === 'ready' &&
          latest?.isToday === false &&
          selected.date === latest.date && (
            <BriefNotice color={renderContext.palette.foregroundMuted}>
              Showing the most recent brief — today’s has not been generated yet.
            </BriefNotice>
          )}
        <BriefBody
          isBusy={isBusy}
          selected={selected}
          sections={sections}
          briefEnabled={briefEnabled}
          enabling={configMutation.isPending}
          onEnable={handleEnableBrief}
          context={renderContext}
          handlers={lineHandlers}
        />
      </ScrollView>

      <BriefHistorySheet
        isOpen={historyOpen}
        onOpenChange={setHistoryOpen}
        history={history}
        availableDates={availableDates}
        selectedDate={selected?.date ?? selectedDate}
        onSelect={handleSelectDate}
        foregroundColor={renderContext.palette.foreground}
        mutedColor={renderContext.palette.foregroundMuted}
        borderColor={borderColor}
        accentColor={renderContext.palette.brand}
      />
      <BriefSettingsSheet
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={configQuery.data}
        saving={configMutation.isPending}
        busy={generationInFlight}
        onSave={(patch, regenerateAfter) => {
          configMutation.mutate(patch, {
            onSuccess: () => {
              if (regenerateAfter) void handleRegenerate();
            },
          });
        }}
        foregroundColor={renderContext.palette.foreground}
        mutedColor={renderContext.palette.foregroundMuted}
        borderColor={borderColor}
      />
      <CitationSourcesSheet
        citations={citationGroup}
        onClose={() => setCitationGroup(null)}
        onOpenCitation={openCitation}
        foregroundColor={renderContext.palette.foreground}
        mutedColor={renderContext.palette.foregroundMuted}
      />
    </SafeAreaView>
  );
}
