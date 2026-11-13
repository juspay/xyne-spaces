import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CodeStep, CodeStepConfigSchema } from './code.step.js';
import { createMockStepContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import type {
  SandboxAdapter,
  SandboxExecResult,
} from '../../../sandbox/types.js';

// A stand-in SandboxAdapter that runs the CODE step's generated program through
// the LOCAL node — enough to exercise input injection, return capture, and
// error propagation. Real isolation is the host adapter's job (E2B / Docker);
// here we only prove the step drives a sandbox and never evaluates in-process.
function localNodeSandbox(spy?: {
  create?: () => void;
  bash?: (command: string) => void;
  destroy?: () => void;
}): SandboxAdapter {
  return {
    async create() {
      spy?.create?.();
      return { id: 'mock-handle' };
    },
    async destroy() {
      spy?.destroy?.();
    },
    async exec(): Promise<SandboxExecResult> {
      return { stdout: '', stderr: '', artifacts: [], durationMs: 0 };
    },
    async bash(_handle, command): Promise<SandboxExecResult> {
      spy?.bash?.(command);
      const scriptPath = command.replace(/^node\s+/, '').trim();
      try {
        const stdout = execFileSync('node', [scriptPath], { encoding: 'utf8' });
        return { stdout, stderr: '', exitCode: 0, artifacts: [], durationMs: 0 };
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
        return {
          stdout: err.stdout?.toString() ?? '',
          stderr: err.stderr?.toString() ?? String(e),
          exitCode: err.status ?? 1,
          artifacts: [],
          durationMs: 0,
        };
      }
    },
    async writeFiles(_handle, files) {
      for (const f of files) writeFileSync(f.path, Buffer.from(f.bytes));
    },
    async readFile() {
      return new Uint8Array();
    },
  };
}

const sandboxCtx = (workflow?: ReturnType<typeof createMockContext>) =>
  createMockStepContext({
    sandbox: localNodeSandbox(),
    ...(workflow ? { workflow } : {}),
  });

describe('CodeStep', () => {
  const step = new CodeStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('CODE');
    expect(step.kind).toBe('action');
    expect(step.category).toBe('data');
  });

  describe('config schema', () => {
    it('validates valid config', () => {
      const config = CodeStepConfigSchema.parse({ code: 'return 1;' });
      expect(config.timeoutMs).toBe(5000);
    });

    it('rejects empty code', () => {
      expect(() => CodeStepConfigSchema.parse({ code: '' })).toThrow();
    });
  });

  describe('execute', () => {
    it('executes simple return', async () => {
      const result = await step.execute(
        { code: 'return 42;', timeoutMs: 5000 },
        sandboxCtx(),
      );
      expect(result.result).toBe(42);
    });

    it('returns object', async () => {
      const result = await step.execute(
        { code: 'return { a: 1, b: "hello" };', timeoutMs: 5000 },
        sandboxCtx(),
      );
      expect(result.result).toEqual({ a: 1, b: 'hello' });
    });

    it('accesses $input from previous step', async () => {
      const result = await step.execute(
        { code: 'return $input.msg.toUpperCase();', timeoutMs: 5000 },
        sandboxCtx(
          createMockContext({
            steps: { prev: { type: 'TEST', output: { msg: 'hello' } } },
          }),
        ),
      );
      expect(result.result).toBe('HELLO');
    });

    it('accesses $context.trigger', async () => {
      const result = await step.execute(
        { code: 'return $context.trigger.eventId;', timeoutMs: 5000 },
        sandboxCtx(
          createMockContext({
            triggerType: 'TEST',
            triggerData: { eventId: 'evt_123' },
          }),
        ),
      );
      expect(result.result).toBe('evt_123');
    });

    it('uses Math and JSON globals', async () => {
      const result = await step.execute(
        {
          code: 'return JSON.parse(JSON.stringify({ pi: Math.round(Math.PI) }));',
          timeoutMs: 5000,
        },
        sandboxCtx(),
      );
      expect(result.result).toEqual({ pi: 3 });
    });

    it('returns null for undefined result', async () => {
      const result = await step.execute(
        { code: 'return undefined;', timeoutMs: 5000 },
        sandboxCtx(),
      );
      expect(result.result).toBeNull();
    });

    it('supports async/await', async () => {
      const result = await step.execute(
        { code: 'const x = await Promise.resolve(99); return x;', timeoutMs: 5000 },
        sandboxCtx(),
      );
      expect(result.result).toBe(99);
    });

    it('throws on syntax error', async () => {
      await expect(
        step.execute({ code: 'return {{{;', timeoutMs: 5000 }, sandboxCtx()),
      ).rejects.toThrow('Code step execution failed');
    });

    it('throws on runtime error', async () => {
      await expect(
        step.execute(
          { code: 'throw new Error("boom");', timeoutMs: 5000 },
          sandboxCtx(),
        ),
      ).rejects.toThrow('boom');
    });

    it('runs inside the configured sandbox (create → bash → destroy)', async () => {
      const calls: string[] = [];
      const ctx = createMockStepContext({
        sandbox: localNodeSandbox({
          create: () => calls.push('create'),
          bash: () => calls.push('bash'),
          destroy: () => calls.push('destroy'),
        }),
      });
      await step.execute({ code: 'return 1;', timeoutMs: 5000 }, ctx);
      expect(calls).toEqual(['create', 'bash', 'destroy']);
    });

    it('fails closed when no sandbox is configured', async () => {
      const ctx = createMockStepContext(); // no sandbox injected
      await expect(
        step.execute({ code: 'return 1;', timeoutMs: 5000 }, ctx),
      ).rejects.toThrow(/no code-execution sandbox is configured/);
    });
  });
});
