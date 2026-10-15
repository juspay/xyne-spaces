import { Fragment, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { ListRowDivider, SectionCard } from '@/src/components/ui/settings-list';
import { haptics } from '@/src/utils/haptics';

import { GuideIcon } from '../guide-icons';
import type { GuideIconKey, MobileGuide } from '../types';

/**
 * Row metrics. Roomier than the settings rows on purpose: guide titles are
 * sentences and taglines wrap to a second line, so the row needs air around
 * them to stay scannable.
 */
const ROW_HORIZONTAL_PADDING = 16;
const ROW_VERTICAL_PADDING = 11;
const ICON_TILE_SIZE = 36;
const ICON_SIZE = 18;
const ICON_TEXT_GAP = 12;
/** Divider starts under the title, not under the icon tile. */
const DIVIDER_INSET = ROW_HORIZONTAL_PADDING + ICON_TILE_SIZE + ICON_TEXT_GAP;

type IconTileProps = { icon: GuideIconKey; color: string };

/**
 * A catalog icon inside a rounded tile. The tile takes the settings
 * search-field tint, which is one shade off the card in both themes (a light
 * grey on white, a lifted grey on the dark card) rather than the screen
 * background, which is near-black in dark mode.
 */
export const GuideIconTile = ({ icon, color }: IconTileProps): ReactElement => {
  const tileBg = useCSSVariable('--color-settings-search-bg') as string;
  return (
    <View
      className='items-center justify-center rounded-xl'
      style={{ width: ICON_TILE_SIZE, height: ICON_TILE_SIZE, backgroundColor: tileBg }}
    >
      <GuideIcon name={icon} size={ICON_SIZE} color={color} />
    </View>
  );
};

type GuideRowProps = {
  guide: MobileGuide;
  showTagline: boolean;
  onPress: () => void;
};

const GuideRow = ({ guide, showTagline, onPress }: GuideRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const chevronColor = useCSSVariable('--color-settings-chevron') as string;
  const rippleColor = useCSSVariable('--color-settings-row-divider') as string;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      accessibilityRole='button'
      accessibilityLabel={guide.title}
      android_ripple={{ color: rippleColor }}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      <View
        className='flex-row items-center'
        style={{
          paddingHorizontal: ROW_HORIZONTAL_PADDING,
          paddingVertical: ROW_VERTICAL_PADDING,
          gap: ICON_TEXT_GAP,
        }}
      >
        <GuideIconTile icon={guide.icon} color={labelColor} />
        <View className='min-w-0 flex-1'>
          <Text
            className='text-[16px] leading-[21px]'
            style={{ color: labelColor }}
            numberOfLines={2}
          >
            {guide.title}
          </Text>
          {showTagline ? (
            <Text
              className='mt-0.5 text-[13px] leading-[18px]'
              style={{ color: descriptionColor }}
              numberOfLines={2}
            >
              {guide.tagline}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={19} color={chevronColor} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
};

type GuideRowsProps = {
  guides: readonly MobileGuide[];
  onOpen: (guide: MobileGuide) => void;
  /** Show the tagline under the title. The hub turns this off to stay quiet. */
  showTagline?: boolean;
};

/** A card of guide rows: icon tile, title, optional tagline, chevron. */
export const GuideRows = ({ guides, onOpen, showTagline = true }: GuideRowsProps): ReactElement => (
  <SectionCard>
    {guides.map((guide, index) => (
      <Fragment key={guide.id}>
        <GuideRow guide={guide} showTagline={showTagline} onPress={() => onOpen(guide)} />
        {index < guides.length - 1 ? <ListRowDivider inset={DIVIDER_INSET} /> : null}
      </Fragment>
    ))}
  </SectionCard>
);
