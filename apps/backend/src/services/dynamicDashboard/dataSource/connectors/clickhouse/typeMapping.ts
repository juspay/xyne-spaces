import type { DataTypeCanonical } from '@/types/dataSource';

const CH_BASE_TO_CANONICAL: Record<string, DataTypeCanonical> = {
  Int8:       'numeric',
  Int16:      'numeric',
  Int32:      'numeric',
  Int64:      'numeric',
  Int128:     'numeric',
  Int256:     'numeric',
  UInt8:      'numeric',
  UInt16:     'numeric',
  UInt32:     'numeric',
  UInt64:     'numeric',
  UInt128:    'numeric',
  UInt256:    'numeric',
  Float32:    'numeric',
  Float64:    'numeric',
  Decimal:    'numeric',
  Decimal32:  'numeric',
  Decimal64:  'numeric',
  Decimal128: 'numeric',
  Decimal256: 'numeric',

  String:       'text',
  FixedString:  'text',
  UUID:         'text',
  Enum:         'text',
  Enum8:        'text',
  Enum16:       'text',

  Bool: 'boolean',

  Date:       'temporal',
  Date32:     'temporal',
  DateTime:   'temporal',
  DateTime32: 'temporal',
  DateTime64: 'temporal',

  JSON:   'json',
  Object: 'json',
};

function unwrap(rawType: string): string {
  const stripped = rawType.replace(/\(.*\)$/, '').trim();

  for (const prefix of ['Nullable', 'LowCardinality']) {
    if (stripped.startsWith(prefix)) {
      const inner = rawType.slice(prefix.length + 1, -1).trim();      return unwrap(inner);
    }
  }
  return stripped;
}

export function chNativeToCanonical(rawType: string): DataTypeCanonical {
  if (rawType.startsWith('Array(')) return 'array';

  const base = unwrap(rawType);
  return CH_BASE_TO_CANONICAL[base] ?? 'unknown';
}
