import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { BlockMarkdown, type MarkdownStream } from '@/src/features/chat/v3/rows/BlockMarkdown';
import { haptics } from '@/src/utils/haptics';

import { splitCodeBlocks } from '../model/codeBlocks';

const MarkdownSegment = memo(BlockMarkdown);

// Same as the dashboard: longer blocks open as a 20-line preview.
const COLLAPSE_LINES = 50;
const CODE_LINE_HEIGHT = 20;
const PREVIEW_HEIGHT = 20 * CODE_LINE_HEIGHT + 24;

const CodeBlock = memo(function CodeBlock({ code }: { code: string }): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = code.split('\n').length;
  const isCollapsible = lines > COLLAPSE_LINES;
  const Icon = copied ? Check : Copy;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return (): void => clearTimeout(timer);
  }, [copied]);

  return (
    <View className='overflow-hidden rounded-[10px] border border-border bg-secondary'>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={isCollapsible && !isExpanded ? { maxHeight: PREVIEW_HEIGHT } : undefined}
        contentContainerClassName='py-3 pl-3 pr-12'
      >
        <Text
          selectable
          className='font-mono text-[13px] text-foreground'
          style={{ lineHeight: CODE_LINE_HEIGHT }}
        >
          {code}
        </Text>
      </ScrollView>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Copy code'
        hitSlop={8}
        onPress={(): void => {
          void Clipboard.setStringAsync(code);
          void haptics.success();
          setCopied(true);
        }}
        className='absolute right-2 top-2 rounded-md border border-border bg-background p-1.5 active:opacity-60'
      >
        <Icon size={14} color={muted} />
      </Pressable>
      {isCollapsible ? (
        <Pressable
          accessibilityRole='button'
          onPress={(): void => setIsExpanded(open => !open)}
          className='items-center border-t border-border py-2 active:opacity-60'
        >
          <Text className='text-[13px] text-foreground'>
            {isExpanded ? 'Show less' : `Show more (${lines} lines)`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

export const StreamingMarkdown = ({
  markdown,
  isStreaming,
  viewerId,
  onOpenUrl,
}: {
  markdown: string;
  isStreaming: boolean;
  viewerId: string;
  onOpenUrl: (url: string) => void;
}): ReactElement => {
  const [streamed] = useState(isStreaming);
  const segments = useMemo(() => splitCodeBlocks(markdown), [markdown]);
  const lastIndex = segments.length - 1;
  const streamOf = (index: number): MarkdownStream | undefined => {
    if (isStreaming && index === lastIndex) return 'live';
    return streamed || isStreaming ? 'done' : undefined;
  };
  return (
    <View className='gap-3'>
      {segments.map((segment, index) =>
        segment.kind === 'code' ? (
          <CodeBlock key={index} code={segment.value} />
        ) : (
          <MarkdownSegment
            key={index}
            markdown={segment.value}
            mine={false}
            viewerId={viewerId}
            onOpenUrl={onOpenUrl}
            stream={streamOf(index)}
          />
        ),
      )}
    </View>
  );
};
