/**
 * Tool call interceptor chain — strategy pattern for tool call gates.
 *
 * Replaces hardcoded approval logic with a composable chain.
 * Interceptors run in order; first one returning 'deny' or 'pause' wins.
 */

/** A single interceptor in the chain. */
export interface ToolInterceptor {
  /** Return true if this interceptor applies to this tool call. */
  shouldIntercept(toolName: string, args: Record<string, unknown>): boolean;
  /** Handle the interception — return allow/deny/pause. */
  handle(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<'allow' | 'deny' | 'pause'>;
}

/**
 * Run interceptors in order. First one that returns 'deny' or 'pause' wins.
 * If all return 'allow' (or none intercept), the tool call proceeds.
 */
export async function runInterceptorChain(
  interceptors: readonly ToolInterceptor[],
  toolName: string,
  args: Record<string, unknown>,
): Promise<'allow' | 'deny' | 'pause'> {
  for (const interceptor of interceptors) {
    if (interceptor.shouldIntercept(toolName, args)) {
      const result = await interceptor.handle(toolName, args);
      if (result !== 'allow') return result;
    }
  }
  return 'allow';
}
