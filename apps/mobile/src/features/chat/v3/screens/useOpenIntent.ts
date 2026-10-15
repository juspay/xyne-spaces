import { useMemo } from 'react';

import { parseOpenIntent } from '../intent/parseOpenIntent';
import type { OpenFailure } from '../types/openFailure';
import type { OpenIntent } from '../intent/openIntent.types';

/** Validate route params. Cursor fill lives in `useResolveLocation`. */
export const useOpenIntent = (
  raw: Record<string, unknown>,
): { ok: true; value: OpenIntent } | { ok: false; error: OpenFailure } =>
  useMemo(() => parseOpenIntent(raw), [raw]);
