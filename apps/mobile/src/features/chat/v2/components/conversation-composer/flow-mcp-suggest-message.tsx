import { memo, useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useCSSVariable } from 'uniwind';

import { Button } from '@/src/components/ui/button';
import { DASHBOARD_ORIGIN } from '@/src/config';
import { useAuth } from '@/src/contexts/AuthContext';
import { useMcpCatalog } from '@/src/hooks/useMcpCatalog';
import { useMcpCredentialFields } from '@/src/hooks/useMcpCredentialFields';
import {
  autoConnectSpaces,
  createMcpConnection,
  mcpRequiresCredentials,
  startMcpOAuth,
} from '@/src/services/claw/clawMcpService';
import type { McpServer } from '@/src/services/claw/clawMcpTypes';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createMcpSuggestViewModel,
  mcpSuggestInitials,
  type McpSuggestConnector,
  type McpSuggestViewModel,
} from '@/src/utils/flowMcpSuggestUtils';

import { FlowCardBody } from './flow-card';
import { McpConnectSheet } from './mcp-connect-sheet';

WebBrowser.maybeCompleteAuthSession();

type FlowMcpSuggestMessageProps = {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
};

const OAUTH_RETURN_TO = `${DASHBOARD_ORIGIN}/`;

const ConnectorLogo = ({
  name,
  borderColor,
  muted,
}: {
  name: string;
  borderColor: string;
  muted: string;
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
    <Text style={{ fontSize: 10, fontWeight: '600', color: muted }}>
      {mcpSuggestInitials(name)}
    </Text>
  </View>
);

const ConnectorRow = ({
  connector,
  isConnected,
  isBusy,
  hasError,
  canConnect,
  borderColor,
  muted,
  onConnect,
  onOpenDetail,
}: {
  connector: McpSuggestConnector;
  isConnected: boolean;
  isBusy: boolean;
  hasError: boolean;
  canConnect: boolean;
  borderColor: string;
  muted: string;
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
      onPress={onOpenDetail}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, minWidth: 0 }}
    >
      <ConnectorLogo name={connector.name} borderColor={borderColor} muted={muted} />
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
        onPress={onConnect}
        accessibilityLabel={`Connect ${connector.name}`}
      />
    )}
  </View>
);

const BrowseFooter = ({
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
    <Pressable accessibilityRole='button' accessibilityLabel='Browse MCPs' onPress={onBrowse}>
      <Text className='shrink-0 text-sm font-medium text-foreground'>Browse MCPs</Text>
    </Pressable>
  </View>
);

const urlHasConnectedFlag = (url: string): boolean => {
  try {
    const params = new URL(url).searchParams;
    return [...params.keys()].some(key => key.endsWith('_connected') && params.get(key) === 'true');
  } catch {
    return false;
  }
};

const FlowMcpSuggestMessageComponent = ({
  component,
  containerStyle,
}: FlowMcpSuggestMessageProps): ReactElement | null => {
  const borderColor = useCSSVariable('--color-border') as string;
  const muted = useCSSVariable('--color-foreground') as string;
  const { user } = useAuth();
  const userId = user?.user_id;
  const { connectedServerIds, refetch, serverFor } = useMcpCatalog();
  const { ensureFieldsFor } = useMcpCredentialFields();

  const [busyType, setBusyType] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<McpServer | null>(null);

  const viewModel = createMcpSuggestViewModel(component);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const openLibraryUrl = useCallback((path: string): void => {
    void WebBrowser.openBrowserAsync(`${DASHBOARD_ORIGIN}${path}`).catch(() => {});
  }, []);

  const handleConnect = useCallback(
    async (serverType: string): Promise<void> => {
      const server = serverFor(serverType);
      if (!server || !userId) return;
      setErrorType(null);

      if (mcpRequiresCredentials(server, await ensureFieldsFor(server))) {
        setCredentialsFor(server);
        return;
      }

      setBusyType(serverType);
      try {
        if (server.type === 'xyne-spaces') {
          await autoConnectSpaces(userId);
          refetch();
        } else if (server.oauth || server.type === 'google' || server.type === 'microsoft') {
          const authUrl = await startMcpOAuth(userId, server.type, OAUTH_RETURN_TO);
          const result = await WebBrowser.openAuthSessionAsync(authUrl, OAUTH_RETURN_TO);
          if (result.type === 'success' && urlHasConnectedFlag(result.url)) {
            refetch();
          } else if (result.type === 'success' || result.type === 'dismiss') {
            // Browser closed after consent; catalog may already be updated.
            refetch();
          }
          return;
        } else {
          await createMcpConnection(userId, server.id);
          refetch();
        }
      } catch {
        setErrorType(serverType);
      } finally {
        setBusyType(null);
      }
    },
    [ensureFieldsFor, refetch, serverFor, userId],
  );

  if (!viewModel) return null;

  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-chat-card'
        style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
      >
        <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, gap: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 4,
              minHeight: 24,
            }}
          >
            <Text
              className='min-w-0 flex-1 text-sm font-medium leading-5 text-foreground'
              numberOfLines={1}
            >
              {viewModel.title}
            </Text>
            {viewModel.browseAll ? (
              <View
                className='rounded-full border border-border px-2 py-0.5'
                style={{ flexShrink: 0 }}
              >
                <Text className='text-[11px] font-medium leading-4 text-foreground'>Personal</Text>
              </View>
            ) : null}
          </View>

          <View style={{ paddingHorizontal: 4 }}>
            {viewModel.connectors.map(connector => {
              const server = serverFor(connector.serverType);
              const isConnected = server ? connectedServerIds.has(server.id) : connector.connected;
              return (
                <ConnectorRow
                  key={connector.serverType}
                  connector={connector}
                  isConnected={isConnected}
                  isBusy={busyType === connector.serverType}
                  hasError={errorType === connector.serverType}
                  canConnect={Boolean(server && userId)}
                  borderColor={borderColor}
                  muted={muted}
                  onConnect={() => void handleConnect(connector.serverType)}
                  onOpenDetail={() =>
                    openLibraryUrl(`/ai/library/mcp/${encodeURIComponent(connector.serverType)}`)
                  }
                />
              );
            })}
          </View>
        </View>

        {viewModel.browseAll ? (
          <BrowseFooter
            viewModel={viewModel}
            borderColor={borderColor}
            onBrowse={() => openLibraryUrl('/ai/library?tab=mcp')}
          />
        ) : null}
      </View>

      {userId ? (
        <McpConnectSheet
          server={credentialsFor}
          userId={userId}
          isOpen={Boolean(credentialsFor)}
          onOpenChange={open => {
            if (!open) setCredentialsFor(null);
          }}
          onConnected={refetch}
        />
      ) : null}
    </FlowCardBody>
  );
};

const FlowMcpSuggestMessage = memo(FlowMcpSuggestMessageComponent);
FlowMcpSuggestMessage.displayName = 'FlowMcpSuggestMessage';

export { FlowMcpSuggestMessage };
