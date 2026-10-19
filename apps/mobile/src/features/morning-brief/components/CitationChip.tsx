import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Link2 } from 'lucide-react-native';

import { haptics } from '@/src/utils/haptics';

import type { BriefCitation } from '../api/dailyBriefApi';
import type { BriefPalette } from '../utils/briefMarkdownStyle';
import {
  decodeSvgDataUri,
  getClawCitationLabel,
  resolveCitationIconUrl,
  type ClawCiteRef,
} from '../utils/citations';

const CHIP_HEIGHT = 22;
const ICON_SIZE = 14;
const MAX_CLUSTER_ICONS = 3;

function CitationIcon({
  citation,
  mutedColor,
  ringColor,
}: {
  citation: BriefCitation | null;
  mutedColor: string;
  ringColor: string;
}): ReactElement {
  const svg = decodeSvgDataUri(resolveCitationIconUrl(citation ?? undefined));
  return (
    <View
      className='items-center justify-center overflow-hidden rounded-full'
      style={{ width: ICON_SIZE, height: ICON_SIZE, backgroundColor: ringColor }}
    >
      {svg ? (
        <SvgXml xml={svg} width={ICON_SIZE} height={ICON_SIZE} />
      ) : (
        <Link2 size={10} color={mutedColor} strokeWidth={2} />
      )}
    </View>
  );
}

type BriefCitationChipsProps = {
  /** One entry per run of adjacent tokens: singleton → labeled chip,
   *  longer → "+N" cluster (mirrors the web's ThreadCitationChip /
   *  ClawCitationGroup). */
  runs: ClawCiteRef[][];
  resolveCitation: (ref: ClawCiteRef) => BriefCitation | null;
  onPressCitation: (citation: BriefCitation) => void;
  onPressGroup: (citations: BriefCitation[]) => void;
  palette: BriefPalette;
};

/**
 * The trailing citation chips for one brief line — the native counterpart of
 * the web's inline chips: a 22px pill with the source's brand icon and label
 * ("Ticket XYNE-54503"), or overlapping icons + "+N" for a grouped run.
 */
export function BriefCitationChips({
  runs,
  resolveCitation,
  onPressCitation,
  onPressGroup,
  palette,
}: BriefCitationChipsProps): ReactElement | null {
  const resolved = runs
    .map(run => run.map(resolveCitation).filter((c): c is BriefCitation => c !== null))
    .filter(run => run.length > 0);
  if (resolved.length === 0) return null;

  const chipStyle = {
    height: CHIP_HEIGHT,
    borderRadius: CHIP_HEIGHT / 2,
    backgroundColor: palette.chipBg,
    borderWidth: 1,
    borderColor: `${palette.foregroundMuted}22`,
  } as const;

  return (
    <View className='mt-1.5 flex-row flex-wrap items-center' style={{ gap: 6 }}>
      {resolved.map((run, runIndex) => {
        if (run.length === 1) {
          const citation = run[0];
          if (!citation) return null;
          return (
            <Pressable
              key={runIndex}
              onPress={() => {
                void haptics.buttonTap();
                onPressCitation(citation);
              }}
              accessibilityRole='button'
              accessibilityLabel={getClawCitationLabel(citation)}
              className='flex-row items-center gap-1 pl-1 pr-2'
              style={({ pressed }) => [chipStyle, { opacity: pressed ? 0.6 : 1 }]}
            >
              <CitationIcon
                citation={citation}
                mutedColor={palette.foregroundMuted}
                ringColor={palette.cardBg}
              />
              <Text
                className='text-[11px] font-medium'
                style={{ color: palette.foregroundMuted, maxWidth: 180 }}
                numberOfLines={1}
              >
                {getClawCitationLabel(citation)}
              </Text>
            </Pressable>
          );
        }
        const visible = run.slice(0, MAX_CLUSTER_ICONS);
        return (
          <Pressable
            key={runIndex}
            onPress={() => {
              void haptics.buttonTap();
              onPressGroup(run);
            }}
            accessibilityRole='button'
            accessibilityLabel={`${run.length} sources`}
            className='flex-row items-center pl-1 pr-2'
            style={({ pressed }) => [chipStyle, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View className='flex-row items-center'>
              {visible.map((citation, iconIndex) => (
                <View
                  key={iconIndex}
                  style={{
                    marginLeft: iconIndex === 0 ? 0 : -6,
                    zIndex: MAX_CLUSTER_ICONS - iconIndex,
                  }}
                >
                  <CitationIcon
                    citation={citation}
                    mutedColor={palette.foregroundMuted}
                    ringColor={palette.cardBg}
                  />
                </View>
              ))}
            </View>
            <Text
              className='ml-1 text-[11px] font-medium'
              style={{ color: palette.foregroundMuted }}
            >
              +{run.length}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
