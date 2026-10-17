import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { BriefRenderContext } from '../hooks/useBriefRenderContext';
import { parseBucket, weekdayShort, type SectionSpec } from '../utils/selectors';
import { BriefLine, type BriefLineHandlers } from './BriefLine';

/** The web brief's schedule rail + generating dot — deliberately unthemed. */
export const BRIEF_ORANGE = '#FF6900';

type BriefSectionProps = {
  spec: SectionSpec;
  lines: string[];
  context: BriefRenderContext;
  handlers: BriefLineHandlers;
};

/**
 * A stacked brief section: 15px/600 label above the rows. The web puts the
 * label in a 145px side column, which does not fit a phone — everything else
 * (dot bullets, gaps, type scale) matches the web spec.
 */
export function BriefSection({ spec, lines, context, handlers }: BriefSectionProps): ReactElement {
  return (
    <View>
      <Text
        className='text-[15px] font-semibold text-foreground'
        style={{ letterSpacing: -0.1, lineHeight: 22 }}
      >
        {spec.label}
      </Text>
      <View className='mt-2.5' style={{ gap: spec.itemGap }}>
        {lines.map((line, index) => (
          <View key={index} className='w-full flex-row items-start gap-3'>
            {spec.checkable && (
              <View className='h-[22px] w-[22px] shrink-0 items-center justify-center'>
                <View
                  className='h-1.5 w-1.5 rounded-full'
                  style={{ backgroundColor: context.palette.foregroundMuted }}
                />
              </View>
            )}
            <View className='min-w-0 flex-1'>
              <BriefLine line={line} context={context} handlers={handlers} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

type ScheduleSectionProps = {
  spec: SectionSpec;
  lines: string[];
  context: BriefRenderContext;
  handlers: BriefLineHandlers;
  date: string | undefined;
};

/**
 * "Today's schedule": weekday-over-day-number gutter beside event rows, each
 * row carrying the 3px orange left rail — same structure as the web.
 */
export function ScheduleSection({
  spec,
  lines,
  context,
  handlers,
  date,
}: ScheduleSectionProps): ReactElement {
  const parsed = parseBucket(date);

  return (
    <View>
      <Text
        className='text-[15px] font-semibold text-foreground'
        style={{ letterSpacing: -0.1, lineHeight: 22 }}
      >
        {spec.label}
      </Text>
      <View className='mt-2.5 flex-row items-start gap-3'>
        {parsed && (
          <View className='shrink-0 items-center' style={{ gap: 1 }}>
            <Text
              className='text-[13px]'
              style={{
                lineHeight: 16,
                letterSpacing: -0.1,
                color: context.palette.foregroundMuted,
              }}
            >
              {weekdayShort(parsed)}
            </Text>
            <Text
              className='w-[33px] text-center text-[24px] font-semibold text-foreground'
              style={{ lineHeight: 32 }}
            >
              {parsed.getDate()}
            </Text>
          </View>
        )}
        <View className='min-w-0 flex-1' style={{ gap: spec.itemGap }}>
          {lines.map((line, index) => (
            <View
              key={index}
              className='w-full py-2 pl-4'
              style={{ borderLeftWidth: 3, borderLeftColor: BRIEF_ORANGE }}
            >
              <BriefLine line={line} context={context} handlers={handlers} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
