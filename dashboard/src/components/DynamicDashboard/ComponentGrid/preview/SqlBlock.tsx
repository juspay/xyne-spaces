import { ReactElement, useMemo } from 'react';
import hljs from 'highlight.js';
import { Check, Code2, Copy } from 'lucide-react';
import { useCopyButton } from '../../../../hooks/useCopyButton';

interface SqlBlockProps {
  sql: string;
  params: unknown[];
  subtitle?: string;
}

const CLAUSE_BREAKS = new Set([
  'FROM',
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'JOIN',
]);
const CONNECTORS = new Set(['AND', 'OR']);

function formatParam(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return `'${text.replace(/'/g, "''")}'`;
}

interface Tok {
  text: string;
  kind: 'ident' | 'string' | 'num' | 'word' | 'open' | 'close' | 'comma' | 'op';
}

function tokenize(s: string): Tok[] {
  const re =
    /("(?:[^"]|"")*")|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\()|(\))|(,)|(::|>=|<=|<>|!=|[-+*/%<>=])|(\S)/g;
  const out: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) out.push({ text: m[1], kind: 'ident' });
    else if (m[2] !== undefined) out.push({ text: m[2], kind: 'string' });
    else if (m[3] !== undefined) out.push({ text: m[3], kind: 'num' });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: 'word' });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: 'open' });
    else if (m[6] !== undefined) out.push({ text: m[6], kind: 'close' });
    else if (m[7] !== undefined) out.push({ text: m[7], kind: 'comma' });
    else if (m[8] !== undefined) out.push({ text: m[8], kind: 'op' });
    else if (m[9] !== undefined) out.push({ text: m[9], kind: 'op' });
  }
  return out;
}

/** Reindent a compiled SQL string and inline its `$n` params as literal values. */
function prettyPrint(rawSql: string, params: unknown[]): string {
  const inlined = rawSql.replace(/\$(\d+)/g, (_m, n: string) => {
    const idx = Number(n) - 1;
    return idx >= 0 && idx < params.length ? formatParam(params[idx]) : `$${n}`;
  });
  const toks = tokenize(inlined.replace(/\s+/g, ' ').trim());

  let out = '';
  let depth = 0;
  let lineStart = true;
  const newline = (level: number): void => {
    out = out.replace(/ +$/, '');
    out += `\n${'  '.repeat(Math.max(0, level))}`;
    lineStart = true;
  };
  const space = (): void => {
    if (!lineStart && !out.endsWith(' ') && !out.endsWith('(')) out += ' ';
  };

  for (const t of toks) {
    const up = t.kind === 'word' ? t.text.toUpperCase() : '';
    if (t.kind === 'open') {
      space();
      out += '(';
      depth++;
      lineStart = false;
    } else if (t.kind === 'close') {
      depth = Math.max(0, depth - 1);
      out = out.replace(/ +$/, '');
      out += ')';
      lineStart = false;
    } else if (t.kind === 'comma') {
      out = out.replace(/ +$/, '');
      out += ',';
      if (depth === 0) newline(1);
      else lineStart = false;
    } else if (t.kind === 'op' && t.text === '::') {
      out = out.replace(/ +$/, '');
      out += '::';
      lineStart = false;
    } else if (up === 'SELECT') {
      out += 'SELECT';
      newline(1);
    } else if (up === 'FILTER') {
      newline(depth + 1);
      out += 'FILTER';
      lineStart = false;
    } else if (CONNECTORS.has(up)) {
      newline(depth);
      out += t.text;
      lineStart = false;
    } else if (CLAUSE_BREAKS.has(up)) {
      newline(depth);
      out += t.text;
      lineStart = false;
    } else {
      space();
      out += t.text;
      lineStart = false;
    }
  }
  return out.trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SqlBlock = ({ sql, params, subtitle }: SqlBlockProps): ReactElement => {
  const formatted = useMemo(() => prettyPrint(sql, params), [sql, params]);
  const html = useMemo(() => {
    try {
      return hljs.highlight(formatted, { language: 'sql' }).value;
    } catch {
      return escapeHtml(formatted);
    }
  }, [formatted]);
  const { copied, copy } = useCopyButton();

  return (
    <div className='flex flex-col h-full min-h-0'>
      <div className='flex items-center justify-between px-3.5 py-2 border-b border-xyne-gray-100 bg-xyne-gray-50/60'>
        <div className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-xyne-gray-500'>
          <Code2 size={13} />
          Compiled SQL
          <span className='ml-1 normal-case tracking-normal font-normal text-xyne-gray-400'>
            · {subtitle ?? 'generated on the fly'}
            {params.length > 0 ? ' · values inlined' : ''}
          </span>
        </div>
        <button
          type='button'
          onClick={() => copy(formatted)}
          className='inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-xyne-gray-200 bg-white text-[12px] font-medium text-xyne-gray-600 hover:bg-xyne-gray-50 transition-colors'
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Copy_Component_Query'
        >
          {copied ? (
            <>
              <Check size={13} className='text-xyne-green-600' /> Copied
            </>
          ) : (
            <>
              <Copy size={13} /> Copy
            </>
          )}
        </button>
      </div>
      <pre
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
        className='flex-1 min-h-0 overflow-auto px-4 py-3.5 text-[12.5px] leading-[1.7] font-mono text-xyne-gray-700 whitespace-pre-wrap break-words'
      />
    </div>
  );
};

export default SqlBlock;
