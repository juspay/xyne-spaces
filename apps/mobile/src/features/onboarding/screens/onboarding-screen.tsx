import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, type ReactElement } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  flattenCommunityWorkspaces,
  listCommunityWorkspaces,
} from '@/src/services/CommunityServices';

import { CardDeck } from '../components/card-deck';
import { DeckDots } from '../components/deck-dots';
import { DeckFooter } from '../components/deck-footer';
import { RequestSentScreen } from '../components/request-sent-screen';
import { WelcomeScreen } from '../components/welcome-screen';
import { CompanyOnXyneCard } from '../components/cards/company-on-xyne-card';
import { CompanySizeCard } from '../components/cards/company-size-card';
import { ConnectToolsCard } from '../components/cards/connect-tools-card';
import { NameCard } from '../components/cards/name-card';
import { RoleCard } from '../components/cards/role-card';
import { StartCard } from '../components/cards/start-card';
import { WorkspaceSetupCard } from '../components/cards/workspace-setup-card';
import { useOnboardingCommit } from '../hooks/use-onboarding-commit';
import { useOnboardingDeck } from '../hooks/use-onboarding-deck';
import { CardId } from '../model/flow';
import type { OnboardingContext } from '../model/context';
import { deckMetrics, deckPalette } from '../theme';

const COMMUNITY_WORKSPACES_QUERY_KEY = ['community', 'workspaces'] as const;

function emailDomainOf(email: string): string {
  return email.split('@')[1] ?? 'your company';
}

/**
 * The onboarding deck.
 *
 * Presentational apart from one thing: finishing the last card commits the answers through
 * `AuthContext`, which creates the session. The root navigator watches that session, so the screen
 * does not navigate anywhere itself — it simply stops existing once the user is signed in.
 *
 * The exception is asking an existing company workspace for access. That ends without a session,
 * so the root never swaps and this screen is the only thing that can say what happened — it
 * renders the waiting state itself and leaves for sign-in on request.
 *
 * The other exception is the caller that is already signed in and only has questions left
 * (`ApprovedOnboardingGate`): it passes `onComplete`, since there is no session to appear.
 */
export function OnboardingScreen({
  context,
  onComplete,
}: {
  context: OnboardingContext;
  onComplete?: () => void;
}): ReactElement {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const deck = useOnboardingDeck(context);
  const { commit, isCommitting, error, clearError, submittedRequest, leaveRequest } =
    useOnboardingCommit(context, onComplete);

  // Also what the start card names, so the row shows the real community rather than a placeholder.
  // An invited person never sees that card, so there is nothing to look up for them.
  const { data: organizations } = useQuery({
    queryKey: COMMUNITY_WORKSPACES_QUERY_KEY,
    queryFn: listCommunityWorkspaces,
    enabled: !context.isInvited,
  });

  const community = useMemo(() => {
    const first = flattenCommunityWorkspaces(organizations ?? [])[0];
    return first ?? null;
  }, [organizations]);

  useEffect(() => {
    if (error === null) {
      return;
    }
    Alert.alert('Could not finish setting up', error, [{ text: 'OK', onPress: clearError }]);
  }, [clearError, error]);

  const handleNext = useCallback((): void => {
    if (!deck.isLastCard) {
      deck.next();
      return;
    }
    void commit(deck.outcome, deck.answers, community?.id ?? null);
  }, [commit, community?.id, deck]);

  // Before the welcome check: a submitted request replaces the deck outright. There is no session
  // to land in, so nothing else would tell the person what just happened.
  if (submittedRequest !== null) {
    return <RequestSentScreen request={submittedRequest} onDone={leaveRequest} />;
  }

  if (deck.showWelcome) {
    return <WelcomeScreen name={context.profileName} onDone={deck.dismissWelcome} />;
  }

  const topSpace = Math.max(insets.top + 12, height * deckMetrics.cardTopRatio);
  const cardHeight = height * deckMetrics.cardHeightRatio;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle='light-content' />

      {/* Both of these give way to the keyboard before the footer does, so the forward button
          stays reachable on the cards that take typing. */}
      <View style={[styles.yielding, { height: topSpace, minHeight: insets.top + 8 }]} />

      <CardDeck cardKey={deck.card} direction={deck.direction} height={cardHeight}>
        {renderCard(deck, context, community)}
      </CardDeck>

      <View style={styles.dots}>
        <DeckDots count={deck.flow.length} index={deck.index} />
      </View>

      <View style={styles.spacer} />

      <DeckFooter
        onBack={deck.back}
        onNext={handleNext}
        canGoBack={deck.canGoBack}
        canGoNext={deck.canGoNext}
        isBusy={isCommitting}
        nextLabel={deck.isLastCard ? 'Finish' : 'Next'}
      />

      <View style={{ height: insets.bottom + 20 }} />
    </KeyboardAvoidingView>
  );
}

function renderCard(
  deck: ReturnType<typeof useOnboardingDeck>,
  context: OnboardingContext,
  community: { name: string; description?: string | null } | null,
): ReactElement {
  const { answers, answer } = deck;

  switch (deck.card) {
    case CardId.START:
      return (
        <StartCard
          value={answers.start}
          onChange={start => answer({ start })}
          community={
            community ? { name: community.name, description: community.description ?? null } : null
          }
          publicEmailDomainError={context.publicEmailDomainError}
        />
      );

    case CardId.NAME:
      return <NameCard value={answers.name} onChange={name => answer({ name })} />;

    case CardId.ROLE:
      return <RoleCard value={answers.role} onChange={role => answer({ role })} />;

    case CardId.COMPANY_SIZE:
      return (
        <CompanySizeCard
          value={answers.companySize}
          onChange={companySize => answer({ companySize })}
        />
      );

    case CardId.COMPANY_ON_XYNE:
      return (
        <CompanyOnXyneCard
          orgName={context.existingCompany?.orgName ?? 'Your company'}
          value={answers.company}
          onChange={company => answer({ company })}
        />
      );

    case CardId.WORKSPACE_SETUP:
      return (
        <WorkspaceSetupCard
          workspaceName={answers.workspaceName}
          companyName={answers.companyName}
          allowDomainJoin={answers.allowDomainJoin ?? true}
          onChange={answer}
          emailDomain={emailDomainOf(context.email)}
          publicEmailDomainError={context.publicEmailDomainError}
        />
      );

    case CardId.CONNECT_TOOLS:
      return (
        <ConnectToolsCard
          connected={answers.connectedTools ?? []}
          onToggle={toolId => {
            const current = answers.connectedTools ?? [];
            answer({
              connectedTools: current.includes(toolId)
                ? current.filter(id => id !== toolId)
                : [...current, toolId],
            });
          }}
        />
      );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: deckPalette.background,
  },
  yielding: {
    flexShrink: 1,
  },
  dots: {
    marginTop: 36,
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
});
