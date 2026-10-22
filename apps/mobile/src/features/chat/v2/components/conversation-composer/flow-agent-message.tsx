import { memo, useEffect, useState, type ReactElement } from 'react';
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Maximize2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import {
  shouldCloseAgentPreviewForPhase,
  type AgentCardViewModel,
} from '@/src/utils/flowAgentUtils';
import type { FlowActionButton } from '@/src/utils/flowAction';

import { useConversationComposer } from './conversation-composer-context';
import { FlowAgentPreviewSheet } from './flow-agent-preview-sheet';
import { FlowCardBody, FlowCardHeader } from './flow-card';
import { useDraftAgentEditor } from './utils/useDraftAgentEditor';
import { PARAGRAPH_LINE_HEIGHT } from './utils/markdownStyle';

type FlowAgentMessageProps = {
  viewModel: AgentCardViewModel;
  titleStyle: TextStyle;
  containerStyle?: StyleProp<ViewStyle>;
  buttons: FlowActionButton[];
  isSubmitting?: boolean;
  renderMarkdown: (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ) => ReactElement | null;
  renderNestedMarkdown?: (markdown: string, key: string) => ReactElement | null;
  renderButton: (button: FlowActionButton) => ReactElement;
  onAction?: (button: FlowActionButton) => void | Promise<boolean | void>;
  updateFieldValue?: (name: string, value: unknown) => void;
};

// View and Chat with agent both open dashboard routes. Restore with:
// import * as WebBrowser from 'expo-web-browser';
// import { DASHBOARD_ORIGIN } from '@/src/config';
// import { agentChatPath, agentLibraryPath } from '@/src/utils/flowAgentUtils';
// const openDashboardPath = (path: string): void => {
//   void WebBrowser.openBrowserAsync(`${DASHBOARD_ORIGIN}${path}`).catch(() => {});
// };

const FlowAgentMessageComponent = ({
  viewModel,
  titleStyle,
  containerStyle,
  buttons,
  isSubmitting = false,
  renderMarkdown,
  renderNestedMarkdown,
  renderButton,
  onAction,
  updateFieldValue,
}: FlowAgentMessageProps): ReactElement => {
  const { suppressBubblePress } = useConversationComposer();
  const muted = useCSSVariable('--color-foreground') as string;
  const [expanded, setExpanded] = useState(false);
  const editor = useDraftAgentEditor({
    ...(viewModel.phase ? { phase: viewModel.phase } : {}),
    canEditDraft: viewModel.canEditDraft,
    isSubmitting,
    componentId: viewModel.componentId,
    initialSelection: viewModel.initialToolSelection,
    initialModelId: viewModel.initialModelId,
    initialProviderOrder: viewModel.initialProviderOrder,
    resetKey: `${viewModel.slug}:${viewModel.phase ?? viewModel.variant}`,
    ...(updateFieldValue ? { updateFieldValue } : {}),
  });

  useEffect(() => {
    if (shouldCloseAgentPreviewForPhase(viewModel.phase)) setExpanded(false);
  }, [viewModel.phase]);

  const hasBodyBelowHeader =
    viewModel.description.trim().length > 0 ||
    Boolean(viewModel.auditLine) ||
    Boolean(viewModel.decidedByLabel) ||
    buttons.length > 0;

  const decidedByUser = useUserSnapshot(viewModel.decidedByUserId ?? '');
  const decidedByDisplayName =
    decidedByUser?.displayName?.trim() ||
    decidedByUser?.name?.trim() ||
    viewModel.decidedByName?.trim();

  // View opens `/ai/library/agent/{slug}`. Hidden until that page exists on mobile.
  // const openLibrary = useCallback(() => {
  //   openDashboardPath(agentLibraryPath(viewModel.slug));
  // }, [viewModel.slug]);
  // Chat with agent opens `/ai/chat/new?agent={slug}`. Restore with the View button.
  // const openAgentChat = useCallback(() => {
  //   openDashboardPath(agentChatPath(viewModel.slug));
  // }, [viewModel.slug]);

  // View — restore when `/ai/library/agent/{slug}` exists on mobile.
  // const headerEnd = viewModel.showViewAction ? (
  //   <Pressable
  //     accessibilityRole='button'
  //     accessibilityLabel='View agent'
  //     hitSlop={8}
  //     onPressIn={event => {
  //       event.stopPropagation();
  //       suppressBubblePress();
  //     }}
  //     onPress={event => {
  //       event.stopPropagation();
  //       openLibrary();
  //     }}
  //   >
  //     <Text className='text-sm font-semibold text-foreground'>View</Text>
  //   </Pressable>
  // ) : viewModel.showExpandAction ? (

  const headerEnd = viewModel.showExpandAction ? (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Expand agent'
      hitSlop={8}
      onPressIn={event => {
        event.stopPropagation();
        suppressBubblePress();
      }}
      onPress={event => {
        event.stopPropagation();
        setExpanded(true);
      }}
    >
      <Maximize2 size={16} color={muted} />
    </Pressable>
  ) : null;

  const actionRow =
    buttons.length > 0 ? (
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 2,
          minWidth: 0,
          maxWidth: '100%',
          justifyContent: 'flex-end',
        }}
      >
        {buttons.map(button => renderButton(button))}
        {/* Chat with agent — restore when a mobile destination exists.
        {viewModel.showChatAction ? (
          <Button
            size='xs'
            label='Chat with agent'
            variant='secondary'
            onPressIn={event => {
              event.stopPropagation();
              suppressBubblePress();
            }}
            onPress={event => {
              event.stopPropagation();
              openAgentChat();
            }}
          />
        ) : null}
        */}
      </View>
    ) : null;

  const identity = (
    <>
      <View style={{ gap: 2, minWidth: 0 }}>
        <Text className='text-base font-semibold text-foreground'>{viewModel.name}</Text>
        <Text className='text-sm text-foreground'>@{viewModel.slug}</Text>
      </View>

      {viewModel.description.trim() ? (
        <View style={{ gap: 4, minWidth: 0 }}>
          <Text className='text-sm font-semibold text-flow-card-header-title'>Description</Text>
          {renderNestedMarkdown?.(viewModel.description, 'agent-description') ??
            renderMarkdown(viewModel.description, 'agent-description')}
        </View>
      ) : null}
    </>
  );

  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={viewModel.title}
        statusLabel={viewModel.statusLabel}
        statusTone={viewModel.statusTone}
        titleStyle={{
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight ?? PARAGRAPH_LINE_HEIGHT,
        }}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 2 } } : {})}
        {...(headerEnd ? { end: headerEnd } : {})}
      />

      {identity}

      {viewModel.decidedByLabel ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            marginTop: 2,
          }}
        >
          <Text className='text-xs font-semibold text-foreground'>{viewModel.decidedByLabel}</Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}
          >
            {viewModel.decidedByUserId ? (
              <Avatar userIds={[viewModel.decidedByUserId]} size={18} rounded={false} />
            ) : null}
            {decidedByDisplayName ? (
              <Text className='shrink text-xs font-semibold text-foreground' numberOfLines={1}>
                {decidedByDisplayName}
              </Text>
            ) : null}
          </View>
        </View>
      ) : viewModel.auditLine ? (
        <Text className='text-sm text-foreground'>{viewModel.auditLine}</Text>
      ) : null}

      {actionRow}

      <FlowAgentPreviewSheet
        viewModel={viewModel}
        editor={editor}
        isOpen={expanded}
        isSubmitting={isSubmitting}
        buttons={buttons}
        onOpenChange={setExpanded}
        {...(onAction ? { onAction } : {})}
      />
    </FlowCardBody>
  );
};

const FlowAgentMessage = memo(FlowAgentMessageComponent);
FlowAgentMessage.displayName = 'FlowAgentMessage';

export { FlowAgentMessage };
