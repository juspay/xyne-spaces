import { memo, useCallback, useEffect, type ReactElement } from 'react';
import { AppState, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { McpConnectSheet } from '@/src/components/chat/mcp-connect-sheet';
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
import { createMcpSuggestViewModel } from '@/src/utils/flowMcpSuggestUtils';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { useRecyclingState } from '../useRecyclingState';
import { FlowCardBody } from './FlowCard';
import { BrowseFooter, ConnectorRow } from './FlowMcpSuggestRows';

WebBrowser.maybeCompleteAuthSession();

const OAUTH_RETURN_TO = `${DASHBOARD_ORIGIN}/`;

const urlHasConnectedFlag = (url: string): boolean => {
  try {
    const params = new URL(url).searchParams;
    return [...params.keys()].some(key => key.endsWith('_connected') && params.get(key) === 'true');
  } catch {
    return false;
  }
};

export const FlowMcpSuggestCard = memo(function FlowMcpSuggestCard({
  component,
  containerStyle,
  recyclingKey,
}: {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  recyclingKey: string;
}): ReactElement | null {
  const tokens = useChatRenderTokens();
  const { user } = useAuth();
  const userId = user?.user_id;
  const { connectedServerIds, refetch, serverFor } = useMcpCatalog();
  const { ensureFieldsFor } = useMcpCredentialFields();
  const [busyType, setBusyType] = useRecyclingState<string | null>(
    `${recyclingKey}:mcp-busy`,
    null,
  );
  const [errorType, setErrorType] = useRecyclingState<string | null>(
    `${recyclingKey}:mcp-error`,
    null,
  );
  const [credentialsFor, setCredentialsFor] = useRecyclingState<McpServer | null>(
    `${recyclingKey}:mcp-credentials`,
    null,
  );
  const viewModel = createMcpSuggestViewModel(component);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refetch();
    });
    return (): void => {
      sub.remove();
    };
  }, [refetch]);

  const openLibraryUrl = useCallback((path: string): void => {
    void WebBrowser.openBrowserAsync(`${DASHBOARD_ORIGIN}${path}`).catch(() => {});
  }, []);

  const handleConnect = useCallback(
    (serverType: string): void => {
      const server = serverFor(serverType);
      if (!server || !userId) return;
      setErrorType(null);

      void (async (): Promise<void> => {
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
      })();
    },
    [ensureFieldsFor, refetch, serverFor, setBusyType, setCredentialsFor, setErrorType, userId],
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
                  borderColor={tokens.borderColor}
                  mutedColor={tokens.foreground}
                  onConnect={() => handleConnect(connector.serverType)}
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
            borderColor={tokens.borderColor}
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
});
FlowMcpSuggestCard.displayName = 'FlowMcpSuggestCard';
