import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/src/components/ui/button';
import {
  mcpSuggestInitials,
  type McpSuggestConnector,
  type McpSuggestViewModel,
} from '@/src/utils/flowMcpSuggestUtils';

export const ConnectorLogo = ({
  name,
  borderColor,
  mutedColor,
}: {
  name: string;
  borderColor: string;
  mutedColor: string;
}): ReactElement => (
  <View
    style={{
      width: 28,
      height: 28,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}
  >
    <Text style={{ fontSize: 10, fontWeight: '600', color: mutedColor }}>
      {mcpSuggestInitials(name)}
    </Text>
  </View>
);

export const ConnectorRow = ({
  connector,
  isConnected,
  isBusy,
  hasError,
  canConnect,
  borderColor,
  mutedColor,
  onConnect,
  onOpenDetail,
}: {
  connector: McpSuggestConnector;
  isConnected: boolean;
  isBusy: boolean;
  hasError: boolean;
  canConnect: boolean;
  borderColor: string;
  mutedColor: string;
  onConnect: () => void;
  onOpenDetail: () => void;
}): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      minWidth: 0,
    }}
  >
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${connector.name}`}
      onPressIn={event => event.stopPropagation()}
      onPress={event => {
        event.stopPropagation();
        onOpenDetail();
      }}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, minWidth: 0 }}
    >
      <ConnectorLogo name={connector.name} borderColor={borderColor} mutedColor={mutedColor} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text className='text-sm font-medium leading-5 text-foreground' numberOfLines={1}>
          {connector.name}
        </Text>
        {connector.description ? (
          <Text className='text-xs leading-5 text-foreground' numberOfLines={2}>
            {connector.description}
          </Text>
        ) : null}
        {hasError ? (
          <Text className='text-xs leading-5 text-destructive'>Could not connect. Try again.</Text>
        ) : null}
      </View>
    </Pressable>
    {isConnected ? (
      <Text className='shrink-0 px-2 py-1 text-xs font-medium leading-5 text-foreground'>
        Connected
      </Text>
    ) : (
      <Button
        label={isBusy ? 'Connecting…' : 'Connect'}
        variant='secondary'
        size='xs'
        loading={isBusy}
        disabled={!canConnect || isBusy}
        onPressIn={event => event.stopPropagation()}
        onPress={event => {
          event.stopPropagation();
          onConnect();
        }}
        accessibilityLabel={`Connect ${connector.name}`}
      />
    )}
  </View>
);

export const BrowseFooter = ({
  viewModel,
  borderColor,
  onBrowse,
}: {
  viewModel: McpSuggestViewModel;
  borderColor: string;
  onBrowse: () => void;
}): ReactElement => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderColor,
    }}
  >
    <Text className='min-w-0 flex-1 text-xs leading-5 text-foreground' numberOfLines={1}>
      {viewModel.footerLabel}
    </Text>
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Browse MCPs'
      onPressIn={event => event.stopPropagation()}
      onPress={event => {
        event.stopPropagation();
        onBrowse();
      }}
    >
      <Text className='shrink-0 text-sm font-medium text-foreground'>Browse MCPs</Text>
    </Pressable>
  </View>
);
