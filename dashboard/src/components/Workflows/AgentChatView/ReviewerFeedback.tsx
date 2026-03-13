import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { usePlatform } from '../../../hooks/usePlatform';
export interface ReviewIssue {
  file: string;
  line: string | number;
  severity: string;
  message: string;
  suggestion?: string;
}

export interface ParsedReviewFeedback {
  issues: ReviewIssue[];
  suggestions?: string[];
  passed?: boolean;
}

const FILE_FIELD_NAMES = ['file', 'path', 'filepath', 'fileName', 'filename', 'file_path'];
const LINE_FIELD_NAMES = ['line', 'lines', 'lineNumber', 'line_number', 'startLine', 'start_line'];
const SEVERITY_FIELD_NAMES = ['severity', 'level', 'type', 'priority', 'category'];
const MESSAGE_FIELD_NAMES = ['message', 'msg', 'description', 'text', 'content', 'summary'];
const SUGGESTION_FIELD_NAMES = ['suggestion', 'fix', 'recommendation', 'proposedFix'];

function extractField(obj: Record<string, unknown>, fieldNames: string[]): unknown {
  for (const name of fieldNames) {
    if (obj[name] !== undefined) {
      return obj[name];
    }
  }
  return undefined;
}

function extractString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function extractLine(value: unknown): string | number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  if (Array.isArray(value) && value.length >= 1) {
    const start: unknown = value[0];
    const end: unknown = value[1];
    if (typeof start === 'number') {
      if (typeof end === 'number' && end !== start) {
        return `${start}-${end}`;
      }
      return start;
    }
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const start = record['start'] ?? record['startLine'] ?? record['start_line'];
    const end = record['end'] ?? record['endLine'] ?? record['end_line'];
    if (typeof start === 'number') {
      if (typeof end === 'number' && end !== start) {
        return `${start}-${end}`;
      }
      return start;
    }
  }
  return undefined;
}

function normalizeIssue(raw: unknown): ReviewIssue | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const file = extractString(extractField(obj, FILE_FIELD_NAMES));
  const line = extractLine(extractField(obj, LINE_FIELD_NAMES));
  const severity = extractString(extractField(obj, SEVERITY_FIELD_NAMES));
  const message = extractString(extractField(obj, MESSAGE_FIELD_NAMES));
  const suggestion = extractString(extractField(obj, SUGGESTION_FIELD_NAMES));

  if (!file || !message) return null;

  return {
    file,
    line: line ?? 'N/A',
    severity: severity || 'info',
    message,
    ...(suggestion && { suggestion }),
  };
}

function parseStringIssue(str: string): ReviewIssue | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  const colonMatch = trimmed.match(/^(.+?):(\d+(?:-\d+)?):\s*(\w+):\s*(.+)$/);
  if (colonMatch && colonMatch[1] && colonMatch[2] && colonMatch[3] && colonMatch[4]) {
    return {
      file: colonMatch[1].trim(),
      line: colonMatch[2],
      severity: colonMatch[3].toLowerCase(),
      message: colonMatch[4].trim(),
    };
  }

  const bracketMatch = trimmed.match(/^\[(\w+)\]\s*(.+?)\s+(?:line\s+)?(\d+(?:-\d+)?):\s*(.+)$/i);
  if (bracketMatch && bracketMatch[1] && bracketMatch[2] && bracketMatch[3] && bracketMatch[4]) {
    return {
      file: bracketMatch[2].trim(),
      line: bracketMatch[3],
      severity: bracketMatch[1].toLowerCase(),
      message: bracketMatch[4].trim(),
    };
  }

  const parenMatch = trimmed.match(/^(.+?)\s+\(lines?\s+(\d+(?:-\d+)?):\s*(.+)$/i);
  if (parenMatch && parenMatch[1] && parenMatch[2] && parenMatch[3]) {
    return {
      file: parenMatch[1].trim(),
      line: parenMatch[2],
      severity: 'warning',
      message: parenMatch[3].trim(),
    };
  }

  return {
    file: 'General',
    line: 'N/A',
    severity: 'info',
    message: trimmed,
  };
}

function extractJson(content: string): string | null {
  let cleanContent = content.trim();

  const codeBlockMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleanContent = codeBlockMatch[1].trim();
  }

  const arrayMatch = cleanContent.match(/\[[\s\S]*\]/);
  const objectMatch = cleanContent.match(/\{[\s\S]*\}/);

  if (arrayMatch) {
    return arrayMatch[0];
  }
  if (objectMatch) {
    return objectMatch[0];
  }

  return null;
}

function parseArrayFormat(arr: unknown[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const item of arr) {
    const normalized = normalizeIssue(item);
    if (normalized) {
      issues.push(normalized);
    }
  }
  return issues;
}

function parseObjectFormat(obj: Record<string, unknown>): ParsedReviewFeedback {
  const result: ParsedReviewFeedback = { issues: [] };

  if (typeof obj['passed'] === 'boolean') {
    result.passed = obj['passed'];
  }

  const issuesData = obj['issues'] ?? obj['findings'] ?? obj['problems'];
  if (Array.isArray(issuesData)) {
    for (const item of issuesData) {
      if (typeof item === 'string') {
        const parsed = parseStringIssue(item);
        if (parsed) result.issues.push(parsed);
      } else {
        const normalized = normalizeIssue(item);
        if (normalized) result.issues.push(normalized);
      }
    }
  }

  const suggestionsData = obj['suggestions'] ?? obj['recommendations'] ?? obj['fixes'];
  if (Array.isArray(suggestionsData)) {
    result.suggestions = suggestionsData
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  return result;
}

export const parseReviewerFeedback = (content: string): ReviewIssue[] | null => {
  try {
    const jsonStr = extractJson(content);
    if (!jsonStr) return null;

    const parsed: unknown = JSON.parse(jsonStr);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const issues = parseArrayFormat(parsed);
      return issues.length > 0 ? issues : null;
    }

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const result = parseObjectFormat(parsed as Record<string, unknown>);
      return result.issues.length > 0 ? result.issues : null;
    }

    return null;
  } catch {
    return null;
  }
};

export const parseReviewerFeedbackFull = (content: string): ParsedReviewFeedback | null => {
  try {
    const jsonStr = extractJson(content);
    if (!jsonStr) return null;

    const parsed: unknown = JSON.parse(jsonStr);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const issues = parseArrayFormat(parsed);
      return issues.length > 0 ? { issues } : null;
    }

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const result = parseObjectFormat(parsed as Record<string, unknown>);
      return result.issues.length > 0 || (result.suggestions?.length ?? 0) > 0 ? result : null;
    }

    return null;
  } catch {
    return null;
  }
};

function formatLineDisplay(line: string | number): string {
  const str = String(line);

  if (str.includes('-') || str.includes(',')) {
    return `Lines ${str}`;
  }

  if (/^\d+$/.test(str)) {
    return `Line ${str}`;
  }

  return str;
}

function getSeverityStyle(severity: string): { icon: string; colorClass: string } {
  const s = severity.toLowerCase();

  const errorKeywords = ['error', 'critical', 'major', 'high', 'blocker', 'severe', 'fatal'];
  const warningKeywords = ['warning', 'medium', 'moderate', 'minor'];
  const successKeywords = ['success', 'fixed', 'resolved', 'passed', 'info'];
  const suggestionKeywords = ['suggestion', 'info', 'nit', 'style', 'improvement'];

  if (errorKeywords.some(k => s.includes(k))) {
    return { icon: '🔴', colorClass: 'text-red-500' };
  }
  if (warningKeywords.some(k => s.includes(k))) {
    return { icon: '⚠️', colorClass: 'text-amber-500' };
  }
  if (successKeywords.some(k => s.includes(k))) {
    return { icon: '✅', colorClass: 'text-green-500' };
  }
  if (suggestionKeywords.some(k => s.includes(k))) {
    return { icon: '💡', colorClass: 'text-blue-400' };
  }

  return { icon: 'ℹ️', colorClass: 'text-muted-foreground' };
}

export interface ReviewerFeedbackProps {
  issues: ReviewIssue[];
  suggestions?: string[];
  /** Callback for mobile 'View more' - opens drawer/modal */
  onViewMore?: () => void;
  /** Disable truncation entirely (e.g. in a modal) */
  disableTruncation?: boolean;
  /** Max height in px before truncating (default 300) */
  maxHeightPx?: number;
}

export const ReviewerFeedback: React.FC<ReviewerFeedbackProps> = ({
  issues,
  suggestions,
  onViewMore,
  disableTruncation = false,
  maxHeightPx = 300,
}) => {
  const { isMobile } = usePlatform();
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disableTruncation) return;
    if (contentRef.current) {
      setNeedsTruncation(contentRef.current.scrollHeight > maxHeightPx + 40);
    }
  }, [issues, suggestions, disableTruncation, maxHeightPx]);

  const groupedIssues = useMemo(() => {
    if (!issues || issues.length === 0) return [];
    const groups = new Map<string, ReviewIssue[]>();
    issues.forEach(issue => {
      if (!groups.has(issue.file)) groups.set(issue.file, []);
      groups.get(issue.file)!.push(issue);
    });
    return Array.from(groups.entries());
  }, [issues]);

  const handleViewMore = (): void => {
    if (isMobile && onViewMore) {
      onViewMore();
    } else {
      setIsExpanded(v => !v);
    }
  };

  const shouldTruncate = !disableTruncation && needsTruncation && !isExpanded;

  if ((!issues || issues.length === 0) && (!suggestions || suggestions.length === 0)) return null;

  return (
    <div className='relative'>
      <div
        ref={contentRef}
        className='flex flex-col mt-1.5 text-[13px] text-foreground/90 font-sans overflow-hidden'
        style={
          shouldTruncate
            ? {
                maxHeight: `${maxHeightPx}px`,
                maskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 80%, transparent 100%)',
              }
            : undefined
        }
      >
        <p className='font-medium mb-3'>I have reviewed the code. Here are my findings:</p>

        {groupedIssues.map(([filePath, fileIssues], idx) => {
          const fileName = filePath.split('/').pop() || filePath;

          return (
            <div key={idx} className='flex flex-col mb-4'>
              <p className='font-semibold mb-2'>
                <code className='bg-muted/80 px-1.5 py-0.5 rounded'>{fileName}</code>
              </p>
              <ul className='flex flex-col gap-2 pl-0.5'>
                {fileIssues.map((issue, issueIdx) => {
                  const { icon } = getSeverityStyle(issue.severity);

                  return (
                    <li key={issueIdx} className='flex items-start gap-2 leading-relaxed'>
                      <span className='mt-[1px] flex-shrink-0 text-sm'>{icon}</span>
                      <div className='min-w-0 flex-1'>
                        <span className='font-bold uppercase text-[11px] mr-1.5 tracking-wider text-foreground/80'>
                          {issue.severity}
                        </span>
                        <span className='font-mono text-[11px] text-muted-foreground mr-1.5'>
                          ({formatLineDisplay(issue.line)}):
                        </span>
                        <span className='break-words text-foreground/90'>{issue.message}</span>

                        {issue.suggestion && (
                          <div className='mt-1.5 pl-3 border-l-2 border-blue-400/50'>
                            <span className='text-[11px] text-blue-400 font-medium'>
                              Suggestion:{' '}
                            </span>
                            <span className='text-[12px] text-foreground/70'>
                              {issue.suggestion}
                            </span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {suggestions && suggestions.length > 0 && (
          <div className='flex flex-col mt-2 pt-3 border-t border-border/50'>
            <p className='font-semibold mb-2 text-foreground/80'>💡 Suggestions</p>
            <ul className='flex flex-col gap-1.5'>
              {suggestions.map((suggestion, idx) => (
                <li
                  key={idx}
                  className='text-[12px] text-foreground/70 pl-2 border-l-2 border-muted-foreground/30'
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {needsTruncation && !disableTruncation && (
        <button
          onClick={handleViewMore}
          className='flex items-center gap-1 mt-2 text-[11px] font-medium text-sky-600 hover:text-sky-700 transition-colors'
          data-track-category='Workflows'
          data-track-name='ViewMoreReviewerFeedback'
        >
          {isMobile ? (
            <>
              <ChevronDown size={12} />
              View more
            </>
          ) : isExpanded ? (
            <>
              <ChevronUp size={12} />
              Read less
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              View more
            </>
          )}
        </button>
      )}
    </div>
  );
};
