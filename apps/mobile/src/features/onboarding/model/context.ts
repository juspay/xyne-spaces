/**
 * What the deck knows about the person before it asks them anything.
 *
 * Every field is derived from the sign-in exchange (`AuthExchangeResult`), so the deck never has
 * to call the backend to decide which cards to show.
 */

export interface ExistingCompany {
  /** The org that already owns this email domain, as the backend named it. */
  orgName: string;
  /** Workspaces inside it the user may request access to. Can be empty. */
  workspaces: readonly { id: string; name: string }[];
}

export interface OnboardingContext {
  email: string;
  /** Display name from the identity provider; `null` on the email sign-up path. */
  profileName: string | null;
  /**
   * Set when the backend reported a domain conflict at sign-in: someone at this company is
   * already on Xyne, so the user cannot create their own org.
   */
  existingCompany: ExistingCompany | null;
  /**
   * Set when the address is a personal domain (gmail.com and friends). Creating an org is refused
   * server-side, so the workspace card says so rather than failing on submit.
   */
  publicEmailDomainError: string | null;
  /**
   * An invite already placed this user in a workspace, so "Where do you want to start?" has no
   * question left to ask.
   *
   * Nothing sets this yet: an invited user signs in fully authenticated and is indistinguishable
   * from a returning one until the backend exposes an "onboarded" flag. The flow supports the
   * path so the card order is right the day that flag lands.
   */
  isInvited: boolean;
}

/**
 * The shape of `AuthContext`'s `pendingAuth` that this feature cares about.
 *
 * Declared structurally rather than imported: `PendingAuthState` is private to `AuthContext`, and
 * a structural input keeps the mapper below pure and testable without pulling the provider in.
 */
export interface SignInSnapshot {
  kind: string;
  profile: { email: string; name: string };
  userExistsButRemoved?: boolean;
  publicEmailDomainError?: string;
  enterpriseJoinTarget?: { orgName: string; workspaces: readonly { id: string; name: string }[] };
}

/**
 * The onboarding context for this sign-in, or `null` when the deck does not apply.
 *
 * The deck is for people the backend could not place: `org_creation_required` means they
 * authenticated but belong to no workspace at all, which is the only signal available today that
 * says "brand new". Anyone with a workspace — returning, invited, or picking between several — is
 * already home and goes straight into the app.
 *
 * `userExistsButRemoved` is excluded on purpose: that account was removed from its workspaces, so
 * the login screen's "No Workspace Access" message is the right answer, not a welcome.
 */
export function toOnboardingContext(pendingAuth: SignInSnapshot | null): OnboardingContext | null {
  if (!pendingAuth || pendingAuth.kind !== 'org_creation_required') {
    return null;
  }
  if (pendingAuth.userExistsButRemoved === true) {
    return null;
  }

  const target = pendingAuth.enterpriseJoinTarget;

  return {
    email: pendingAuth.profile.email,
    // Blank whenever no provider gave us one, which is what puts the name card in the deck.
    profileName: pendingAuth.profile.name.trim() || null,
    existingCompany: target ? { orgName: target.orgName, workspaces: target.workspaces } : null,
    publicEmailDomainError: pendingAuth.publicEmailDomainError ?? null,
    isInvited: false,
  };
}
