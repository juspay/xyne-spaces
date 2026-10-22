import { type ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import {
  normalizeFlowTextToMarkdown,
  type FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

export function FlowJsonTable({
  nodeKey,
  props,
  renderStyle,
  normalizationOptions,
  renderMarkdown,
}: {
  nodeKey: string;
  props: Record<string, unknown> | undefined;
  renderStyle: StyleProp<ViewStyle>;
  normalizationOptions: FlowTextNormalizationOptions;
  renderMarkdown: (markdown: string, key: string) => ReactElement | null;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const rows = Array.isArray(props?.['rows']) ? props['rows'] : [];
  const hasHeader = props?.['hasHeader'] === true;
  const columnAlignments = Array.isArray(props?.['columnAlignments'])
    ? props['columnAlignments']
    : [];
  return (
    <View key={nodeKey} style={[{ width: '100%', overflow: 'hidden' }, renderStyle]}>
      {rows.map((row, rowIndex) => {
        if (!Array.isArray(row)) return null;
        return (
          <View
            key={`${nodeKey}-row-${rowIndex}`}
            style={{
              flexDirection: 'row',
              backgroundColor: hasHeader && rowIndex === 0 ? tokens.tableHeaderBg : 'transparent',
              borderBottomWidth: 1,
              borderBottomColor: tokens.tableBorderColor,
            }}
          >
            {row.map((cell, cellIndex) => {
              const cellText = normalizeFlowTextToMarkdown(
                typeof cell === 'string' ? cell : String(cell),
                normalizationOptions,
              );
              const align = columnAlignments[cellIndex];
              const alignItems =
                align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
              return (
                <View
                  key={`${nodeKey}-cell-${rowIndex}-${cellIndex}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    ...(typeof align === 'string' ? { alignItems } : {}),
                  }}
                >
                  {renderMarkdown(cellText, `${nodeKey}-cell-body-${rowIndex}-${cellIndex}`)}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
