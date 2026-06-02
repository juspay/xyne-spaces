import { useCallback, useEffect, useState } from "react";

/**
 * Per-browser pin / custom-title state for conversations.
 *
 * The backend doesn't (yet) have a ChatConversation table — titles are derived
 * from the first user message, and there's no pinned/archived flags. Until we
 * add that table, we persist these flags client-side in localStorage so the
 * UX works without a migration. Keys are scoped per-user so a shared machine
 * doesn't leak pins between sign-ins.
 *
 * TODO(server-side-metadata): move to a ChatConversation table once we want
 * cross-device sync. The shape exposed by this hook should not need to change.
 */

interface ConversationMetaEntry {
  pinned?: boolean;
  title?: string;
}

type ConversationMetaMap = Record<string, ConversationMetaEntry>;

function storageKey(userId: string): string {
  return `xyne.chat.convMeta.${userId}`;
}

function safeParse(json: string | null): ConversationMetaMap {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as ConversationMetaMap) : {};
  } catch {
    return {};
  }
}

function readMeta(userId: string): ConversationMetaMap {
  if (typeof window === "undefined") return {};
  try {
    return safeParse(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return {};
  }
}

function writeMeta(userId: string, meta: ConversationMetaMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(meta));
  } catch {
    // Out of quota or storage disabled — best-effort fall through.
  }
}

export interface ConversationMetaApi {
  meta: ConversationMetaMap;
  isPinned: (convId: string) => boolean;
  customTitle: (convId: string) => string | undefined;
  togglePin: (convId: string) => void;
  setTitle: (convId: string, title: string | null) => void;
  remove: (convId: string) => void;
}

export function useConversationMeta(userId: string): ConversationMetaApi {
  const [meta, setMeta] = useState<ConversationMetaMap>(() => readMeta(userId));

  // Reload when the userId changes (login/logout).
  useEffect(() => {
    setMeta(readMeta(userId));
  }, [userId]);

  // Cross-tab sync: another tab pinning the same conversation should reflect here.
  useEffect(() => {
    if (typeof window === "undefined" || !userId) return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== storageKey(userId)) return;
      setMeta(safeParse(ev.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const persist = useCallback(
    (next: ConversationMetaMap) => {
      writeMeta(userId, next);
      setMeta(next);
    },
    [userId],
  );

  const togglePin = useCallback(
    (convId: string) => {
      const current = meta[convId] ?? {};
      const next = { ...meta, [convId]: { ...current, pinned: !current.pinned } };
      // Strip empty entries so the blob doesn't grow forever.
      if (!next[convId]!.pinned && !next[convId]!.title) delete next[convId];
      persist(next);
    },
    [meta, persist],
  );

  const setTitle = useCallback(
    (convId: string, title: string | null) => {
      const current = meta[convId] ?? {};
      const cleaned = (title ?? "").trim();
      const updated: ConversationMetaEntry = { ...current };
      if (cleaned.length === 0) delete updated.title;
      else updated.title = cleaned;
      const next = { ...meta, [convId]: updated };
      if (!updated.pinned && !updated.title) delete next[convId];
      persist(next);
    },
    [meta, persist],
  );

  const remove = useCallback(
    (convId: string) => {
      if (!(convId in meta)) return;
      const next = { ...meta };
      delete next[convId];
      persist(next);
    },
    [meta, persist],
  );

  return {
    meta,
    isPinned: (convId) => Boolean(meta[convId]?.pinned),
    customTitle: (convId) => meta[convId]?.title,
    togglePin,
    setTitle,
    remove,
  };
}
