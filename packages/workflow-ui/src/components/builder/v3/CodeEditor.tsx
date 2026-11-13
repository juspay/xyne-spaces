import { useCallback, useMemo, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { useVariablePicker, type VariableNode } from '../../../hooks/use-variable-picker.js';
import { cn } from '../../shared/cn.js';

export interface CodeEditorProps {
  value: string;
  onChange: (value: unknown) => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
}

// ─── Sandbox globals available in the code step ───

const SANDBOX_GLOBALS: Completion[] = [
  { label: '$input', type: 'variable', detail: 'Previous step output', boost: 10 },
  { label: '$context', type: 'variable', detail: 'Workflow context', boost: 9 },
  { label: '$context.trigger', type: 'variable', detail: 'Trigger output', boost: 8 },
  { label: '$context.steps', type: 'variable', detail: 'All step outputs', boost: 8 },
  { label: '$files', type: 'variable', detail: 'Bound documents, mounted at /mnt/files', boost: 9 },
  { label: "require('fs')", type: 'function', detail: 'Read a mounted document' },
  { label: 'return', type: 'keyword', detail: 'Return result', boost: 8 },
  { label: 'console.log', type: 'function', detail: 'Log message' },
  { label: 'console.warn', type: 'function', detail: 'Log warning' },
  { label: 'console.error', type: 'function', detail: 'Log error' },
  { label: 'JSON.stringify', type: 'function' },
  { label: 'JSON.parse', type: 'function' },
  { label: 'Math', type: 'variable' },
  { label: 'Date', type: 'class' },
  { label: 'parseInt', type: 'function' },
  { label: 'parseFloat', type: 'function' },
  { label: 'Object.keys', type: 'function' },
  { label: 'Object.values', type: 'function' },
  { label: 'Object.entries', type: 'function' },
  { label: 'Array.isArray', type: 'function' },
];

// ─── Build completions from variable tree ───

function buildCompletions(variables: VariableNode[]): Completion[] {
  const completions = [...SANDBOX_GLOBALS];

  for (const root of variables) {
    const path = root.path;

    completions.push({
      label: `$context.${path}`,
      type: 'variable',
      detail: root.schemaType,
      boost: 7,
    });

    if (root.children.length > 0) {
      for (const child of root.children) {
        completions.push({
          label: `$context.${path}.${child.label}`,
          type: child.isLeaf ? 'property' : 'variable',
          detail: child.schemaType,
          boost: 6,
        });

        if (child.children.length > 0) {
          for (const nested of child.children) {
            completions.push({
              label: `$context.${path}.${child.label}.${nested.label}`,
              type: 'property',
              detail: nested.schemaType,
              boost: 5,
            });
          }
        }
      }
    }
  }

  return completions;
}

function createCompletionSource(completions: Completion[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[\w.$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    return {
      from: word.from,
      options: completions,
      validFor: /^[\w.$]*$/,
    };
  };
}

// ─── Component ───

export function CodeEditor({
  value,
  onChange,
  config,
  atStepId,
  readOnly,
}: CodeEditorProps) {
  const handleChange = useCallback((val: string) => onChange(val), [onChange]);
  const [isExpanded, setIsExpanded] = useState(false);

  const { variables } = useVariablePicker({
    config,
    atStepId,
    enabled: true,
  });

  const [wordWrap, setWordWrap] = useState(true);

  const extensions = useMemo(() => {
    const completions = buildCompletions(variables);
    const exts = [
      javascript(),
      oneDark,
      autocompletion({
        override: [createCompletionSource(completions)],
        activateOnTyping: true,
      }),
    ];
    if (wordWrap) exts.push(EditorView.lineWrapping);
    return exts;
  }, [variables, wordWrap]);

  return (
    <div className="space-y-0">
      {/* Editor container */}
      <div
        className={cn(
          'rounded-lg border',
          'border-slate-700/50 focus-within:border-sky-500/60 focus-within:ring-1 focus-within:ring-sky-500/20',
          readOnly && 'opacity-60',
        )}
        style={{ overflow: 'clip' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-slate-700/40 bg-[#282c34] px-3 py-1.5">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400/60" />
              <span className="h-2 w-2 rounded-full bg-amber-400/60" />
              <span className="h-2 w-2 rounded-full bg-emerald-400/60" />
            </div>
            <span className="text-[10px] font-medium text-slate-500">JavaScript</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWordWrap(!wordWrap)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                wordWrap
                  ? 'text-sky-400 bg-sky-500/10'
                  : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300',
              )}
              title={wordWrap ? 'Word wrap on' : 'Word wrap off'}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M3 12h15a3 3 0 1 1 0 6h-4" /><path d="m16 16-2 2 2 2" /><path d="M3 18h7" />
              </svg>
              Wrap
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-700/50 hover:text-slate-300 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isExpanded ? (
                  <><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></>
                ) : (
                  <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></>
                )}
              </svg>
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        <CodeMirror
          value={value}
          onChange={handleChange}
          extensions={extensions}
          readOnly={readOnly ?? false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: !readOnly,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            autocompletion: false, // we provide our own
          }}
          minHeight={isExpanded ? '300px' : '180px'}
          maxHeight={isExpanded ? '600px' : '360px'}
          style={{ fontSize: '12.5px' }}
        />
      </div>

      {/* Context hint bar */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-400">Available:</span>
        {[
          { label: '$input', desc: 'prev step output' },
          { label: '$context', desc: 'workflow data' },
          { label: 'return', desc: 'output value' },
        ].map((hint) => (
          <span
            key={hint.label}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono"
            title={hint.desc}
          >
            <span className="text-sky-600 font-semibold">{hint.label}</span>
            <span className="text-slate-400">{hint.desc}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
