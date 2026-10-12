/** Everything the deck collects. Serialisable on purpose — it is persisted between launches. */

export const StartChoice = {
  /** Join the public Xyne community space. */
  COMMUNITY: 'community',
  /** Join or create a private workspace. */
  WORKSPACE: 'workspace',
} as const;
export type StartChoice = (typeof StartChoice)[keyof typeof StartChoice];

export const CompanyChoice = {
  /** Ask an admin of the org that already owns this email domain for access. */
  REQUEST_JOIN: 'request-join',
  /** Start a separate workspace instead. */
  CREATE_NEW: 'create-new',
} as const;
export type CompanyChoice = (typeof CompanyChoice)[keyof typeof CompanyChoice];

/**
 * The dashboard's "Company size" choices, verbatim — it asks them of whoever creates an org, and
 * the backend stores the label as the answer, so these strings are the contract.
 */
export const COMPANY_SIZE_OPTIONS = ['0-10', '11-100', '100-1000', '1000+'] as const;
export type CompanySize = (typeof COMPANY_SIZE_OPTIONS)[number];

export interface OnboardingAnswers {
  start?: StartChoice;
  /** Collected only on the email sign-up path, where the provider gave us no name. */
  name?: string;
  /** Free text, as on the dashboard ("Ex: Product Manager"). Optional there, so optional here. */
  role?: string;
  /** Asked only of someone creating a new org — see `buildFlow`. */
  companySize?: CompanySize;
  company?: CompanyChoice;
  workspaceName?: string;
  companyName?: string;
  /** Mirrors the "Anyone with an @domain email can join" switch. */
  allowDomainJoin?: boolean;
  /** Ids from the connector catalogue. UI-only for now — nothing is authorised yet. */
  connectedTools?: readonly string[];
}

export const EMPTY_ANSWERS: OnboardingAnswers = {};

/** A workspace name of only whitespace means the user passed on setting one up. */
export function isWorkspaceSkipped(answers: OnboardingAnswers): boolean {
  return (answers.workspaceName ?? '').trim().length === 0;
}
