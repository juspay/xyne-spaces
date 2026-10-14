import { GitCompare } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useCSSVariable } from 'uniwind';

import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createDiffComponentViewModel,
  type DiffLineKind,
  type DiffLineViewModel,
} from '@/src/utils/flowDiffUtils';

import { useRecyclingState } from '../useRecyclingState';
import { FlowCardBody } from './FlowCard';

/** Collapsed body max height. Short patches stay natural height. */
const PREVIEW_MAX_HEIGHT = 220;

const LINE_TEXT_STYLE = {
  fontFamily: 'monospace' as const,
  fontSize: 12,
  lineHeight: 20,
};

const LINE_BG_CLASS: Partial<Record<DiffLineKind, string>> = {
  add: 'bg-diff-line-add-bg',
  remove: 'bg-diff-line-del-bg',
};

const LINE_TEXT_CLASS: Record<DiffLineKind, string> = {
  add: 'text-diff-stat-add-fg',
  remove: 'text-diff-stat-del-fg',
  hunk: 'text-diff-line-hunk-fg',
  meta: 'text-diff-line-hunk-fg',
  context: 'text-foreground',
};

function DiffStat({ added, removed }: { added: number; removed: number }): ReactElement {
  return (
    <Text className='font-mono text-xs' style={styles.tabular}>
      <Text className='text-diff-stat-add-fg'>+{added}</Text>{' '}
      <Text className='text-diff-stat-del-fg'>−{removed}</Text>
    </Text>
  );
}

function DiffPatchLine({ text, kind }: DiffLineViewModel): ReactElement {
  const backgroundClass = LINE_BG_CLASS[kind];
  return (
    <View {...(backgroundClass ? { className: backgroundClass } : {})} style={styles.line}>
      <Text className={LINE_TEXT_CLASS[kind]} style={LINE_TEXT_STYLE}>
        {text.length > 0 ? text : '\u00a0'}
      </Text>
    </View>
  );
}

/**
 * Flow `type: "diff"` card — path + +N/−M header, tinted unified patch.
 * Tall patches clip to PREVIEW_MAX_HEIGHT with an inline Read more.
 */
export const FlowDiffCard = memo(function FlowDiffCard({
  component,
  containerStyle,
  recyclingKey,
}: {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  recyclingKey: string;
}): ReactElement | null {
  const iconColor = useCSSVariable('--color-muted-text') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const readMoreColor = useCSSVariable('--color-brand') as string;
  const [expanded, setExpanded] = useRecyclingState(`${recyclingKey}:diff-expanded`, false);
  const [fullHeight, setFullHeight] = useRecyclingState(`${recyclingKey}:diff-height`, 0);
  const viewModel = createDiffComponentViewModel(component);

  const onBodyLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const height = event.nativeEvent.layout.height;
      setFullHeight(current => (height > current ? height : current));
    },
    [setFullHeight],
  );

  if (!viewModel) return null;

  const isTall = fullHeight > PREVIEW_MAX_HEIGHT;
  const isClipped = isTall && !expanded;

  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-diff-card-bg'
        style={styles.card}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole='text'
            accessibilityLabel={viewModel.path}
            onLongPress={() => Alert.alert('File path', viewModel.path)}
            style={styles.pathRow}
          >
            <GitCompare size={16} color={iconColor} />
            <Text
              className='min-w-0 flex-1 font-mono text-xs text-foreground'
              numberOfLines={1}
              ellipsizeMode='middle'
            >
              {viewModel.path}
            </Text>
          </Pressable>
          <DiffStat added={viewModel.added} removed={viewModel.removed} />
        </View>
        <View style={[styles.body, { borderTopColor: borderColor }]}>
          <View style={isClipped ? styles.clipped : undefined}>
            <View onLayout={onBodyLayout}>
              {viewModel.lines.map((line, index) => (
                <DiffPatchLine key={`${recyclingKey}:${index}`} text={line.text} kind={line.kind} />
              ))}
            </View>
          </View>
          {isTall ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={expanded ? 'Show less' : 'Read more'}
              hitSlop={8}
              onPressIn={event => event.stopPropagation()}
              onPress={event => {
                event.stopPropagation();
                setExpanded(current => !current);
              }}
              style={styles.readMore}
            >
              <Text style={[styles.readMoreText, { color: readMoreColor }]}>
                {expanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </FlowCardBody>
  );
});
FlowDiffCard.displayName = 'FlowDiffCard';

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pathRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingBottom: 8,
  },
  clipped: {
    maxHeight: PREVIEW_MAX_HEIGHT,
    overflow: 'hidden',
  },
  line: {
    paddingHorizontal: 12,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  readMore: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  readMoreText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
});
