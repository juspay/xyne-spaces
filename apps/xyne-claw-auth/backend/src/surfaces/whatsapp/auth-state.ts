/**
 * Baileys AuthenticationState backed by the core AuthStateStore instead of
 * files (useMultiFileAuthState). Same semantics: `creds` is one document,
 * signal keys are (type, id) rows, Buffers travel through BufferJSON, and
 * app-state-sync keys are re-hydrated into protobuf objects. Every row is
 * AES-GCM encrypted by the store, and dies with the account.
 */
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import type { AuthStateStore } from "../messaging/plugin.js";

const CREDS_CATEGORY = "creds";

export interface StoredAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize<T>(raw: string): T {
  return JSON.parse(raw, BufferJSON.reviver) as T;
}

export async function makeStoredAuthState(store: AuthStateStore): Promise<StoredAuthState> {
  const storedCreds = await store.get(CREDS_CATEGORY, "");
  const creds: AuthenticationCreds = storedCreds ? deserialize<AuthenticationCreds>(storedCreds) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        const rows = await store.getMany(type, ids);
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const raw = rows.get(id);
          if (raw === undefined) continue;
          let value = deserialize<unknown>(raw);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
          }
          out[id] = value as SignalDataTypeMap[T];
        }
        return out;
      },
      async set(data: SignalDataSet) {
        const entries: Array<{ category: string; keyId: string; value: string | null }> = [];
        for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          const bucket = data[category];
          if (!bucket) continue;
          for (const [keyId, value] of Object.entries(bucket)) {
            entries.push({ category, keyId, value: value === null || value === undefined ? null : serialize(value) });
          }
        }
        await store.setMany(entries);
      },
    },
  };

  return {
    state,
    saveCreds: () => store.set(CREDS_CATEGORY, "", serialize(state.creds)),
  };
}
