import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { BriefRenderContext } from '../hooks/useBriefRenderContext';
import type { BriefSectionLines, SelectedBrief } from '../utils/selectors';
import { BriefEmptyState } from './BriefEmptyState';
import { BriefLine, type BriefLineHandlers } from './BriefLine';
import { BriefNotice } from './BriefNotices';
import { BriefSection, ScheduleSection } from './BriefSection';
import { BriefSkeleton } from './BriefSkeleton';

const BODY_TEXT_STYLE = { lineHeight: 22, letterSpacing: -0.1 } as const;

export type BriefBodyProps = {
  isBusy: boolean;
  selected: SelectedBrief | null;
  sections: BriefSectionLines[];
  briefEnabled: boolean | undefined;
  enabling: boolean;
  onEnable: () => void;
  context: BriefRenderContext;
  handlers: BriefLineHandlers;
};

/**
 * The brief's body state machine as a pure, props-driven component — the same
 * cascade as the web's `renderBody`: skeleton → empty (+ enable CTA) →
 * failed-without-content → structured sections (with a stale notice when the
 * last refresh failed) → markdown fallback → no-content.
 */
export function BriefBody({
  isBusy,
  selected,
  sections,
  briefEnabled,
  enabling,
  onEnable,
  context,
  handlers,
}: BriefBodyProps): ReactElement {
  if (isBusy) return <BriefSkeleton />;
  if (!selected) {
    return <BriefEmptyState briefEnabled={briefEnabled} enabling={enabling} onEnable={onEnable} />;
  }
  const hasContent = sections.length > 0 || Boolean(selected.content);
  if (selected.status === 'failed' && !hasContent) {
    return (
      <Text className='text-[15px] text-foreground' style={BODY_TEXT_STYLE}>
        This brief failed to generate.
      </Text>
    );
  }
  const staleNotice = selected.status === 'failed' && (
    <BriefNotice color={context.palette.foregroundMuted}>
      The last refresh failed — showing the previous brief.
    </BriefNotice>
  );
  if (sections.length > 0) {
    return (
      <View className='w-full gap-9'>
        {staleNotice}
        {sections.map(({ spec, lines }) =>
          spec.field === 'todays_schedule' ? (
            <ScheduleSection
              key={spec.field}
              spec={spec}
              lines={lines}
              context={context}
              handlers={handlers}
              date={selected.date}
            />
          ) : (
            <BriefSection
              key={spec.field}
              spec={spec}
              lines={lines}
              context={context}
              handlers={handlers}
            />
          ),
        )}
      </View>
    );
  }
  if (selected.content) {
    return (
      <View>
        {staleNotice}
        <BriefLine line={selected.content} context={context} handlers={handlers} />
      </View>
    );
  }
  return (
    <Text className='text-[15px] text-foreground' style={BODY_TEXT_STYLE}>
      This brief has no content.
    </Text>
  );
}
