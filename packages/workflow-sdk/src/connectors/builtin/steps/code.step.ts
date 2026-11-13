/**
 * CODE step — sandboxed JavaScript execution.
 *
 * Runs user-provided JS in the host-configured code-execution sandbox — the same
 * isolated E2B / Docker backend the `run_code` agent tool uses — NOT in the
 * workflow process. `node:vm` is not a security boundary (a constructor-chain
 * escape reaches the host runtime and thus OS-level access), so this step
 * requires a real sandbox and FAILS CLOSED when none is configured rather than
 * falling back to in-process evaluation.
 *
 * The code receives:
 * - `$input` — the previous step's output (or {} if first step)
 * - `$context` — read-only snapshot of the workflow context
 *
 * Must return a JSON-serializable value.
 */

import { Readable } from 'node:stream';
import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { bindSandboxSession } from '../../../sandbox/types.js';
import { ATTACHMENT_ARRAY_JSON_SCHEMA, AttachmentSchema, markAttachmentFields } from '../../../common/attachment.js';
import type { Attachment } from '../../../common/attachment.js';
import { variableRef } from '../../../types/workflow-config.js';
import type { StorageScope } from '../../../storage/types.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';

// ─── Config ───

const OutputFieldSchema = z.object({
  name: z.string().min(1).describe('Field name in the returned object'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).describe('Data type of this field'),
});

export const CodeStepConfigSchema = z.object({
  code: z.string().min(1).describe('JavaScript code to execute. Must return a value. Has access to $input (previous step output) and $context (workflow context)'),
  timeoutMs: z.number().int().positive().default(5000).describe('Maximum execution time in milliseconds'),
  outputFields: z.array(OutputFieldSchema).optional().describe('Declared output fields — describes the shape of the return value for downstream steps'),
  attachments: variableRef(
    z.array(AttachmentSchema).describe('Documents mounted into the sandbox at /mnt/files, readable from code via $files. Bind to a ref, e.g. {{trigger.contract}}'),
  ).optional(),
  collectOutputFiles: z.boolean().default(false)
    .describe('Store files written to /mnt/output as workflow documents, exposed as `files`'),
});

export type CodeStepConfig = z.infer<typeof CodeStepConfigSchema>;

// ─── Output ───

export interface CodeStepOutput extends Record<string, unknown> {
  result: unknown;
  files?: Attachment[];
}

const CodeStepOutputSchema = z.object({
  result: z.unknown(),
});

// ─── Mounting bound documents ───
const MOUNT_DIR = '/mnt/files';

/** How large a document may be to mount into a sandbox, which takes bytes. */
const MAX_MOUNT_BYTES = 8 * 1024 * 1024;
interface Mount {
  attachment: Attachment;
  name: string;
  path: string;
}

interface FileDescriptor extends Record<string, unknown> {
  name: string;
  mimeType: string;
  path: string;
}

function planMounts(attachments: readonly Attachment[]): Mount[] {
  return attachments.map((attachment) => ({
    attachment,
    name: attachment.name,
    path: `${MOUNT_DIR}/${attachment.name}`,
  }));
}

function describeMount(m: Mount): FileDescriptor {
  return {
    name: m.name,
    mimeType: m.attachment.mimeType,
    path: m.path,
    ...(m.attachment.size !== undefined ? { size: m.attachment.size } : {}),
  };
}

// Sentinel delimiting the JSON return value on stdout. The program appends it
// last, after any user console output, so `lastIndexOf` recovers the result
// even if the user logged text that resembles the marker.
const RESULT_MARKER = '__XYNE_CODE_RESULT__';

// Wrap the user code into a self-contained Node (CommonJS) program that injects
// $input/$context, runs the code, and prints the JSON result after the marker.
// $input/$context are embedded via JSON.parse of a JSON-encoded string so no
// input value can break out into code. User code is written to a file (never a
// shell argument), so it needs no escaping.
function buildProgram(
  code: string,
  $input: unknown,
  $context: unknown,
  timeoutMs: number,
  $files: readonly FileDescriptor[],
): string {
  const inputLit = JSON.stringify(JSON.stringify($input));
  const contextLit = JSON.stringify(JSON.stringify($context));
  const filesLit = JSON.stringify(JSON.stringify($files));
  return [
    `const $input = JSON.parse(${inputLit});`,
    `const $context = JSON.parse(${contextLit});`,
    `const $files = JSON.parse(${filesLit});`,
    `const __timer = setTimeout(() => { process.stderr.write("Code step timed out after ${timeoutMs}ms"); process.exit(1); }, ${timeoutMs});`,
    `if (__timer.unref) __timer.unref();`,
    `Promise.resolve().then(async () => {`,
    code,
    `}).then((r) => {`,
    `  clearTimeout(__timer);`,
    `  let out;`,
    `  try { out = JSON.stringify(r === undefined ? null : r); }`,
    `  catch (_e) { process.stderr.write("Return value is not JSON-serializable"); process.exit(1); return; }`,
    `  process.stdout.write("\\n${RESULT_MARKER}" + out);`,
    `}, (e) => {`,
    `  clearTimeout(__timer);`,
    `  process.stderr.write(String(e && e.stack ? e.stack : e));`,
    `  process.exit(1);`,
    `});`,
  ].join('\n');
}

// ─── Step ───

export class CodeStep extends BaseActionStep<
  typeof CodeStepConfigSchema,
  CodeStepOutput
> {
  override readonly type = BuiltinStepType.CODE;
  override readonly name = 'Code';
  override readonly description = 'Execute sandboxed JavaScript code';
  override readonly configSchema = CodeStepConfigSchema;
  override readonly outputSchema = CodeStepOutputSchema;
  override readonly category: StepCategory = 'data';
  override readonly icon = 'code';

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['code']) {
      props['code'] = { ...props['code'], format: 'code' };
    }
    if (props?.['outputFields']) {
      props['outputFields'] = { ...props['outputFields'], format: 'output-fields' };
    }
    markAttachmentFields(jsonSchema, ['attachments']);
    return jsonSchema;
  }

  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const fileProps = config['collectOutputFiles']
      ? { files: ATTACHMENT_ARRAY_JSON_SCHEMA }
      : {};
    const fields = config['outputFields'] as Array<{ name: string; type: string }> | undefined;
    if (!fields || fields.length === 0) {
      return { type: 'object', properties: { result: {}, ...fileProps } };
    }
    const resultProps: Record<string, Record<string, unknown>> = {};
    for (const f of fields) {
      resultProps[f.name] = { type: f.type };
    }
    return {
      type: 'object',
      properties: {
        result: { type: 'object', properties: resultProps },
        ...fileProps,
      },
    };
  }

  override async execute(
    config: CodeStepConfig,
    ctx: StepExecutionContext,
  ): Promise<CodeStepOutput> {
    // Build $input from the most recent step output
    const stepEntries = Object.values(ctx.workflow.steps);
    const lastStep = stepEntries[stepEntries.length - 1];
    const $input: Record<string, unknown> = lastStep?.output ?? {};

    // Build read-only context snapshot
    const $context = {
      trigger: ctx.workflow.trigger,
      steps: Object.fromEntries(
        Object.entries(ctx.workflow.steps).map(([k, v]) => [k, { ...v }]),
      ),
    };

    // Fail closed: JS runs only inside the isolated sandbox, never in-process.
    if (!ctx.sandbox) {
      throw new Error(
        'Code step execution failed: no code-execution sandbox is configured. '
        + 'The CODE step runs JavaScript in an isolated sandbox and does not fall '
        + 'back to in-process execution. Configure a sandbox backend (e.g. '
        + 'SANDBOX_BACKEND / E2B_API_KEY) to enable CODE steps.',
      );
    }

    const scriptPath = `/tmp/xyne-code-${ctx.runtime.executionId}-${ctx.runtime.stepId}.cjs`;
    const scope: StorageScope = ctx.runtime.attributes;

    const bound = Array.isArray(config.attachments) ? config.attachments : [];
    const mounts = planMounts(bound);
    if (mounts.length > 0 && !ctx.files.available) {
      throw new Error(
        'Code step execution failed: documents are bound to this step but no '
        + 'StorageAdapter is configured, so their bytes cannot be read. '
        + 'Configure a storage backend to mount documents into the sandbox.',
      );
    }

    const handle = await ctx.sandbox.create(scope ? { scope } : {});
    try {
      const session = bindSandboxSession(ctx.sandbox, handle);
      if (mounts.length > 0) {
        await session.writeFiles(
          await Promise.all(
            mounts.map(async (m) => ({
              path: m.path,
              // A sandbox takes bytes, not a stream, so this is one of the few
              // places a file is materialised — capped, and loud when it is
              // too big, rather than quietly exhausting the heap.
              bytes: await ctx.files.buffer(m.attachment, { maxBytes: MAX_MOUNT_BYTES }),
            })),
          ),
        );
        ctx.log.info(
          `mounted ${String(mounts.length)} document(s) at ${MOUNT_DIR}: ${mounts.map((m) => m.name).join(', ')}`,
        );
      }

      const program = buildProgram(
        config.code,
        $input,
        $context,
        config.timeoutMs,
        mounts.map(describeMount),
      );
      await session.writeFiles([
        { path: scriptPath, bytes: new TextEncoder().encode(program) },
      ]);
      const res = await session.bash(`node ${scriptPath}`, {
        timeoutMs: config.timeoutMs,
      });

      const markerAt = res.stdout.lastIndexOf(RESULT_MARKER);
      if (markerAt === -1) {
        const detail =
          res.stderr.trim() ||
          res.stdout.trim() ||
          `exited with code ${res.exitCode ?? 'unknown'}`;
        throw new Error(`Code step execution failed: ${detail}`);
      }

      // Surface anything the user logged before the result to the step log.
      const logged = res.stdout.slice(0, markerAt).trim();
      if (logged) ctx.log.info(logged);

      const payload = res.stdout.slice(markerAt + RESULT_MARKER.length).trim();
      const result = JSON.parse(payload) as unknown;

      const files = config.collectOutputFiles && ctx.files.available
        ? await Promise.all(res.artifacts.map((a) => ctx.files.put({
          name: a.path.split('/').pop() ?? 'output',
          mimeType: a.mimeType,
          // The sandbox already handed these over as bytes; wrapping rather
          // than copying keeps the adapter's one entry point a stream.
          stream: Readable.from(Buffer.from(a.bytes)),
        })))
        : [];
      return { result, ...(config.collectOutputFiles ? { files } : {}) };
    } finally {
      await ctx.sandbox.destroy(handle).catch(() => {
        /* best-effort teardown */
      });
    }
  }
}
