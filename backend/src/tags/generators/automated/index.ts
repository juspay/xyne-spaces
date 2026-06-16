import { runInNewContext } from 'node:vm';
import { logger } from '@/utils/logger';
import type { CategoryConfig, GeneratedTag, TagsConfigShape } from '../../types.js';
import { validateGeneratedTags } from '../validate.js';
import { AutomatedScriptOutputSchema, type AutomatedScriptOutput } from './schema.js';

const DEFAULT_MOCK_CONTEXT =
  'Subject: sample merchant ticket\n\nMerchant reports an urgent issue with eNACH mandate registration via BillDesk. A refund is pending and the HyperSDK integration is affected.';

type ScriptErrorCode =
  | 'SCRIPT_SYNTAX_ERROR'
  | 'SCRIPT_RUNTIME_ERROR'
  | 'SCRIPT_TIMEOUT'
  | 'SCRIPT_INVALID_OUTPUT';

interface ScriptExecuteOptions {
  config?: unknown;
  timeoutMs?: number;
}

class ScriptExecutionError extends Error {
  constructor(
    public readonly code: ScriptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScriptExecutionError';
  }
}

export class ConfigScriptError extends Error {
  constructor(
    public readonly category: string,
    public readonly code: ScriptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigScriptError';
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

function assertParseable(script: string): void {
  try {
    new Function(`return (${script})`);
  } catch (err) {
    throw new ScriptExecutionError(
      'SCRIPT_SYNTAX_ERROR',
      err instanceof Error ? err.message : 'Script is not valid JavaScript',
    );
  }
}

function classifyRuntimeError(err: unknown): ScriptExecutionError {
  const message = err instanceof Error ? err.message : String(err);
  const isTimeout =
    (err as NodeJS.ErrnoException)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
    /timed? ?out/i.test(message);

  if (isTimeout) {
    logger.warn('[TAG][AUTOMATED] Script timed out', { message });
    return new ScriptExecutionError('SCRIPT_TIMEOUT', 'Script exceeded its execution time limit');
  }

  return new ScriptExecutionError('SCRIPT_RUNTIME_ERROR', message);
}

function executeScript(
  script: string,
  context: unknown,
  options: ScriptExecuteOptions = {},
): AutomatedScriptOutput {
  const { config, timeoutMs = 1_000 } = options;

  assertParseable(script);

  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.context = deepFreeze(structuredClone(context));
  sandbox.config = deepFreeze(structuredClone(config ?? {}));
  sandbox.__result = undefined;

  try {
    runInNewContext(`__result = (${script})(context, config)`, sandbox, {
      timeout: timeoutMs,
      microtaskMode: 'afterEvaluate',
    });
  } catch (err) {
    throw classifyRuntimeError(err);
  }

  const parsed = AutomatedScriptOutputSchema.safeParse(sandbox.__result);
  if (!parsed.success) {
    throw new ScriptExecutionError(
      'SCRIPT_INVALID_OUTPUT',
      `Script must return an array of { category, tag, reason? } objects: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }

  return parsed.data;
}

export function assertConfigScriptsValid(
  config: TagsConfigShape,
  mockContext: string = DEFAULT_MOCK_CONTEXT,
): void {
  for (const [name, categoryConfig] of Object.entries(config.categories ?? {})) {
    if (categoryConfig.method !== 'automated') continue;

    const script = categoryConfig.script;
    if (typeof script !== 'string' || script.trim().length === 0) continue;

    try {
      executeScript(script, mockContext, {
        config: categoryConfig,
        timeoutMs: categoryConfig.script_timeout_ms,
      });
    } catch (err) {
      if (err instanceof ScriptExecutionError) {
        throw new ConfigScriptError(
          name,
          err.code,
          `Invalid script for category "${name}" (${err.code}): ${err.message}`,
        );
      }
      throw err;
    }
  }
}

export async function generateAutomatedTags(
  context: string,
  categories: Record<string, CategoryConfig>,
): Promise<GeneratedTag[]> {
  const raw: GeneratedTag[] = [];

  for (const [category, categoryConfig] of Object.entries(categories)) {
    const script = categoryConfig.script;
    if (typeof script !== 'string' || script.trim().length === 0) {
      continue;
    }

    try {
      const output = executeScript(script, context, {
        config: categoryConfig,
        timeoutMs: categoryConfig.script_timeout_ms,
      });
      raw.push(...output);
    } catch (err) {
      if (err instanceof ScriptExecutionError) {
        logger.error(`[TAG][AUTOMATED] Script for category "${category}" failed (${err.code}): ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  return validateGeneratedTags(raw, categories);
}
