import { setup, createActor, assign } from 'xstate';
import { logger, Event as LogEvent } from '../utils/logger';

export type XyneCalendarState = 'closed' | 'open';

export interface XyneCalendarContext {
  xyneCalendarState: XyneCalendarState;
  /** ISO day string (yyyy-MM-dd) — the day the timeline is showing. */
  selectedDate: string;
  selectedCallId: string | null;
}

export type XyneCalendarEvent =
  | { type: 'OPEN'; date?: string }
  | { type: 'CLOSE' }
  | { type: 'SELECT_DATE'; date: string }
  | { type: 'SELECT_CALL'; callId: string | null };

const todayIso = (): string => new Date().toISOString().slice(0, 10);

// Own IndexedDB (not xyneAIMachine's) so a schema bump on one doesn't touch the other.
const DB_NAME = 'xyne-calendar-state';
const STORE_NAME = 'context';
const CONTEXT_KEY = 'xyne-calendar-context';

// Older than this, restore falls back to today instead of the stale date.
const STALE_DATE_MS = 60 * 60 * 1000; // 1 hour

interface PersistedCalendarState {
  xyneCalendarState: XyneCalendarState;
  selectedDate: string;
  savedAt: number;
}

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(new Error(request.error?.message || 'Failed to open IndexedDB'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
  });
};

const savePersistedState = async (
  state: XyneCalendarState,
  selectedDate: string,
): Promise<void> => {
  try {
    const db = await initDB();
    const store = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME);
    const persisted: PersistedCalendarState = {
      xyneCalendarState: state,
      selectedDate,
      savedAt: Date.now(),
    };
    store.put(persisted, CONTEXT_KEY);
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to save XyneCalendar state to IndexedDB:'),
      error: error,
    });
  }
};

const loadPersistedState = async (): Promise<{
  state: XyneCalendarState;
  selectedDate: string | null;
}> => {
  try {
    const db = await initDB();
    const store = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
    return await new Promise((resolve, reject) => {
      const request = store.get(CONTEXT_KEY);
      request.onsuccess = () => {
        const result = request.result as PersistedCalendarState | undefined;
        if (!result) {
          resolve({ state: 'closed', selectedDate: null });
          return;
        }
        const isStale = Date.now() - result.savedAt > STALE_DATE_MS;
        resolve({
          state: result.xyneCalendarState ?? 'closed',
          selectedDate: isStale ? null : (result.selectedDate ?? null),
        });
      };
      request.onerror = () =>
        reject(
          new Error(request.error?.message || 'Failed to get XyneCalendar state from IndexedDB'),
        );
    });
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to load XyneCalendar state from IndexedDB:'),
      error: error,
    });
    return { state: 'closed', selectedDate: null };
  }
};

export const xyneCalendarMachine = setup({
  types: {
    context: {} as XyneCalendarContext,
    events: {} as XyneCalendarEvent,
  },
  actions: {
    // Only the reload-restore path passes `date`; a real click always resets to today.
    resetView: assign(({ event }) => {
      const date = (event.type === 'OPEN' && event.date) || todayIso();
      void savePersistedState('open', date);
      return {
        xyneCalendarState: 'open' as XyneCalendarState,
        selectedDate: date,
        selectedCallId: null,
      };
    }),
    setClosed: assign(({ context }) => {
      void savePersistedState('closed', context.selectedDate);
      return { xyneCalendarState: 'closed' as XyneCalendarState };
    }),
    setSelectedDate: assign(({ event, context }) => {
      if (event.type !== 'SELECT_DATE') return {};
      void savePersistedState(context.xyneCalendarState, event.date);
      return { selectedDate: event.date };
    }),
    setSelectedCall: assign(({ event }) => {
      if (event.type !== 'SELECT_CALL') return {};
      return { selectedCallId: event.callId };
    }),
  },
}).createMachine({
  context: () => ({
    xyneCalendarState: 'closed',
    selectedDate: todayIso(),
    selectedCallId: null,
  }),
  id: 'xyneCalendarMachine',
  initial: 'closed',
  states: {
    closed: {
      on: {
        OPEN: { target: 'open', actions: 'resetView' },
      },
    },
    open: {
      on: {
        CLOSE: { target: 'closed', actions: 'setClosed' },
        SELECT_DATE: { actions: 'setSelectedDate' },
        SELECT_CALL: { actions: 'setSelectedCall' },
      },
    },
  },
});

export const xyneCalendarActor = createActor(xyneCalendarMachine).start();

// Async restore, mirrors xyneAIMachine — starts closed, flips open once IndexedDB resolves.
void (async (): Promise<void> => {
  const { state, selectedDate } = await loadPersistedState();
  if (state === 'open') {
    xyneCalendarActor.send({ type: 'OPEN', ...(selectedDate ? { date: selectedDate } : {}) });
  }
})();
