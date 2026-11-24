import { UnreadableString, reveal } from '@xyne/shared';

/** Whether `value` is a plain object or array to look inside (Prisma rows are plain-prototype proxies). */
function isContainer(value: object): boolean {
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `T` with every `UnreadableString` in it as the string it holds. */
export type Revealed<T> = T extends UnreadableString
  ? string
  : T extends Date
    ? T
    : T extends readonly (infer E)[]
      ? Revealed<E>[]
      : T extends object
        ? { [K in keyof T]: Revealed<T[K]> }
        : T;

/**
 * `value` with every `UnreadableString` replaced by the value it holds; anything else is kept
 * as it is (a container is copied only when something inside it changed). Only for a payload
 * on its way to a client the value belongs to (an HTTP response, a websocket or pub/sub
 * broadcast): plaintext with DB encryption off, workspace-DEK ciphertext with it on (the
 * response encryption then re-encrypts it for the caller). Never for backend logic.
 */
export function revealUnreadable<T>(value: T): Revealed<T> {
  return revealDeep(value, new WeakSet<object>()) as Revealed<T>;
}

function revealDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof UnreadableString) return reveal(value);
  if (!value || typeof value !== 'object' || !isContainer(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    let next: unknown[] | undefined;
    value.forEach((item, index) => {
      const revealed = revealDeep(item, seen);
      if (revealed !== item) {
        next ??= [...value];
        next[index] = revealed;
      }
    });
    return next ?? value;
  }
  let next: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(value)) {
    const revealed = revealDeep(item, seen);
    if (revealed !== item) {
      next ??= { ...value };
      next[key] = revealed;
    }
  }
  return next ?? value;
}
