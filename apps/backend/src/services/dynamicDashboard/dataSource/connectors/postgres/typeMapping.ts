import type { DataTypeCanonical } from '@/types/dataSource';

const PG_UDT_TO_CANONICAL: Record<string, DataTypeCanonical> = {
  int2:    'numeric',
  int4:    'numeric',
  int8:    'numeric',
  numeric: 'numeric',
  float4:  'numeric',
  float8:  'numeric',
  money:   'numeric',

  text:    'text',
  varchar: 'text',
  bpchar:  'text',   // CHAR(N)
  name:    'text',
  citext:  'text',   // case-insensitive text extension
  uuid:    'text',   // high-cardinality identifier; treated as text for stats

  bool: 'boolean',

  date:        'temporal',
  timestamp:   'temporal',
  timestamptz: 'temporal',
  time:        'temporal',
  timetz:      'temporal',
  interval:    'temporal',

  json:  'json',
  jsonb: 'json',

  bytea: 'binary',
};

export function pgNativeToCanonical(udtName: string): DataTypeCanonical {
  if (udtName.startsWith('_')) return 'array';
  return PG_UDT_TO_CANONICAL[udtName] ?? 'unknown';
}
