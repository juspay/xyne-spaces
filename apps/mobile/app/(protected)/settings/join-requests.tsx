/**
 * Org admin review of workspace join requests.
 *
 * Port of the dashboard's `OrganisationsScreen/JoinRequestsSection.tsx`. Backed by
 * `GET /community/join-requests` and `POST /community/:workspaceId/join-requests/:id/review`; both
 * require an org OWNER/ADMIN, which is why the settings entry point is role-gated.
 */

import { ReactElement, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { useWorkspaces } from '@/src/hooks/useWorkspaces';
import { getValidAccessToken } from '@/src/services/authToken';
import {
  listOrgJoinRequests,
  reviewJoinRequest,
  WorkspaceJoinRequestAction,
  WorkspaceJoinRequestStatus,
  type WorkspaceJoinRequestItem,
} from '@/src/services/CommunityServices';
import { showMessageToast } from '@/src/utils/toast';

function formatRequestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const JoinRequestsScreen = (): ReactElement => {
  const router = useRouter();
  const { user } = useAuth();
  const { workspaces } = useWorkspaces();

  const background = useCSSVariable('--color-settings-bg') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const label = useCSSVariable('--color-settings-label') as string;
  const description = useCSSVariable('--color-settings-description') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const inputBackground = useCSSVariable('--color-auth-input-bg') as string;
  const inputBorder = useCSSVariable('--color-auth-input-border') as string;
  const inputText = useCSSVariable('--color-auth-input-text') as string;
  const placeholderText = useCSSVariable('--color-auth-placeholder') as string;
  const primaryBtnBg = useCSSVariable('--color-auth-primary-btn-bg') as string;
  const primaryBtnText = useCSSVariable('--color-auth-primary-btn-text') as string;
  const errorColor = useCSSVariable('--color-auth-error') as string;
  const successColor = useCSSVariable('--color-auth-success') as string;

  const orgId = useMemo(
    () => workspaces.find(workspace => workspace.id === user?.workspaceId)?.orgId ?? '',
    [user?.workspaceId, workspaces],
  );
  const workspaceId = user?.workspaceId ?? '';

  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const {
    data: requests,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['community', 'join-requests', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const token = await getValidAccessToken(300, workspaceId);
      if (!token) {
        throw new Error('Not authenticated');
      }
      return listOrgJoinRequests({ orgId, status: WorkspaceJoinRequestStatus.PENDING }, token);
    },
  });

  const handleReview = useCallback(
    async (
      request: WorkspaceJoinRequestItem,
      action: WorkspaceJoinRequestAction,
    ): Promise<void> => {
      const reviewNote = (reviewNotes[request.id] ?? '').trim();
      if (action === WorkspaceJoinRequestAction.REJECT && !reviewNote) {
        showMessageToast('Comment is required to reject a join request');
        return;
      }

      setReviewingId(request.id);
      try {
        const token = await getValidAccessToken(300, workspaceId);
        if (!token) {
          throw new Error('Not authenticated');
        }
        await reviewJoinRequest(
          {
            workspaceId: request.workspaceId,
            requestId: request.id,
            action,
            ...(reviewNote ? { reviewNote } : {}),
          },
          token,
        );
        showMessageToast(
          `${action === WorkspaceJoinRequestAction.APPROVE ? 'Approved' : 'Rejected'} ${request.email}`,
        );
        setReviewNotes(previous => {
          const next = { ...previous };
          delete next[request.id];
          return next;
        });
        await refetch();
      } catch (error: unknown) {
        showMessageToast(getErrorMessage(error, 'Failed to review join request'));
      } finally {
        setReviewingId(null);
      }
    },
    [refetch, reviewNotes, workspaceId],
  );

  const renderBody = (): ReactElement => {
    if (!orgId) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 13, color: description }}>Resolving organization...</Text>
        </View>
      );
    }

    if (isPending) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ fontSize: 13, color: description }}>Loading requests</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <Text style={{ fontSize: 13, color: errorColor, paddingVertical: 24, textAlign: 'center' }}>
          Failed to load join requests.
        </Text>
      );
    }

    if (!requests || requests.length === 0) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={28} color={successColor} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: label }}>
            No pending join requests
          </Text>
          <Text style={{ fontSize: 13, color: description, textAlign: 'center' }}>
            New workspace access requests will appear here.
          </Text>
        </View>
      );
    }

    return (
      <View style={{ borderRadius: 16, backgroundColor: sectionBg, overflow: 'hidden' }}>
        {requests.map((request, index) => {
          const note = reviewNotes[request.id] ?? '';
          const isBusy = reviewingId === request.id;
          return (
            <View
              key={request.id}
              style={{
                padding: 14,
                gap: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: divider,
              }}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: label }}>
                  {request.email}
                </Text>
                <Text style={{ fontSize: 12, color: description }}>
                  {`${request.workspaceName ?? 'Workspace'} • Requested ${formatRequestedAt(request.createdAt)}`}
                </Text>
              </View>

              <TextInput
                value={note}
                onChangeText={value =>
                  setReviewNotes(previous => ({ ...previous, [request.id]: value }))
                }
                placeholder='Add a comment (required to reject)'
                placeholderTextColor={placeholderText}
                editable={!isBusy}
                style={{
                  borderWidth: 1,
                  borderColor: inputBorder,
                  borderRadius: 10,
                  minHeight: 44,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  fontSize: 14,
                  color: inputText,
                  backgroundColor: inputBackground,
                }}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => {
                    void handleReview(request, WorkspaceJoinRequestAction.REJECT);
                  }}
                  disabled={isBusy || !note.trim()}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 42,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: inputBorder,
                    opacity: isBusy || !note.trim() ? 0.5 : 1,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: errorColor }}>Reject</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    void handleReview(request, WorkspaceJoinRequestAction.APPROVE);
                  }}
                  disabled={isBusy}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 42,
                    borderRadius: 10,
                    backgroundColor: primaryBtnBg,
                    opacity: isBusy ? 0.6 : 1,
                  }}
                >
                  {isBusy ? (
                    <ActivityIndicator color={primaryBtnText} />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '600', color: primaryBtnText }}>
                      Approve
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: background } }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole='button'
          accessibilityLabel='Back'
          hitSlop={10}
          style={{ padding: 8 }}
        >
          <ChevronLeft size={28} color={label} strokeWidth={2.5} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isPending}
            onRefresh={() => {
              void refetch();
            }}
          />
        }
      >
        <View style={{ gap: 4, paddingTop: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: label, letterSpacing: 0.2 }}>
            Workspace Join Requests
          </Text>
          <Text style={{ fontSize: 13, color: description, lineHeight: 20 }}>
            Organization admins approve access to request-based workspaces.
          </Text>
        </View>

        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

export default JoinRequestsScreen;
