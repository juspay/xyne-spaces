import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  useColorScheme,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  type TextLayoutLine,
} from 'react-native';
import { Star } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { TICKET_STAR_FILLED } from '../constants';

const STAR_SLOT = 36;
const CHIP_GAP = 6;

type TicketDetailSubjectRowProps = {
  title: string;
  xyneId: string;
  starred: boolean;
  onToggleStar: () => void;
  /** EMAIL desks only — matches dashboard MailboxActions star. */
  showStar?: boolean;
};

type ChipPos = {
  left: number;
  top: number;
};

function computeChipPos(
  lines: readonly TextLayoutLine[],
  textBlockWidth: number,
  chipW: number,
  chipH: number,
): ChipPos | null {
  if (!lines.length || !textBlockWidth || chipW <= 0) return null;
  const last = lines[lines.length - 1]!;
  const inlineLeft = last.x + last.width + CHIP_GAP;
  const fitsInline = inlineLeft + chipW <= textBlockWidth + 0.5;
  if (fitsInline) {
    return {
      left: inlineLeft,
      top: last.y + Math.max(0, (last.height - chipH) / 2),
    };
  }
  return {
    left: 0,
    top: last.y + last.height + 4,
  };
}

/**
 * Gmail-style subject: full title wraps; xyneId is a real View chip (RN nested
 * Text ignores borderRadius/padding) positioned at the end of the last line
 * via onTextLayout.
 */
export const TicketDetailSubjectRow = memo(function TicketDetailSubjectRow({
  title,
  xyneId,
  starred,
  onToggleStar,
  showStar = false,
}: TicketDetailSubjectRowProps) {
  const foreground = useCSSVariable('--color-foreground') as string;
  const scheme = useColorScheme();
  const chipBg = scheme === 'dark' ? 'rgba(91, 33, 182, 0.45)' : 'rgba(237, 233, 254, 1)';
  const chipFg = scheme === 'dark' ? '#DDD6FE' : '#5B21B6';

  const [textBlockWidth, setTextBlockWidth] = useState(0);
  const [chipSize, setChipSize] = useState({ w: 0, h: 0 });
  const [chipPos, setChipPos] = useState<ChipPos | null>(null);
  const [textHeight, setTextHeight] = useState(0);
  const linesRef = useRef<TextLayoutLine[]>([]);

  const recompute = useCallback(() => {
    const pos = computeChipPos(linesRef.current, textBlockWidth, chipSize.w, chipSize.h);
    setChipPos(xyneId ? pos : null);
    if (linesRef.current.length) {
      const h = linesRef.current.reduce((sum, line) => Math.max(sum, line.y + line.height), 0);
      setTextHeight(h);
    }
  }, [textBlockWidth, chipSize.w, chipSize.h, xyneId]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  const onTextBlockLayout = useCallback((e: LayoutChangeEvent) => {
    setTextBlockWidth(e.nativeEvent.layout.width);
  }, []);

  const onChipLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setChipSize({ w: width, h: height });
    }
  }, []);

  const onTitleTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      linesRef.current = [...e.nativeEvent.lines];
      recompute();
    },
    [recompute],
  );

  // x != null              // skips both null and undefined
  // x !== undefined        // skips only undefined; null still passes
  const chipBelowTitle = chipPos != null && textHeight > 0 && chipPos.top >= textHeight - 1;
  const blockHeight =
    Math.max(textHeight, chipPos ? chipPos.top + chipSize.h : textHeight) || undefined;

  return (
    <View className='flex-row items-start px-4 pb-2 pt-1'>
      <View
        className='min-w-0 flex-1'
        style={{ paddingRight: 4, minHeight: blockHeight }}
        onLayout={onTextBlockLayout}
      >
        <Text
          className='text-[20px] font-semibold leading-7 text-foreground'
          onTextLayout={onTitleTextLayout}
        >
          {title}
        </Text>

        {xyneId ? (
          <View
            pointerEvents='none'
            onLayout={onChipLayout}
            style={
              chipPos
                ? {
                    position: 'absolute',
                    left: chipPos.left,
                    top: chipPos.top,
                    borderRadius: 6,
                    backgroundColor: chipBg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }
                : {
                    position: 'absolute',
                    opacity: 0,
                    borderRadius: 6,
                    backgroundColor: chipBg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }
            }
          >
            <Text
              style={{
                fontSize: 12,
                lineHeight: 16,
                fontWeight: '500',
                color: chipFg,
              }}
            >
              {xyneId}
            </Text>
          </View>
        ) : null}

        {chipBelowTitle ? <View style={{ height: chipSize.h + 4 }} /> : null}
      </View>

      {showStar ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={starred ? 'Unstar ticket' : 'Star ticket'}
          hitSlop={8}
          onPress={onToggleStar}
          style={{ width: STAR_SLOT, height: STAR_SLOT }}
          className='mt-0.5 shrink-0 items-center justify-center'
        >
          <Star
            size={20}
            color={starred ? TICKET_STAR_FILLED : foreground}
            fill={starred ? TICKET_STAR_FILLED : 'transparent'}
          />
        </Pressable>
      ) : null}
    </View>
  );
});
