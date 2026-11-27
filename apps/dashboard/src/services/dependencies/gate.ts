export interface DependencyOverride {
  reason: string;
  adminOverride?: boolean;
}
export interface DependencyGateRefusal {
  softCount: number;
  hardCount: number;
  canAdminOverride: boolean;
}
export interface DependencyMutationResult {
  type?: string;
  error?: { message?: string; details?: unknown };
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Copy only the counts and live eligibility. Never retain endpoint IDs or error payloads. */
export function dependencyGateRefusal(
  result: DependencyMutationResult | undefined,
): DependencyGateRefusal | null {
  if (result?.type !== 'error') return null;
  const details = record(result.error?.details);
  if (
    !details ||
    !['DEPENDENCY_REASON_REQUIRED', 'DEPENDENCY_HARD_GATE'].includes(String(details['code']))
  )
    return null;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const hardCount = count(details['hardCount']);
  return {
    softCount: count(details['softCount']),
    hardCount: details['code'] === 'DEPENDENCY_HARD_GATE' ? Math.max(1, hardCount) : hardCount,
    canAdminOverride: details['canAdminOverride'] === true,
  };
}
export function validDependencyConsent(
  gate: DependencyGateRefusal,
  override: DependencyOverride,
): boolean {
  return (
    !!override.reason.trim() &&
    override.reason.trim().length <= 2000 &&
    (!gate.hardCount || (gate.canAdminOverride && override.adminOverride === true))
  );
}
export const cancelledDependencyMove = () => ({
  type: 'error' as const,
  error: { message: 'Stage move cancelled', details: { code: 'DEPENDENCY_CANCELLED' } },
});

/** One server-authoritative retry. Cancellation never fabricates a successful move. */
export async function runDependencyMutation<T extends DependencyMutationResult | undefined>(
  execute: (override?: DependencyOverride) => Promise<T>,
  consent: (gate: DependencyGateRefusal) => Promise<DependencyOverride | null>,
  signal: AbortSignal,
  onRefused?: () => void,
  isCurrent: () => boolean = () => true,
): Promise<T | ReturnType<typeof cancelledDependencyMove>> {
  if (signal.aborted || !isCurrent()) return cancelledDependencyMove();
  const first = await execute();
  if (signal.aborted || !isCurrent()) return cancelledDependencyMove();
  const gate = dependencyGateRefusal(first);
  if (!gate) return first;
  onRefused?.(); // Roll back local DnD state before asking, not after the dialog closes.
  const override = await consent(gate);
  if (signal.aborted || !isCurrent() || !override || !validDependencyConsent(gate, override))
    return cancelledDependencyMove();
  const retried = await execute({
    reason: override.reason.trim(),
    ...(gate.hardCount ? { adminOverride: true } : {}),
  });
  if (signal.aborted || !isCurrent()) return cancelledDependencyMove();
  if (retried?.type === 'error') onRefused?.();
  return retried;
}

export interface DependencyConsentRequest {
  token: number;
  scope: string;
  gate: DependencyGateRefusal;
}
export class DependencyConsentController {
  private request: DependencyConsentRequest | null = null;
  private complete: ((override: DependencyOverride | null) => void) | null = null;
  private sequence = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.request;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  ask(
    scope: string,
    gate: DependencyGateRefusal,
    signal: AbortSignal,
  ): Promise<DependencyOverride | null> {
    this.cancel();
    if (signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const token = ++this.sequence;
      const abort = () => this.finish(token, null);
      this.complete = override => {
        signal.removeEventListener('abort', abort);
        resolve(override);
      };
      this.request = { token, scope, gate };
      signal.addEventListener('abort', abort, { once: true });
      this.listeners.forEach(listener => listener());
    });
  }
  finish(token: number, override: DependencyOverride | null): void {
    if (this.request?.token !== token) return;
    if (override && !validDependencyConsent(this.request.gate, override)) return;
    const complete = this.complete;
    this.request = null;
    this.complete = null;
    complete?.(override);
    this.listeners.forEach(listener => listener());
  }
  cancel(): void {
    if (this.request) this.finish(this.request.token, null);
  }
}
export const dependencyConsent = new DependencyConsentController();

export function isCancelledDependencyMove(result: DependencyMutationResult | undefined): boolean {
  return (
    result?.type === 'error' && record(result.error?.details)?.['code'] === 'DEPENDENCY_CANCELLED'
  );
}
