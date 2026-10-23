// ---------------------------------------------------------------------------
// Read-only native renderer for a canvas (BlockNote) document. Covers the
// blocks call summaries and PRDs are written with — headings, lists, check
// lists, quotes, code, tables, images, dividers, toggles — plus inline links,
// mentions and transcript citations. Anything unknown degrades to its text.
// ---------------------------------------------------------------------------

import { memo, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, ChevronRight, FileText, Link2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { extractCanvasViewIdFromLink, openDashboardCanvas } from '@/src/utils/canvasUrl';

import type { CanvasBlock, CanvasInline, InlineStyles } from '../utils/canvas-document';

export type CitationTarget = Extract<CanvasInline, { kind: 'citation' }>;

interface Palette {
  foreground: string;
  muted: string;
  border: string;
  subtle: string;
  link: string;
  mentionBg: string;
  mentionText: string;
}

interface RenderContext {
  palette: Palette;
  onLinkPress: (href: string) => void;
  onCitationPress?: ((citation: CitationTarget) => void) | undefined;
}

/** BlockNote's named text / highlight colours. */
const NAMED_TEXT_COLORS: Record<string, string> = {
  gray: '#9B9A97',
  brown: '#64473A',
  red: '#E03E3E',
  orange: '#D9730D',
  yellow: '#DFAB01',
  green: '#4D6461',
  blue: '#0B6E99',
  purple: '#6940A5',
  pink: '#AD1A72',
};
const NAMED_BG_COLORS: Record<string, string> = {
  gray: 'rgba(155,154,151,0.2)',
  brown: 'rgba(100,71,58,0.2)',
  red: 'rgba(224,62,62,0.18)',
  orange: 'rgba(217,115,13,0.18)',
  yellow: 'rgba(223,171,1,0.22)',
  green: 'rgba(77,100,97,0.2)',
  blue: 'rgba(11,110,153,0.18)',
  purple: 'rgba(105,64,165,0.18)',
  pink: 'rgba(173,26,114,0.18)',
};

const BODY_SIZE = 15;
const BODY_LINE = 23;

function textStyle(styles: InlineStyles, palette: Palette): Record<string, unknown> {
  const decorations = [styles.underline ? 'underline' : null, styles.strike ? 'line-through' : null]
    .filter(Boolean)
    .join(' ');
  return {
    ...(styles.bold ? { fontWeight: '700' } : {}),
    ...(styles.italic ? { fontStyle: 'italic' } : {}),
    ...(decorations ? { textDecorationLine: decorations } : {}),
    ...(styles.code
      ? {
          fontFamily: 'Menlo',
          fontSize: BODY_SIZE - 2,
          backgroundColor: palette.subtle,
        }
      : {}),
    ...(styles.textColor && NAMED_TEXT_COLORS[styles.textColor]
      ? { color: NAMED_TEXT_COLORS[styles.textColor] }
      : {}),
    ...(styles.backgroundColor && NAMED_BG_COLORS[styles.backgroundColor]
      ? { backgroundColor: NAMED_BG_COLORS[styles.backgroundColor] }
      : {}),
  };
}

function renderInline(nodes: readonly CanvasInline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `i${index}`;
    if (node.kind === 'break') return <Text key={key}>{'\n'}</Text>;
    if (node.kind === 'mention') {
      return (
        <Text
          key={key}
          style={{
            color: ctx.palette.mentionText,
            backgroundColor: ctx.palette.mentionBg,
            fontWeight: '600',
          }}
        >
          {` @${node.label || 'someone'} `}
        </Text>
      );
    }
    if (node.kind === 'citation') {
      const label = node.timestamp || (node.segment !== null ? `#${node.segment}` : 'source');
      return (
        <Text
          key={key}
          accessibilityRole='link'
          accessibilityLabel={`Transcript at ${label}${node.speaker ? `, ${node.speaker}` : ''}`}
          onPress={ctx.onCitationPress ? (): void => ctx.onCitationPress?.(node) : undefined}
          style={{
            color: ctx.palette.muted,
            backgroundColor: ctx.palette.subtle,
            fontSize: BODY_SIZE - 3,
            fontWeight: '600',
          }}
        >
          {` ${label}${node.count > 1 ? ` +${node.count - 1}` : ''} `}
        </Text>
      );
    }
    const style = textStyle(node.styles, ctx.palette);
    if (node.href) {
      const href = node.href;
      return (
        <Text
          key={key}
          accessibilityRole='link'
          onPress={(): void => ctx.onLinkPress(href)}
          style={[style, { color: ctx.palette.link, textDecorationLine: 'underline' }]}
        >
          {node.text}
        </Text>
      );
    }
    return (
      <Text key={key} style={style}>
        {node.text}
      </Text>
    );
  });
}

function InlineText({
  content,
  ctx,
  size = BODY_SIZE,
  lineHeight = BODY_LINE,
  weight,
  color,
  extra,
}: {
  content: readonly CanvasInline[];
  ctx: RenderContext;
  size?: number;
  lineHeight?: number;
  weight?: '400' | '600' | '700';
  color?: string;
  extra?: Record<string, unknown>;
}): ReactElement {
  return (
    <Text
      selectable
      style={{
        color: color ?? ctx.palette.foreground,
        fontSize: size,
        lineHeight,
        ...(weight ? { fontWeight: weight } : {}),
        ...extra,
      }}
    >
      {content.length > 0 ? renderInline(content, ctx) : '​'}
    </Text>
  );
}

/** Indexed by heading level − 1. */
const HEADING_SIZES = [
  { size: 22, line: 28, top: 14 },
  { size: 18, line: 25, top: 12 },
  { size: 16, line: 22, top: 10 },
] as const;

function ListMarker({ children }: { children: ReactNode }): ReactElement {
  return <View style={{ width: 22, alignItems: 'flex-start', paddingTop: 0 }}>{children}</View>;
}

function TableBlock({ block, ctx }: { block: CanvasBlock; ctx: RenderContext }): ReactElement {
  const rows = block.rows ?? [];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
      <View
        style={{
          borderWidth: 1,
          borderColor: ctx.palette.border,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, rowIndex) => {
          const isHeaderRow = row.length > 0 && row.every(cell => cell.isHeader);
          return (
            <View
              key={`r${rowIndex}`}
              style={{
                flexDirection: 'row',
                borderTopWidth: rowIndex === 0 ? 0 : 1,
                borderColor: ctx.palette.border,
                backgroundColor: isHeaderRow ? ctx.palette.subtle : 'transparent',
              }}
            >
              {row.map((cell, cellIndex) => (
                <View
                  key={`c${cellIndex}`}
                  style={{
                    width: 160,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderLeftWidth: cellIndex === 0 ? 0 : 1,
                    borderColor: ctx.palette.border,
                  }}
                >
                  <InlineText
                    content={cell.content}
                    ctx={ctx}
                    size={13.5}
                    lineHeight={19}
                    {...(isHeaderRow || cell.isHeader ? { weight: '600' as const } : {})}
                  />
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ToggleBlock({
  block,
  ctx,
  depth,
}: {
  block: CanvasBlock;
  ctx: RenderContext;
  depth: number;
}): ReactElement {
  const [open, setOpen] = useState(true);
  return (
    <View>
      <Pressable
        onPress={(): void => setOpen(value => !value)}
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row' }}
      >
        <ListMarker>
          <View style={{ paddingTop: 4, transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
            <ChevronRight size={15} color={ctx.palette.muted} />
          </View>
        </ListMarker>
        <View style={{ flex: 1 }}>
          <InlineText content={block.content} ctx={ctx} />
        </View>
      </Pressable>
      {open && block.children.length > 0 ? (
        <View style={{ marginLeft: 22 }}>
          <BlockList blocks={block.children} ctx={ctx} depth={depth + 1} />
        </View>
      ) : null}
    </View>
  );
}

function MediaBlock({ block, ctx }: { block: CanvasBlock; ctx: RenderContext }): ReactElement {
  const url = typeof block.props['url'] === 'string' ? block.props['url'] : '';
  const caption = typeof block.props['caption'] === 'string' ? block.props['caption'] : '';
  const name = typeof block.props['name'] === 'string' ? block.props['name'] : '';
  const isImage = block.type === 'image' && /^https?:\/\//.test(url);
  return (
    <View style={{ marginVertical: 6, gap: 6 }}>
      {isImage ? (
        <Image
          source={{ uri: url }}
          resizeMode='contain'
          style={{
            width: '100%',
            height: 200,
            borderRadius: 10,
            backgroundColor: ctx.palette.subtle,
          }}
          accessibilityLabel={caption || name || 'Image'}
        />
      ) : url ? (
        <Pressable
          onPress={(): void => ctx.onLinkPress(url)}
          className='flex-row items-center gap-2 rounded-xl px-3 py-2.5 active:opacity-70'
          style={{ borderWidth: 1, borderColor: ctx.palette.border }}
        >
          {block.type === 'embed' ? (
            <Link2 size={16} color={ctx.palette.muted} />
          ) : (
            <FileText size={16} color={ctx.palette.muted} />
          )}
          <Text numberOfLines={1} style={{ flex: 1, color: ctx.palette.link, fontSize: 14 }}>
            {name || url}
          </Text>
        </Pressable>
      ) : null}
      {caption ? <Text style={{ color: ctx.palette.muted, fontSize: 12.5 }}>{caption}</Text> : null}
    </View>
  );
}

function BlockView({
  block,
  ctx,
  depth,
  ordinal,
}: {
  block: CanvasBlock;
  ctx: RenderContext;
  depth: number;
  ordinal: number;
}): ReactElement | null {
  const { palette } = ctx;
  const children =
    block.children.length > 0 ? (
      <View style={{ marginLeft: 22 }}>
        <BlockList blocks={block.children} ctx={ctx} depth={depth + 1} />
      </View>
    ) : null;

  switch (block.type) {
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(block.props['level'] ?? 1) || 1));
      const spec = HEADING_SIZES[level - 1] ?? HEADING_SIZES[2];
      return (
        <View style={{ marginTop: spec.top }}>
          <InlineText
            content={block.content}
            ctx={ctx}
            size={spec.size}
            lineHeight={spec.line}
            weight={level === 1 ? '700' : '600'}
          />
          {children}
        </View>
      );
    }
    case 'bulletListItem':
      return (
        <View>
          <View style={{ flexDirection: 'row' }}>
            <ListMarker>
              <Text style={{ color: palette.muted, fontSize: BODY_SIZE, lineHeight: BODY_LINE }}>
                {depth % 3 === 0 ? '•' : depth % 3 === 1 ? '◦' : '▪'}
              </Text>
            </ListMarker>
            <View style={{ flex: 1 }}>
              <InlineText content={block.content} ctx={ctx} />
            </View>
          </View>
          {children}
        </View>
      );
    case 'numberedListItem':
      return (
        <View>
          <View style={{ flexDirection: 'row' }}>
            <ListMarker>
              <Text
                style={{
                  color: palette.muted,
                  fontSize: BODY_SIZE,
                  lineHeight: BODY_LINE,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {`${ordinal}.`}
              </Text>
            </ListMarker>
            <View style={{ flex: 1 }}>
              <InlineText content={block.content} ctx={ctx} />
            </View>
          </View>
          {children}
        </View>
      );
    case 'checkListItem': {
      const checked = block.props['checked'] === true || block.props['checked'] === 'true';
      return (
        <View>
          <View style={{ flexDirection: 'row' }}>
            <ListMarker>
              <View
                style={{
                  marginTop: 4,
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  borderWidth: 1.5,
                  borderColor: checked ? palette.link : palette.muted,
                  backgroundColor: checked ? palette.link : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {checked ? <Check size={11} color='#FFFFFF' strokeWidth={3} /> : null}
              </View>
            </ListMarker>
            <View style={{ flex: 1 }}>
              <InlineText
                content={block.content}
                ctx={ctx}
                {...(checked
                  ? { color: palette.muted, extra: { textDecorationLine: 'line-through' } }
                  : {})}
              />
            </View>
          </View>
          {children}
        </View>
      );
    }
    case 'toggleListItem':
      return <ToggleBlock block={block} ctx={ctx} depth={depth} />;
    case 'quote':
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderColor: palette.border,
            paddingLeft: 12,
            marginVertical: 2,
          }}
        >
          <InlineText content={block.content} ctx={ctx} color={palette.muted} />
          {children}
        </View>
      );
    case 'codeBlock':
    case 'diagram':
    case 'mathBlock':
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: palette.subtle, borderRadius: 10, marginVertical: 4 }}
          contentContainerStyle={{ padding: 12 }}
        >
          <InlineText
            content={block.content}
            ctx={ctx}
            size={13}
            lineHeight={19}
            extra={{ fontFamily: 'Menlo' }}
          />
        </ScrollView>
      );
    case 'table':
      return <TableBlock block={block} ctx={ctx} />;
    case 'divider':
      return <View style={{ height: 1, backgroundColor: palette.border, marginVertical: 10 }} />;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'embed':
      return <MediaBlock block={block} ctx={ctx} />;
    default:
      return (
        <View>
          <InlineText content={block.content} ctx={ctx} />
          {children}
        </View>
      );
  }
}

function BlockList({
  blocks,
  ctx,
  depth,
}: {
  blocks: readonly CanvasBlock[];
  ctx: RenderContext;
  depth: number;
}): ReactElement {
  let ordinal = 0;
  return (
    <View style={{ gap: 6 }}>
      {blocks.map(block => {
        if (block.type === 'numberedListItem') {
          const start = Number(block.props['start']);
          ordinal = ordinal === 0 && Number.isFinite(start) && start > 0 ? start : ordinal + 1;
        } else {
          ordinal = 0;
        }
        return <BlockView key={block.id} block={block} ctx={ctx} depth={depth} ordinal={ordinal} />;
      })}
    </View>
  );
}

export interface CanvasDocumentViewProps {
  blocks: readonly CanvasBlock[];
  onCitationPress?: (citation: CitationTarget) => void;
}

export const CanvasDocumentView = memo(function CanvasDocumentView({
  blocks,
  onCitationPress,
}: CanvasDocumentViewProps): ReactElement {
  const router = useRouter();
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const border = useCSSVariable('--color-border') as string;
  const subtle = useCSSVariable('--color-secondary') as string;
  const link = useCSSVariable('--color-action-primary') as string;
  const mentionBg = useCSSVariable('--color-mention-other-bg') as string;
  const mentionText = useCSSVariable('--color-mention-other-text') as string;

  const ctx = useMemo<RenderContext>(
    () => ({
      palette: {
        foreground,
        muted,
        border,
        subtle: subtle || 'rgba(127,127,127,0.12)',
        link: link || '#2563EB',
        mentionBg: mentionBg || 'rgba(37,99,235,0.12)',
        mentionText: mentionText || link || '#2563EB',
      },
      onLinkPress: (href: string): void => {
        if (extractCanvasViewIdFromLink(href)) {
          const canvasId = extractCanvasViewIdFromLink(href);
          if (canvasId) openDashboardCanvas(router, canvasId);
          return;
        }
        if (/^(https?:|mailto:|tel:)/i.test(href)) void Linking.openURL(href).catch(() => {});
      },
      onCitationPress,
    }),
    [foreground, muted, border, subtle, link, mentionBg, mentionText, router, onCitationPress],
  );

  return <BlockList blocks={blocks} ctx={ctx} depth={0} />;
});
