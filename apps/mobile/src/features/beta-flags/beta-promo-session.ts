/**
 * "Already decided this launch", held at module level on purpose.
 *
 * The gate lives inside `NativeShell`, which remounts on every workspace switch
 * and every Beta-screen toggle (`applyFlagChanges` bumps its key). React state
 * would reset on each of those and offer the sheet again seconds after the user
 * acted on it. A module variable lives exactly as long as the JS process, which
 * is what "once per cold start" means.
 *
 * Keyed by user so a different account signing in within the same process still
 * gets its own decision.
 */
let decidedForUserId: string | null = null;

export function hasDecidedBetaPromo(userId: string): boolean {
  return decidedForUserId === userId;
}

export function markBetaPromoDecided(userId: string): void {
  decidedForUserId = userId;
}

/** Tests only. */
export function resetBetaPromoSessionForTest(): void {
  decidedForUserId = null;
}
