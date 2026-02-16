import { useQuery as useZeroQuery } from '@rocicorp/zero/react';
import type { QueryResult, UseQueryOptions } from '@rocicorp/zero/react';
import type {
  QueryRequest,
  Schema,
  DefaultSchema,
  DefaultContext,
  PullRow,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { useZeroFallbackConfig } from '../contexts/ZeroFallbackContext';
import { useFallbackQuery } from './useFallbackQuery';

export function useQueryWithFallback<
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
  const { fallbackEnabled } = useZeroFallbackConfig();

  const enabledOption = typeof options === 'object' ? options.enabled : options;
  const baseEnabled = enabledOption ?? true;

  const zeroResult = useZeroQuery(
    query,
    typeof options === 'object'
      ? { ...options, enabled: !fallbackEnabled && baseEnabled }
      : !fallbackEnabled && baseEnabled,
  );

  const fallbackResult = useFallbackQuery<TTable, TInput, TOutput, TSchema, TReturn, TContext>(
    query,
    typeof options === 'object'
      ? { ...options, enabled: fallbackEnabled && baseEnabled }
      : fallbackEnabled && baseEnabled,
  );

  return fallbackEnabled ? fallbackResult : zeroResult;
}
