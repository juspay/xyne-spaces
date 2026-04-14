import { useMemo, createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useZero } from './useZero.js';
import type { QueryResult, UseQueryOptions } from '@rocicorp/zero/react';
import type {
  QueryRequest,
  QueryResultDetails,
  QueryInternals,
  Schema,
  DefaultSchema,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { useZeroFallbackConfig } from './ZeroFallbackContext.js';

/**
 * Fallback query executor — injected by each app.
 * Calls the backend REST endpoint to execute a Zero query via HTTP.
 */
export type FallbackQueryExecutor = (name: string, args: unknown) => Promise<unknown>;

const FallbackExecutorContext = createContext<FallbackQueryExecutor | null>(null);
export const FallbackExecutorProvider = FallbackExecutorContext.Provider;

const useFallbackExecutor = (): FallbackQueryExecutor | null => {
  return useContext(FallbackExecutorContext);
};

export function useFallbackQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends Schema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const enabledOption = typeof options === 'object' ? options?.enabled : options;
  const enabled = enabledOption ?? true;
  const zero = useZero();
  const { pollIntervalMs } = useZeroFallbackConfig();
  const executeFallbackQuery = useFallbackExecutor();

  // If no executor is provided, disable the fallback query entirely
  const effectiveEnabled = enabled && executeFallbackQuery !== null;

  const singular = useMemo(() => {
    const queryInstance = query.query.fn({ ctx: zero.context as TContext, args: query.args });
    const internals = queryInstance as unknown as QueryInternals<TTable, TSchema, TReturn>;
    return internals.format?.singular ?? false;
  }, [query, zero.context]);
  const name = query.query.queryName;
  const args = query.args;

  const {
    data,
    isSuccess,
    isError,
    error,
    refetch: refetchFn,
  } = useQuery({
    queryKey: ['zero-fallback', name, args],
    queryFn: () => executeFallbackQuery!(name, args),
    enabled: effectiveEnabled,
    refetchInterval: pollIntervalMs,
    staleTime: pollIntervalMs - 1000,
    retry: 2,
  });

  const details = useMemo((): QueryResultDetails => {
    if (isError && error) {
      return {
        type: 'error',
        retry: () => void refetchFn(),
        refetch: () => void refetchFn(),
        error: {
          type: 'app',
          message: error.message ?? 'Unknown error',
        },
      };
    }
    if (isSuccess) {
      return { type: 'complete' };
    }
    return { type: 'unknown' };
  }, [isSuccess, isError, error, refetchFn]);

  const resultData = useMemo(() => {
    if (data === undefined || data === null) {
      return (singular ? undefined : []) as TReturn;
    }
    return data as TReturn;
  }, [data, singular]);

  return useMemo(
    () => [resultData, details] as unknown as QueryResult<TReturn>,
    [resultData, details],
  );
}
