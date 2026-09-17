/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IvmHost } from './ivmHost.js';

/**
 * Feed the sync host each mutation's SERVER-confirmed result, so optimistic overlays retire on real
 * server confirmation — NOT on Zero's `lastMutationID()`, which is the OPTIMISTIC local counter (it
 * advances the instant the client applies a mutation, before any round-trip; verified in @rocicorp/zero
 * — Replicache `this.lastMutationID = dbWrite.getMutationID()` inside the local mutator apply). Using
 * that retired overlays before the server confirmed them → own writes flickered out.
 *
 * Zero's `MutationTracker` already correlates ephemeralID → mutationID → serverPromise internally (it is
 * how `.server` resolves). There is no PUBLIC accessor for the confirmed watermark, so `runtime.ts`
 * deep-imports the compiled internal (the same mechanism ivmHost uses for `#zql/*`) and passes its
 * prototype here. We wrap its two PUBLIC methods:
 *   - `trackMutation()` → `{ ephemeralID, serverPromise }`  (serverPromise resolves ONLY once zero-cache
 *      has processed the mutation — success OR application error);
 *   - `mutationIDAssigned(ephemeralID, mutationID)`          (the id for that ephemeralID).
 * Pairing them yields the exact `(mutationID, serverResult)` with no correlation guessing, no ordering
 * assumptions, and no reliance on `mr.mutator.fn` (which `zero.mutate(mr)` never invokes — it dispatches
 * the registered mutator by name). The wraps only READ the tracker's outputs (call the originals, add a
 * `.then` on the returned promise); they never alter Zero's behavior, and every step is try/caught so a
 * shape change in a future Zero can only DEGRADE to fan-out-echo-only retirement, never break a mutation.
 *
 * Kept free of the deep import (only a `type` import) so the correlation logic is unit-testable in a
 * plain runner; `installConfirmedMutationHook` in runtime.ts supplies the real prototype.
 */

/** Marker so a prototype is wrapped at most once even if init runs more than once. */
const PATCHED = Symbol.for('xyne.sync.mutationTrackerPatched');

export function hookMutationTrackerPrototype(proto: any, host: IvmHost): void {
  if (!proto || proto[PATCHED] || typeof proto.trackMutation !== 'function' || typeof proto.mutationIDAssigned !== 'function') {
    return; // absent / already patched / internal shape changed — fail safe (echo-only retirement)
  }
  proto[PATCHED] = true;

  // Per-tracker (WeakMap keyed by the tracker instance ⇒ multiple Zero clients stay isolated):
  // ephemeralID → the mutation's serverPromise, captured at trackMutation, consumed at id-assignment.
  const pending = new WeakMap<object, Map<unknown, Promise<any>>>();

  const origTrack = proto.trackMutation as (...a: any[]) => any;
  proto.trackMutation = function (this: any, ...args: any[]) {
    const res = origTrack.apply(this, args);
    try {
      if (res && res.serverPromise && res.ephemeralID !== undefined) {
        let m = pending.get(this);
        if (!m) pending.set(this, (m = new Map()));
        m.set(res.ephemeralID, res.serverPromise);
      }
    } catch {
      /* never break the mutation */
    }
    return res;
  };

  const origAssign = proto.mutationIDAssigned as (...a: any[]) => any;
  proto.mutationIDAssigned = function (this: any, ephemeralID: unknown, mutationID: number) {
    const r = origAssign.call(this, ephemeralID, mutationID);
    try {
      const m = pending.get(this);
      const serverPromise = m?.get(ephemeralID);
      if (serverPromise && typeof mutationID === 'number') {
        m!.delete(ephemeralID);
        serverPromise.then(
          (details: any) => host.noteMutationSettled(mutationID, details?.type !== 'error'),
          () => host.noteMutationSettled(mutationID, false),
        );
      }
    } catch {
      /* never break the mutation */
    }
    return r;
  };
}
