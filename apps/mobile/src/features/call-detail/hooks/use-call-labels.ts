import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TagMethod } from '@xyne/shared';

import { showMessageToast } from '@/src/utils/toast';

import { callDetailService } from '../services/call-detail-service';

interface ResolvedLabel {
  name: string;
  method: TagMethod;
}

/** Tag id → name + method, shared across mounts so reopening a call never refetches. */
const tagCache = new Map<string, ResolvedLabel>();
const inFlight = new Map<string, Promise<void>>();

async function resolveTags(ids: readonly string[]): Promise<void> {
  const missing = ids.filter(id => !tagCache.has(id) && !inFlight.has(id));
  const pending = ids.map(id => inFlight.get(id)).filter((p): p is Promise<void> => !!p);
  if (missing.length > 0) {
    const request = callDetailService
      .getTagsByIds(missing)
      .then(tags => {
        for (const tag of tags) {
          tagCache.set(tag.id, { name: tag.tag, method: tag.method as TagMethod });
        }
        // Ids the API didn't know are raw label text already (or a deleted tag).
        for (const id of missing) {
          if (!tagCache.has(id)) tagCache.set(id, { name: id, method: TagMethod.MANUAL });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        for (const id of missing) inFlight.delete(id);
      });
    for (const id of missing) inFlight.set(id, request);
    pending.push(request);
  }
  await Promise.all(pending);
}

export interface CallLabel {
  id: string;
  name: string;
}

export interface CallLabelsState {
  /** Applied labels (TagMethod.MANUAL). */
  labels: CallLabel[];
  /** AI-suggested labels (LLM / AUTOMATED) still waiting to be kept or dismissed. */
  suggestions: CallLabel[];
  /** Ids whose name/method hasn't resolved yet — rendered as placeholders. */
  pendingCount: number;
  isSaving: boolean;
  /** Replace the applied labels; suggestions are carried along untouched. */
  setLabels: (nextAppliedIds: string[]) => Promise<void>;
  confirmSuggestion: (id: string) => Promise<void>;
  dismissSuggestion: (id: string) => Promise<void>;
}

/**
 * A call's labels, split the way the dashboard's LabelPicker does: `Call.labels`
 * holds Tag ids, and a Tag whose method isn't MANUAL is an AI suggestion, not an
 * applied label. Typed text becomes a real Tag server-side, so the response ids
 * replace the optimistic strings.
 */
export function useCallLabels(
  callExternalId: string | undefined,
  serverLabels: readonly string[] | undefined,
): CallLabelsState {
  const [ids, setIds] = useState<string[]>(() => [...(serverLabels ?? [])]);
  const [isSaving, setIsSaving] = useState(false);
  const [resolveTick, setResolveTick] = useState(0);
  const seqRef = useRef(0);
  const serverKey = (serverLabels ?? []).join('\u0000');

  // Re-seed from Zero when the row changes, unless a local write is in flight.
  useEffect(() => {
    if (isSaving) return;
    setIds(serverKey ? serverKey.split('\u0000') : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const idsKey = ids.join('\u0000');
  const unresolved = ids.some(id => !tagCache.has(id));
  useEffect(() => {
    if (!unresolved) return;
    let cancelled = false;
    void resolveTags(idsKey.split('\u0000').filter(Boolean)).then(() => {
      if (!cancelled) setResolveTick(tick => tick + 1);
    });
    return (): void => {
      cancelled = true;
    };
  }, [idsKey, unresolved]);

  const { labels, suggestions, pendingCount } = useMemo(() => {
    const applied: CallLabel[] = [];
    const suggested: CallLabel[] = [];
    let pending = 0;
    for (const id of ids) {
      const resolved = tagCache.get(id);
      if (!resolved) pending += 1;
      else if (resolved.method === TagMethod.MANUAL) applied.push({ id, name: resolved.name });
      else suggested.push({ id, name: resolved.name });
    }
    return { labels: applied, suggestions: suggested, pendingCount: pending };
    // resolveTick re-reads the module cache once names land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, resolveTick]);

  const writeIds = useCallback(
    async (nextIds: string[]): Promise<void> => {
      if (!callExternalId) return;
      const previous = ids;
      const seq = ++seqRef.current;
      setIds(nextIds);
      setIsSaving(true);
      try {
        const resolved = await callDetailService.updateCallLabels(callExternalId, nextIds);
        // Typed labels come back as ids; their text is what the user typed.
        resolved.forEach((id, index) => {
          const typed = nextIds[index];
          if (!tagCache.has(id) && typed) {
            tagCache.set(id, {
              name: tagCache.get(typed)?.name ?? typed,
              method: TagMethod.MANUAL,
            });
          }
        });
        if (seqRef.current === seq) setIds(resolved);
      } catch {
        showMessageToast('Failed to update labels', 'error');
        if (seqRef.current === seq) setIds(previous);
      } finally {
        if (seqRef.current === seq) setIsSaving(false);
      }
    },
    [callExternalId, ids],
  );

  const setLabels = useCallback(
    (nextAppliedIds: string[]): Promise<void> => {
      // New typed labels are applied labels; seed them so they never flash as pending.
      for (const id of nextAppliedIds) {
        if (!tagCache.has(id)) tagCache.set(id, { name: id, method: TagMethod.MANUAL });
      }
      return writeIds([...nextAppliedIds, ...suggestions.map(label => label.id)]);
    },
    [suggestions, writeIds],
  );

  const confirmSuggestion = useCallback(async (id: string): Promise<void> => {
    const existing = tagCache.get(id);
    if (!existing) return;
    // Optimistic: the Tag row flips to MANUAL in place, so Call.labels doesn't change.
    tagCache.set(id, { ...existing, method: TagMethod.MANUAL });
    setResolveTick(tick => tick + 1);
    try {
      await callDetailService.confirmTag(id);
    } catch {
      tagCache.set(id, existing);
      setResolveTick(tick => tick + 1);
      showMessageToast('Failed to confirm label', 'error');
    }
  }, []);

  const dismissSuggestion = useCallback(
    (id: string): Promise<void> => writeIds(ids.filter(existing => existing !== id)),
    [ids, writeIds],
  );

  return {
    labels,
    suggestions,
    pendingCount,
    isSaving,
    setLabels,
    confirmSuggestion,
    dismissSuggestion,
  };
}
