import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useZero } from './useZero';
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
import { executeFallbackQuery } from '../services/zeroFallbackClient';
import { useZeroFallbackConfig } from '../contexts/ZeroFallbackContext';

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
    queryFn: () => executeFallbackQuery(name, args),
    enabled,
    refetchInterval: pollIntervalMs,
    staleTime: pollIntervalMs - 1000,
    retry: 2,
  });

  // Memoize the details object to prevent infinite re-renders
  // Use Zero's QueryResultDetails format: { type: 'complete' | 'unknown' | 'error' }
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

  // Return appropriate value based on singular flag (matches Zero behavior):
  // - singular (.one()): the value or undefined (null from queryFn → undefined)
  // - plural: the array or empty []
  const resultData = useMemo(() => {
    if (data === undefined || data === null) {
      return (singular ? undefined : []) as TReturn;
    }
    return data as TReturn;
  }, [data, singular]);

  // Memoize the return tuple to maintain stable reference
  return useMemo(
    () => [resultData, details] as unknown as QueryResult<TReturn>,
    [resultData, details],
  );
}
