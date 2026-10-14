import { Fragment, memo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { CirclePlay, Lightbulb, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

import { GUIDE_CATEGORY_BY_ID } from '../categories';
import type { GuideFeedback } from '../guide-feedback-core';
import { GuideIcon } from '../guide-icons';
import type { GuideStep, MobileGuide } from '../types';
import { GuidePill, PLATFORM_LABELS } from './guide-chips';
import { GuideStepText } from './guide-step-text';

const CONTENT_HORIZONTAL_PADDING = 16;
const STEP_NUMBER_SIZE = 24;

export type GuidePosition = { index: number; total: number };

export type UserGuideDetailViewProps = {
  /** Null when the route's guide id is unknown or hidden by permissions. */
  guide: MobileGuide | null;
  position: GuidePosition | null;
  related: readonly MobileGuide[];
  feedback: GuideFeedback | null;
  onTryIt: () => void;
  onWatchVideo: () => void;
  onOpenGuide: (guide: MobileGuide) => void;
  onFeedback: (answer: GuideFeedback) => void;
  onReportIssue: () => void;
  /** Shown on the not-found state; takes the reader back to the hub. */
  onBrowseAll: () => void;
};

function toGuideStep(step: string | GuideStep): GuideStep {
  return typeof step === 'string' ? { text: step } : step;
}

type CalloutProps = {
  icon: ReactElement;
  label: string;
  text: string;
  background: string;
  foreground: string;
};

const Callout = ({ icon, label, text, background, foreground }: CalloutProps): ReactElement => (
  <View
    className='mt-5 flex-row gap-3 rounded-xl px-3.5 py-3'
    style={{ backgroundColor: background }}
  >
    <View className='mt-0.5'>{icon}</View>
    <Text className='flex-1 text-[14px] leading-5' style={{ color: foreground }}>
      <Text className='font-semibold'>{label} </Text>
      {text}
    </Text>
  </View>
);

type ActionButtonProps = {
  label: string;
  icon?: ReactElement;
  onPress: () => void;
  variant: 'primary' | 'secondary';
  accessibilityLabel?: string;
};

const ActionButton = ({
  label,
  icon,
  onPress,
  variant,
  accessibilityLabel,
}: ActionButtonProps): ReactElement => {
  const { accentBg, accentFg, accentText } = useBubbleAccent();
  const border = useCSSVariable('--color-settings-row-divider') as string;
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel ?? label}
      className='min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-4 active:opacity-80'
      style={isPrimary ? { backgroundColor: accentBg } : { borderWidth: 1, borderColor: border }}
    >
      {icon}
      <Text
        className='text-[15px] font-semibold'
        style={{ color: isPrimary ? accentFg : accentText }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

type NotFoundProps = { onBrowseAll: () => void; labelColor: string; descriptionColor: string };

const GuideNotFound = ({
  onBrowseAll,
  labelColor,
  descriptionColor,
}: NotFoundProps): ReactElement => (
  <View className='flex-1 items-center justify-center px-8 pb-24'>
    <Text className='text-center text-[17px] font-semibold' style={{ color: labelColor }}>
      This guide is not available
    </Text>
    <Text className='mt-1.5 text-center text-[14px]' style={{ color: descriptionColor }}>
      It may have moved, or it covers a feature your workspace has not enabled.
    </Text>
    <View className='mt-5 self-stretch'>
      <ActionButton label='Browse all guides' onPress={onBrowseAll} variant='secondary' />
    </View>
  </View>
);

/**
 * A guide's page, given as props: eyebrow, title, tagline, actions, steps,
 * callouts, related guides, feedback row and the report-issue link. Every
 * side effect (navigation, storage, metrics) is the container's job.
 */
export const UserGuideDetailView = memo(function UserGuideDetailView({
  guide,
  position,
  related,
  feedback,
  onTryIt,
  onWatchVideo,
  onOpenGuide,
  onFeedback,
  onReportIssue,
  onBrowseAll,
}: UserGuideDetailViewProps): ReactElement {
  const { accentSoft, accentText } = useBubbleAccent();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const sectionLabelColor = useCSSVariable('--color-settings-section-label') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const dividerColor = useCSSVariable('--color-settings-row-divider') as string;
  const tipBg = useCSSVariable('--color-yellow-100') as string;
  const tipFg = useCSSVariable('--color-yellow-700') as string;
  const cautionBg = useCSSVariable('--color-red-100') as string;
  const cautionFg = useCSSVariable('--color-red-700') as string;

  if (!guide) {
    return (
      <GuideNotFound
        onBrowseAll={onBrowseAll}
        labelColor={labelColor}
        descriptionColor={descriptionColor}
      />
    );
  }

  const steps = guide.steps.map(toGuideStep);
  const eyebrow =
    GUIDE_CATEGORY_BY_ID[guide.category].title +
    (position && position.total > 1 ? `  ·  ${position.index} of ${position.total}` : '');

  return (
    <ScrollView
      className='flex-1'
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: CONTENT_HORIZONTAL_PADDING, paddingBottom: 48 }}
    >
      <View className='mt-1 flex-row items-center gap-2'>
        <GuideIcon name={guide.icon} size={16} color={accentText} />
        <Text
          className='text-[12px] font-bold uppercase tracking-wider'
          style={{ color: sectionLabelColor }}
        >
          {eyebrow}
        </Text>
      </View>
      <Text
        className='mt-2 text-[26px] font-bold leading-8'
        style={{ color: labelColor }}
        accessibilityRole='header'
      >
        {guide.title}
      </Text>
      <Text className='mt-2 text-[15px] leading-[22px]' style={{ color: descriptionColor }}>
        {guide.tagline}
      </Text>

      {guide.tryIt || guide.videoUrl ? (
        <View className='mt-6' style={{ gap: 8 }}>
          {guide.tryIt ? (
            <ActionButton
              label={`Try it · ${guide.tryIt.label}`}
              onPress={onTryIt}
              variant='primary'
              accessibilityLabel={`Try it: ${guide.tryIt.label}`}
            />
          ) : null}
          {guide.videoUrl ? (
            <ActionButton
              label='Watch video'
              icon={<CirclePlay size={18} color={accentText} />}
              onPress={onWatchVideo}
              variant='secondary'
            />
          ) : null}
        </View>
      ) : null}

      <View className='mt-7' style={{ gap: 14 }} accessibilityRole='list'>
        {steps.map((step, index) => (
          <View
            key={`${guide.id}-${index}`}
            className='flex-row items-start gap-3'
            accessibilityLabel={`Step ${index + 1} of ${steps.length}`}
          >
            {/* Muted on purpose: the number is a place marker, the step text is the content. */}
            <View
              className='items-center justify-center rounded-full'
              style={{
                width: STEP_NUMBER_SIZE,
                height: STEP_NUMBER_SIZE,
                backgroundColor: sectionBg,
                borderWidth: 1,
                borderColor: dividerColor,
                marginTop: 1,
              }}
            >
              <Text className='text-[12px] font-semibold' style={{ color: descriptionColor }}>
                {index + 1}
              </Text>
            </View>
            <View className='flex-1'>
              {step.platform ? (
                <View className='mb-1.5 self-start'>
                  <GuidePill label={`${PLATFORM_LABELS[step.platform]} only`} />
                </View>
              ) : null}
              <GuideStepText text={step.text} color={labelColor} />
            </View>
          </View>
        ))}
      </View>

      {guide.tip ? (
        <Callout
          icon={<Lightbulb size={16} color={tipFg} />}
          label='Tip:'
          text={guide.tip}
          background={tipBg}
          foreground={tipFg}
        />
      ) : null}
      {guide.caution ? (
        <Callout
          icon={<TriangleAlert size={16} color={cautionFg} />}
          label='Careful:'
          text={guide.caution}
          background={cautionBg}
          foreground={cautionFg}
        />
      ) : null}

      {related.length > 0 ? (
        <View className='mt-8'>
          <SectionLabel>Related</SectionLabel>
          <SectionCard>
            {related.map((target, index) => (
              <Fragment key={target.id}>
                <ListRow
                  label={target.title}
                  description={target.tagline}
                  showChevron
                  onPress={() => onOpenGuide(target)}
                />
                {index < related.length - 1 ? <ListRowDivider inset={16} /> : null}
              </Fragment>
            ))}
          </SectionCard>
        </View>
      ) : null}

      <View
        className='mt-8 flex-row items-center justify-between rounded-2xl px-4 py-3'
        style={{ borderWidth: 1, borderColor: dividerColor }}
      >
        <Text className='text-[14px] font-medium' style={{ color: labelColor }}>
          {feedback ? 'Thanks for the feedback' : 'Was this helpful?'}
        </Text>
        <View className='flex-row' style={{ gap: 8 }}>
          {(['yes', 'no'] as const).map(answer => {
            const selected = feedback === answer;
            const Icon = answer === 'yes' ? ThumbsUp : ThumbsDown;
            return (
              <Pressable
                key={answer}
                onPress={() => onFeedback(answer)}
                accessibilityRole='button'
                accessibilityLabel={answer === 'yes' ? 'Yes, helpful' : 'No, not helpful'}
                accessibilityState={{ selected }}
                hitSlop={6}
                className='h-9 w-11 items-center justify-center rounded-lg active:opacity-70'
                style={
                  selected
                    ? { backgroundColor: accentSoft }
                    : { borderWidth: 1, borderColor: dividerColor }
                }
              >
                <Icon size={16} color={selected ? accentText : descriptionColor} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={onReportIssue}
        accessibilityRole='button'
        accessibilityLabel='Still stuck? Report an issue'
        className='mt-4 self-center rounded-md px-2 py-1 active:opacity-60'
      >
        <Text className='text-[14px]' style={{ color: descriptionColor }}>
          Still stuck?{' '}
          <Text className='font-semibold' style={{ color: accentText }}>
            Report an issue
          </Text>
        </Text>
      </Pressable>
    </ScrollView>
  );
});
