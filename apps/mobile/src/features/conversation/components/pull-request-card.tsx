import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Text } from 'react-native';

import {
  openLinkPreviewUrl,
  useResolvedLinkPreview,
} from '@/src/features/chat/v2/components/chat/link-preview-card';
import type { LinkPreview } from '@/src/features/chat/v2/paint/chatPaint.types';

import {
  PULL_REQUEST_CARD_RADIUS,
  PULL_REQUEST_INNER_GAP,
  PULL_REQUEST_INNER_PADDING,
  PULL_REQUEST_INNER_RADIUS,
  PULL_REQUEST_META_LINE_HEIGHT,
  PULL_REQUEST_TITLE_LINE_HEIGHT,
  PULL_REQUEST_TITLE_MAX_LINES,
} from '../constants';
import { pullRequestCardModel, type PullRequestRef } from '../model/pull-request';
import { MessageCardFrame } from './message-card-frame';

const INNER_STYLE = {
  padding: PULL_REQUEST_INNER_PADDING,
  rowGap: PULL_REQUEST_INNER_GAP,
} as const;

type PullRequestCardProps = {
  preview: LinkPreview;
  pullRequest: PullRequestRef;
  /** The row's hold, so the card's own pressable does not swallow it. */
  onLongPress?: (() => void) | undefined;
};

/**
 * A pull request linked in a message (Figma "Code / Pull request"): what it
 * is on the white card, in the grey frame every card in a message has. Tap
 * opens the link, as the link preview it replaces did.
 */
export const PullRequestCard = memo(function PullRequestCard({
  preview,
  pullRequest,
  onLongPress,
}: PullRequestCardProps): ReactElement {
  const resolved = useResolvedLinkPreview(preview) ?? preview;
  const model = useMemo(() => pullRequestCardModel(pullRequest, resolved), [pullRequest, resolved]);
  const url = resolved.url;
  const handlePress = useCallback((): void => openLinkPreviewUrl(url), [url]);

  return (
    <MessageCardFrame
      radius={PULL_REQUEST_CARD_RADIUS}
      innerRadius={PULL_REQUEST_INNER_RADIUS}
      innerStyle={INNER_STYLE}
      onPress={handlePress}
      onLongPress={onLongPress}
      accessibilityRole='link'
      accessibilityLabel={`Pull request ${model.subtitle}, ${model.title}`}
    >
      <Text
        className='text-[16px] font-medium tracking-[-0.24px] text-spaces-foreground'
        style={{ lineHeight: PULL_REQUEST_TITLE_LINE_HEIGHT }}
        numberOfLines={PULL_REQUEST_TITLE_MAX_LINES}
      >
        {model.title}
      </Text>
      <Text
        className='text-[12px] text-spaces-subtle'
        style={{ lineHeight: PULL_REQUEST_META_LINE_HEIGHT }}
        numberOfLines={1}
      >
        {model.subtitle}
      </Text>
    </MessageCardFrame>
  );
});
