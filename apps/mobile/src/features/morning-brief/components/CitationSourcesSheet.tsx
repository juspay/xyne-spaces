import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { ChevronRight, Link2 } from 'lucide-react-native';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';

import type { BriefCitation } from '../api/dailyBriefApi';
import { decodeSvgDataUri, getClawCitationLabel, resolveCitationIconUrl } from '../utils/citations';

function CitationIcon({
  citation,
  mutedColor,
}: {
  citation: BriefCitation;
  mutedColor: string;
}): ReactElement {
  const svg = decodeSvgDataUri(resolveCitationIconUrl(citation));
  if (svg) {
    return <SvgXml xml={svg} width={16} height={16} />;
  }
  return <Link2 size={16} color={mutedColor} strokeWidth={1.8} />;
}

type CitationSourcesSheetProps = {
  citations: BriefCitation[] | null;
  onClose: () => void;
  onOpenCitation: (citation: BriefCitation) => void;
  foregroundColor: string;
  mutedColor: string;
};

/** A grouped citation chip's source list — tap a row to open that source. */
export function CitationSourcesSheet({
  citations,
  onClose,
  onOpenCitation,
  foregroundColor,
  mutedColor,
}: CitationSourcesSheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <AppBottomSheet
      isOpen={citations !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      mode='dynamic'
    >
      {/* mode='dynamic' needs BottomSheetView for its content measurement. */}
      <BottomSheetView style={{ paddingBottom: insets.bottom }}>
        <View className='px-3 pb-8 pt-1'>
          <Text className='px-2.5 pb-2 text-[13px] font-medium' style={{ color: mutedColor }}>
            Sources
          </Text>
          {(citations ?? []).map((citation, index) => (
            <Pressable
              key={index}
              onPress={() => {
                void haptics.buttonTap();
                onClose();
                onOpenCitation(citation);
              }}
              accessibilityRole='button'
              accessibilityLabel={getClawCitationLabel(citation)}
              className='w-full flex-row items-center gap-2.5 rounded-lg px-2.5 py-2.5'
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <CitationIcon citation={citation} mutedColor={mutedColor} />
              <Text
                className='flex-1 text-[14px]'
                style={{ color: foregroundColor }}
                numberOfLines={1}
              >
                {getClawCitationLabel(citation)}
              </Text>
              <ChevronRight size={14} color={mutedColor} strokeWidth={1.8} />
            </Pressable>
          ))}
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
