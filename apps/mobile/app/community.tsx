/**
 * Community landing screen — the app's first screen when signed out.
 *
 * Ports the interactive left panel of the dashboard's `/community` page
 * (`apps/dashboard/src/routes/AuthScreen/CommunityWorkspaceScreen.tsx`). The listing endpoint is
 * public, so this renders without any session, VPN, or device enrollment. From here the user either
 * joins a public community or falls through to the existing org login.
 */

import { ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Globe, LockKeyhole, Mail, MessageSquare, Users, Zap } from 'lucide-react-native';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  CommunityJoinResultStatus,
  flattenCommunityWorkspaces,
  listCommunityWorkspaces,
  WorkspaceJoinPolicy,
  type CommunityWorkspace,
} from '@/src/services/CommunityServices';
import {
  clearEnterpriseLoginIntent,
  setEnterpriseLoginIntent,
  setPendingCommunityWorkspace,
} from '@/src/services/communityIntent';
import { AuthButton, Divider } from '@/src/components/auth/auth-button';
import { XyneLogo } from '@/src/assets/icons/XyneLogo';

const COMMUNITY_WORKSPACES_QUERY_KEY = ['community', 'workspaces'] as const;

const TILE_COLORS = ['#4f7df9', '#a78bfa', '#f5b63d', '#34c98e', '#6366f1', '#f472b6'] as const;

/** Deterministic hue from a string — same implementation as the dashboard's `hashHue`. */
function hashHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

function getTileColor(name: string): string {
  const hue = hashHue(name);
  return TILE_COLORS[(hue + (hue % 6)) % TILE_COLORS.length] ?? '#4f7df9';
}

/** Minimal glyph per workspace — deterministic pick from a small set, matching the dashboard. */
function WorkspaceGlyph({ name }: { name: string }): ReactElement {
  const props = { size: 20, color: '#ffffff', strokeWidth: 2.2 } as const;
  switch (hashHue(name) % 4) {
    case 0:
      return <MessageSquare {...props} />;
    case 1:
      return <Zap {...props} />;
    case 2:
      return <Globe {...props} />;
    default:
      return <Users {...props} />;
  }
}

interface CommunityRowProps {
  workspace: CommunityWorkspace;
  disabled: boolean;
  pillLabel: string;
  pillIcon: ReactElement | null;
  onPress: () => void;
}

function CommunityRow({
  workspace,
  disabled,
  pillLabel,
  pillIcon,
  onPress,
}: CommunityRowProps): ReactElement {
  const primaryText = useCSSVariable('--color-auth-primary-text') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  const cardBorder = useCSSVariable('--color-auth-card-border') as string;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={`${pillLabel} ${workspace.name}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: getTileColor(workspace.name),
        }}
      >
        <WorkspaceGlyph name={workspace.name} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500', color: primaryText }}>
          {workspace.name}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: secondaryText, marginTop: 2 }}>
          {workspace.description || 'Community space'}
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1,
          borderColor: cardBorder,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}
      >
        {pillIcon}
        <Text style={{ fontSize: 14, fontWeight: '500', color: primaryText }}>{pillLabel}</Text>
      </View>
    </Pressable>
  );
}

const CommunityScreen = (): ReactElement => {
  const background = useCSSVariable('--color-auth-background') as string;
  const cardBackground = useCSSVariable('--color-auth-card-bg') as string;
  const cardBorder = useCSSVariable('--color-auth-card-border') as string;
  const primaryText = useCSSVariable('--color-auth-primary-text') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  const activityIndicator = useCSSVariable('--color-auth-activity-indicator') as string;
  const errorText = useCSSVariable('--color-auth-error') as string;
  const successText = useCSSVariable('--color-auth-success') as string;
  const infoBannerBg = useCSSVariable('--color-auth-info-icon-bg') as string;
  const primaryBtnText = useCSSVariable('--color-auth-primary-btn-text') as string;

  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const { workspaceId: workspaceIdParam } = useLocalSearchParams<{ workspaceId?: string }>();

  const { isLoading: isAuthLoading, communityJoinRequest, communityJoinError } = useAuth();
  const handledInviteRef = useRef(false);

  const {
    data: organizations,
    isPending,
    isError,
  } = useQuery({
    queryKey: COMMUNITY_WORKSPACES_QUERY_KEY,
    queryFn: listCommunityWorkspaces,
  });

  const workspaces = useMemo(
    () => flattenCommunityWorkspaces(organizations ?? []),
    [organizations],
  );

  // This screen only renders while signed out, so a tap always records the intent and routes to
  // sign-in; `AuthContext` completes the join once an identity cookie exists.
  const handleRowPress = useCallback(
    (workspace: CommunityWorkspace): void => {
      clearEnterpriseLoginIntent();
      setPendingCommunityWorkspace(workspace.id, workspace.name);
      router.push('/login');
    },
    [router],
  );

  const handleContinueWithWorkEmail = useCallback((): void => {
    setEnterpriseLoginIntent();
    router.push('/login');
  }, [router]);

  // Invite deep link (`/community/join?workspaceId=…`): resolve the name once the listing lands so
  // the login banner can name the community, then send the user to sign in.
  useEffect(() => {
    if (handledInviteRef.current || !workspaceIdParam || isPending) {
      return;
    }
    handledInviteRef.current = true;

    const match = workspaces.find(workspace => workspace.id === workspaceIdParam);
    clearEnterpriseLoginIntent();
    setPendingCommunityWorkspace(workspaceIdParam, match?.name);
    router.push('/login');
  }, [isPending, router, workspaceIdParam, workspaces]);

  useEffect(() => {
    if (communityJoinError) {
      Alert.alert('Unable to join community', communityJoinError);
    }
  }, [communityJoinError]);

  const renderJoinRequestBanner = (): ReactElement | null => {
    if (!communityJoinRequest) {
      return null;
    }

    const isRejected = communityJoinRequest.status === CommunityJoinResultStatus.REQUEST_REJECTED;
    const title = isRejected
      ? 'Request rejected'
      : communityJoinRequest.isExisting
        ? 'Request already created'
        : 'Request submitted';
    const body = isRejected
      ? 'A workspace admin rejected this access request.'
      : communityJoinRequest.isExisting
        ? 'Your request was already created and will be reviewed by community owners.'
        : 'Your request has been submitted and will be reviewed by community owners.';

    return (
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: cardBorder,
          backgroundColor: infoBannerBg,
          padding: 14,
          gap: 4,
        }}
      >
        <Text
          style={{ fontSize: 14, fontWeight: '600', color: isRejected ? errorText : successText }}
        >
          {title}
        </Text>
        <Text style={{ fontSize: 13, color: secondaryText, lineHeight: 20 }}>{body}</Text>
      </View>
    );
  };

  const renderList = (): ReactElement => {
    if (isPending) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={activityIndicator} />
        </View>
      );
    }

    if (isError) {
      return (
        <Text style={{ fontSize: 13, color: errorText, paddingVertical: 16 }}>
          Community workspaces are unavailable right now.
        </Text>
      );
    }

    if (workspaces.length === 0) {
      return (
        <Text style={{ fontSize: 13, color: secondaryText, paddingVertical: 16 }}>
          No community workspaces are available.
        </Text>
      );
    }

    return (
      <View>
        {workspaces.map(workspace => {
          const isTarget = communityJoinRequest?.workspaceId === workspace.id;
          const isRejected =
            isTarget && communityJoinRequest?.status === CommunityJoinResultStatus.REQUEST_REJECTED;
          const isPendingRequest =
            isTarget && communityJoinRequest?.status === CommunityJoinResultStatus.REQUEST_PENDING;

          let pillLabel = 'Join';
          let pillIcon: ReactElement | null = null;
          if (isRejected) {
            pillLabel = 'Rejected';
            pillIcon = <LockKeyhole size={14} color={secondaryText} />;
          } else if (isPendingRequest) {
            pillLabel = 'Pending';
            pillIcon = <Clock3 size={14} color={secondaryText} />;
          } else if (workspace.joinPolicy === WorkspaceJoinPolicy.REQUEST_TO_JOIN) {
            pillLabel = 'Request to Join';
          }

          return (
            <CommunityRow
              key={workspace.id}
              workspace={workspace}
              disabled={isRejected || isPendingRequest || isAuthLoading}
              pillLabel={pillLabel}
              pillIcon={pillIcon}
              onPress={() => handleRowPress(workspace)}
            />
          );
        })}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingVertical: 32,
          alignItems: 'center',
        }}
      >
        <View style={{ width: '100%', maxWidth: isTablet ? 480 : 380, gap: isTablet ? 24 : 20 }}>
          <View style={{ alignItems: 'center', marginBottom: isTablet ? 16 : 8 }}>
            <XyneLogo width={isTablet ? 160 : 120} height={isTablet ? 53 : 40} />
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: cardBorder,
              borderRadius: 14,
              backgroundColor: cardBackground,
              padding: 20,
              gap: 14,
            }}
          >
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: isTablet ? 20 : 18, fontWeight: '600', color: primaryText }}>
                Join or create workspace
              </Text>
              <Text style={{ fontSize: 13, color: secondaryText, lineHeight: 20 }}>
                A collaborative space for your team and agents
              </Text>
            </View>
            <AuthButton
              label='Continue with work email'
              onPress={handleContinueWithWorkEmail}
              icon={<Mail size={18} color={primaryBtnText} />}
              disabled={isAuthLoading}
            />
          </View>

          <Divider label='Explore Public Communities' />

          {renderJoinRequestBanner()}

          {renderList()}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default CommunityScreen;
