import { createMMKV } from 'react-native-mmkv';

/** App Group / multi-process store. Keep this tiny — iOS SIGKILLs (0xdead10cc) if we hold its locks while suspending. */
export const HANDOFF_MMKV_ID = 'lotus-startup';

/** Process-local store. Not visible to the NSE; no App Group file locks. */
export const CACHE_MMKV_ID = 'lotus-cache';

/** Sandbox-only last-op marker for RCA. Never put this in the App Group. */
export const DIAG_MMKV_ID = 'lotus-diag';

export const handoffMmkv = createMMKV({ id: HANDOFF_MMKV_ID, mode: 'multi-process' });
export const cacheMmkv = createMMKV({ id: CACHE_MMKV_ID });
export const diagMmkv = createMMKV({ id: DIAG_MMKV_ID });
