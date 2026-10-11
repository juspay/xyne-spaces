export { OnboardingScreen } from './screens/onboarding-screen';
export { toOnboardingContext } from './model/context';
export type { OnboardingContext, SignInSnapshot } from './model/context';
export { buildFlow, canAdvance, resolveOutcome, firstIncompleteIndex, CardId } from './model/flow';
export type { OnboardingOutcome } from './model/flow';
export { StartChoice, CompanyChoice, ROLE_OPTIONS } from './model/answers';
export type { OnboardingAnswers, RoleId } from './model/answers';
export { CONNECTOR_TOOLS } from './model/tools';
export { deckPalette } from './theme';
