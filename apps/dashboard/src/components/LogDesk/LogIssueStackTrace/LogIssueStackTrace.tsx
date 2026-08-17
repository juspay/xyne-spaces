import React, { useMemo, useState } from 'react';
import { formatFullTimestamp, formatRelativeTimestamp } from '../../../utils/dateUtils';

interface LogIssueStackTraceProps {
  stack: string | null;
  lastSeenAt?: number;
}

interface StackFrame {
  raw: string;
  functionName?: string;
  file?: string;
  line?: number;
  col?: number;
}

interface ParsedStackTrace {
  header: string | null;
  frames: StackFrame[];
}

// Matches Node-style stack frame lines:
//   "at functionName (file.ts:123:45)"
//   "at file.ts:123:45"                (anonymous)
const STACK_FRAME_WITH_FN = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const STACK_FRAME_ANONYMOUS = /^\s*at\s+(.+):(\d+):(\d+)\s*$/;
const STACK_FRAME_PREFIX = /^\s*at\s+/;

function parseFrameLine(line: string): StackFrame {
  const withFn = STACK_FRAME_WITH_FN.exec(line);
  if (withFn?.[1] && withFn[2] && withFn[3] && withFn[4]) {
    return {
      raw: line,
      functionName: withFn[1],
      file: withFn[2],
      line: Number(withFn[3]),
      col: Number(withFn[4]),
    };
  }
  const anonymous = STACK_FRAME_ANONYMOUS.exec(line);
  if (anonymous?.[1] && anonymous[2] && anonymous[3]) {
    return {
      raw: line,
      file: anonymous[1],
      line: Number(anonymous[2]),
      col: Number(anonymous[3]),
    };
  }
  return { raw: line };
}

// The first line(s) of a stack trace are the error type/message (e.g.
// "TypeError: fetch failed"), not a call-stack frame — they never start
// with "at ". Splitting them out keeps the Function/File table limited to
// actual frames, so that header text stops rendering as a bogus
// "<anonymous>" row.
function parseStackTrace(stack: string): ParsedStackTrace {
  const lines = stack
    .replace(/\s+at\s+/g, '\nat ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  let splitIndex = 0;
  while (splitIndex < lines.length && !STACK_FRAME_PREFIX.test(lines[splitIndex]!)) {
    splitIndex++;
  }

  const headerLines = lines.slice(0, splitIndex);
  const frames = lines.slice(splitIndex).map(parseFrameLine);

  return {
    header: headerLines.length > 0 ? headerLines.join('\n') : null,
    frames,
  };
}

const COLLAPSED_FRAME_COUNT = 3;

function StackFrameRow({ frame }: { frame: StackFrame }): React.ReactElement {
  return (
    <tr className='border-b border-border last:border-b-0'>
      <td className='py-2 pr-4 align-top text-foreground whitespace-nowrap'>
        {frame.functionName ?? '<anonymous>'}
      </td>
      <td className='py-2 align-top text-muted-foreground break-all'>
        {frame.file ? `${frame.file}${frame.line ? `:${frame.line}:${frame.col}` : ''}` : frame.raw}
      </td>
    </tr>
  );
}

export function LogIssueStackTrace({
  stack,
  lastSeenAt,
}: LogIssueStackTraceProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { header, frames } = useMemo(
    () => (stack ? parseStackTrace(stack) : { header: null, frames: [] }),
    [stack],
  );
  const hiddenCount = Math.max(0, frames.length - COLLAPSED_FRAME_COUNT);
  const visibleFrames = expanded ? frames : frames.slice(0, COLLAPSED_FRAME_COUNT);

  return (
    <div className='bg-background rounded-lg border border-border p-6'>
      <div className='flex items-center justify-between mb-3'>
        <h2 className='text-lg font-semibold text-foreground'>Stack Trace</h2>
        {lastSeenAt !== undefined && (
          <span className='text-xs text-muted-foreground' title={formatFullTimestamp(lastSeenAt)}>
            {formatRelativeTimestamp(lastSeenAt)}
          </span>
        )}
      </div>
      {header && <p className='font-mono text-sm text-foreground mb-3 break-all'>{header}</p>}
      {frames.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No stack trace in this occurrence.</p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='text-left text-muted-foreground border-b border-border'>
                <th className='py-2 pr-4 font-medium'>Function</th>
                <th className='py-2 font-medium'>File</th>
              </tr>
            </thead>
            <tbody className='font-mono'>
              {visibleFrames.map((frame, index) => (
                <StackFrameRow key={index} frame={frame} />
              ))}
            </tbody>
          </table>
          {hiddenCount > 0 && (
            <button
              type='button'
              onClick={() => setExpanded(prev => !prev)}
              className='mt-2 text-xs font-medium text-primary hover:underline'
              data-track-category='LOG_ISSUE_STACK_TRACE'
              data-track-name='TOGGLE_STACK_FRAMES'
            >
              {expanded
                ? 'Show fewer frames'
                : `Show ${hiddenCount} more frame${hiddenCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
