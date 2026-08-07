import { toast } from 'sonner';

/**
 * The shape `zero.mutate(...)` returns. Zero applies the mutation optimistically
 * and RESOLVES `.server` with the authoritative result — it does NOT reject for
 * application errors, which arrive as `{ type: 'error', error: { message } }`.
 */
type ZeroMutationResult = {
  server: Promise<{ type?: string; error?: { message?: string } } | undefined>;
};

/**
 * Awaits a Zero mutator's server result and surfaces the REAL error as a toast.
 *
 * A bare `void zero.mutate(...)` drops the server result, so a server-side
 * rejection (permission, board constraint, terminal-status guard, "not
 * found"…) silently rolls back the optimistic write and the user sees nothing.
 * Routing the mutation through this helper turns that silent rollback into the
 * actual server message instead of a generic/absent one.
 *
 * Returns `true` when the mutation succeeded and `false` otherwise, so callers
 * that need a success side effect (success toast, navigation) can gate on it.
 */
export async function surfaceMutationError(
  mutation: ZeroMutationResult,
  fallback = 'Something went wrong. Please try again.',
): Promise<boolean> {
  try {
    const result = await mutation.server;
    if (result?.type === 'error') {
      toast.error(result.error?.message || fallback);
      return false;
    }
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : fallback);
    return false;
  }
}
