/**
 * The path engine: which cards a person sees, in what order, and where they land.
 *
 * Pure and self-contained — it is the single description of every scenario in the deck spec, and
 * the only place a new path should need editing. The dot count the deck renders is just
 * `buildFlow(...).length`, so the two can never disagree.
 */

import { CompanyChoice, isWorkspaceSkipped, StartChoice, type OnboardingAnswers } from './answers';
import type { OnboardingContext } from './context';

export const CardId = {
  START: 'start',
  NAME: 'name',
  ROLE: 'role',
  WORKSPACE_SETUP: 'workspace-setup',
  COMPANY_ON_XYNE: 'company-on-xyne',
  CONNECT_TOOLS: 'connect-tools',
} as const;
export type CardId = (typeof CardId)[keyof typeof CardId];

/**
 * The ordered deck for this person and the answers they have given so far.
 *
 * Recomputed on every answer, so picking "Join or create workspace" grows the deck by one card
 * and the dots grow with it.
 */
export function buildFlow(
  context: OnboardingContext,
  answers: OnboardingAnswers,
): readonly CardId[] {
  const cards: CardId[] = [];

  // An invite already answered "where do you want to start?".
  if (!context.isInvited) {
    cards.push(CardId.START);
  }

  // The provider gave us no name, so ask before anything addressed to them.
  if (context.profileName === null) {
    cards.push(CardId.NAME);
  }

  cards.push(CardId.ROLE);

  if (!context.isInvited && answers.start === StartChoice.WORKSPACE) {
    if (context.existingCompany) {
      cards.push(CardId.COMPANY_ON_XYNE);
      // "Request to join" ends the workspace branch; "create a new one" still needs naming.
      if (answers.company === CompanyChoice.CREATE_NEW) {
        cards.push(CardId.WORKSPACE_SETUP);
      }
    } else {
      cards.push(CardId.WORKSPACE_SETUP);
    }
  }

  cards.push(CardId.CONNECT_TOOLS);

  return cards;
}

/** Whether the deck's forward button should be live on this card. */
export function canAdvance(
  card: CardId,
  context: OnboardingContext,
  answers: OnboardingAnswers,
): boolean {
  switch (card) {
    case CardId.START:
      return answers.start !== undefined;
    case CardId.NAME:
      return (answers.name ?? '').trim().length > 0;
    case CardId.ROLE:
      return answers.role !== undefined;
    case CardId.COMPANY_ON_XYNE:
      return answers.company !== undefined;
    case CardId.WORKSPACE_SETUP:
      // Leaving it blank is the documented way to skip the workspace and land in the community.
      return context.publicEmailDomainError === null || isWorkspaceSkipped(answers);
    case CardId.CONNECT_TOOLS:
      return true;
  }
}

/**
 * What the app should do once the last card is done.
 *
 * `nothing` covers the invited user, who already has a workspace — the deck only collected
 * answers for them.
 */
export type OnboardingOutcome =
  | { kind: 'nothing' }
  | { kind: 'join-community' }
  | { kind: 'create-org'; orgName: string; workspaceName: string }
  | { kind: 'request-enterprise-join'; workspaceId: string; orgName: string }
  | { kind: 'create-enterprise-workspace'; workspaceName: string };

export function resolveOutcome(
  context: OnboardingContext,
  answers: OnboardingAnswers,
): OnboardingOutcome {
  if (context.isInvited) {
    return { kind: 'nothing' };
  }

  if (answers.start !== StartChoice.WORKSPACE) {
    return { kind: 'join-community' };
  }

  // Their domain already belongs to an org and they asked that org for access. Until an admin
  // accepts, the community is where they wait, which the card says out loud.
  if (context.existingCompany && answers.company === CompanyChoice.REQUEST_JOIN) {
    const target = context.existingCompany.workspaces[0];
    return target
      ? {
          kind: 'request-enterprise-join',
          workspaceId: target.id,
          orgName: context.existingCompany.orgName,
        }
      : { kind: 'join-community' };
  }

  // Picked a workspace, then left the setup blank.
  if (isWorkspaceSkipped(answers)) {
    return { kind: 'join-community' };
  }

  const workspaceName = (answers.workspaceName ?? '').trim();

  if (context.existingCompany) {
    return { kind: 'create-enterprise-workspace', workspaceName };
  }

  return {
    kind: 'create-org',
    orgName: (answers.companyName ?? '').trim() || workspaceName,
    workspaceName,
  };
}

/**
 * Whether the person has actually put something into this card.
 *
 * Distinct from `canAdvance`: the workspace card lets you move on having typed nothing (that is
 * the skip), but an untouched card is still where a resumed deck should reopen.
 */
export function isAnswered(card: CardId, answers: OnboardingAnswers): boolean {
  switch (card) {
    case CardId.START:
      return answers.start !== undefined;
    case CardId.NAME:
      return (answers.name ?? '').trim().length > 0;
    case CardId.ROLE:
      return answers.role !== undefined;
    case CardId.COMPANY_ON_XYNE:
      return answers.company !== undefined;
    case CardId.WORKSPACE_SETUP:
      return answers.workspaceName !== undefined;
    case CardId.CONNECT_TOOLS:
      return answers.connectedTools !== undefined;
  }
}

/** Where a resumed deck reopens: the first card they have not done, or the last one. */
export function firstIncompleteIndex(flow: readonly CardId[], answers: OnboardingAnswers): number {
  const index = flow.findIndex(card => !isAnswered(card, answers));
  return index === -1 ? Math.max(0, flow.length - 1) : index;
}
