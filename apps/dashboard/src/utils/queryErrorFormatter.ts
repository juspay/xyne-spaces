// Translate raw database driver error messages into something a non-engineer
// can act on. Currently focused on the ClickHouse error patterns the chart
// builder's "build a join" flow can produce (type mismatch in JOIN ON,
// missing column, etc.). The goal is "tell the user WHAT broke and WHAT
// to do", not "expose the engine's internal diagnostic".
//
// Falls back to the raw message when no pattern matches — better to show
// something verbose than to swallow the only clue.

export interface FormattedQueryError {
  title: string;
  // Short, single-sentence summary the tile can show prominently.
  summary: string;
  // Optional structured detail rendered below the summary. Each entry is a
  // (label, value) pair the UI can render as a small definition list.
  details?: Array<{ label: string; value: string }>;
  // What the user can do to fix it. Keep it action-oriented and short.
  suggestion?: string;
  // The raw driver message, preserved for a "Show technical details" toggle.
  raw: string;
}

const FRIENDLY_TYPE_NAMES: Record<string, string> = {
  String: 'text',
  FixedString: 'text',
  UInt8: 'number',
  UInt16: 'number',
  UInt32: 'number',
  UInt64: 'number',
  UInt128: 'number',
  UInt256: 'number',
  Int8: 'number',
  Int16: 'number',
  Int32: 'number',
  Int64: 'number',
  Int128: 'number',
  Int256: 'number',
  Float32: 'number',
  Float64: 'number',
  Decimal: 'number',
  Date: 'date',
  Date32: 'date',
  DateTime: 'date/time',
  DateTime64: 'date/time',
  Bool: 'boolean',
  UUID: 'uuid',
};

function friendlyType(raw: string): string {
  const bare = raw.replace(/\(.*\)$/, ''); // strip "(7)" off DateTime64(7), etc.
  return FRIENDLY_TYPE_NAMES[bare] ?? raw;
}

// Pull "table.column" out of CH's "__table1.colname" placeholders. We don't
// know the real table name from the engine's output, but the column name
// is enough to be useful — the user picked it themselves moments earlier.
function stripTablePrefix(s: string): string {
  return s.replace(/^__table\d+\./, '');
}

export function formatQueryError(rawMessage: string): FormattedQueryError {
  const fallback: FormattedQueryError = {
    title: 'Query failed',
    summary: rawMessage,
    raw: rawMessage,
  };
  if (!rawMessage) return fallback;

  // Helper to build the same friendly response for any of the JOIN
  // type-mismatch error variants below — different CH error templates
  // surface the same semantic problem (the two ON columns have
  // incompatible types).
  const buildJoinTypeError = (
    leftCol: string,
    leftType: string,
    rightCol: string,
    rightType: string,
  ): FormattedQueryError => ({
    title: "Can't join these columns",
    summary: "The two columns you picked have different types and can't be compared in a JOIN.",
    details: [
      { label: stripTablePrefix(leftCol), value: friendlyType(leftType) },
      { label: stripTablePrefix(rightCol), value: friendlyType(rightType) },
    ],
    suggestion: 'Pick two columns of the same type (text-to-text, number-to-number, date-to-date).',
    raw: rawMessage,
  });

  // Variant A — equality-operator error inside JOIN ON. CH emits this when
  // it gets to the equals() function with incompatible argument types:
  //   "Illegal types of arguments (UInt64, Date) of function equals:
  //    In scope SELECT ... ON A.col = B.col"
  // The (Type1, Type2) precedes the ON-clause column references.
  const illegalEqualsMatch = rawMessage.match(
    /Illegal types of arguments \((\w+(?:\([^)]*\))?),\s*(\w+(?:\([^)]*\))?)\)\s+of function equals[\s\S]*?ON\s+(\S+)\s*=\s*([^\s.]+\.[^\s.]+)/,
  );
  if (illegalEqualsMatch) {
    return buildJoinTypeError(
      illegalEqualsMatch[3]!,
      illegalEqualsMatch[1]!,
      illegalEqualsMatch[4]!,
      illegalEqualsMatch[2]!,
    );
  }

  // Variant B — supertype-inference error in the ON section. CH 24.x
  // emits this template when the JOIN planner tries to unify key types:
  //   "There is no supertype for types X, Y because ...:
  //    JOIN INNER JOIN ... ON A = B cannot infer common type in ON section
  //    for keys. Left key __table1.col type X. Right key __table2.col type Y."
  const supertypeMatch = rawMessage.match(
    /Left key (\S+) type (\S+)\.\s*Right key (\S+) type ([^.\s]+)/,
  );
  if (supertypeMatch) {
    return buildJoinTypeError(
      supertypeMatch[1]!,
      supertypeMatch[2]!,
      supertypeMatch[3]!,
      supertypeMatch[4]!,
    );
  }

  // Column doesn't exist:
  //   "Code: 47. DB::Exception: Missing columns: 'foo' while processing..."
  const missingColumn = rawMessage.match(/Missing columns?: '([^']+)'/);
  if (missingColumn) {
    return {
      title: 'Column not found',
      summary: `The column "${missingColumn[1]}" doesn't exist on the table you selected.`,
      suggestion: 'It may have been renamed or removed. Refresh the data source and pick again.',
      raw: rawMessage,
    };
  }

  // Table doesn't exist:
  //   "Code: 60. DB::Exception: Table foo.bar does not exist."
  const missingTable = rawMessage.match(/Table\s+(\S+)\s+does(?:n't|\s+not)\s+exist/i);
  if (missingTable) {
    return {
      title: 'Table not found',
      summary: `The table "${missingTable[1]}" doesn't exist in this data source.`,
      suggestion: 'Refresh the data source to pull the latest schema.',
      raw: rawMessage,
    };
  }

  // Query timeout — CH-specific phrasing.
  if (/timeout|max_execution_time/i.test(rawMessage)) {
    return {
      title: 'Query took too long',
      summary: 'The data source took longer than allowed to return results.',
      suggestion:
        'Add a filter (date range, status, etc.) to narrow the result set, or reduce the LIMIT.',
      raw: rawMessage,
    };
  }

  // Permission denied.
  if (/Not enough privileges|Access denied/i.test(rawMessage)) {
    return {
      title: 'Access denied',
      summary: "The data source credentials don't have permission to read this table.",
      suggestion: 'Ask the data source owner to grant SELECT on the table.',
      raw: rawMessage,
    };
  }

  return fallback;
}
