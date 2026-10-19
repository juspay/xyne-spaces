export type Path<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object ? K | `${K}.${Path<T[K]>}` : K;
    }[keyof T & string]
  : never;

export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

export const getByPath = <T, P extends Path<T>>(obj: T, path: P): PathValue<T, P> => {
  const segments = (path as string).split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') {
      return undefined as PathValue<T, P>;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor as PathValue<T, P>;
};

export const setByPath = <T extends object>(obj: T, path: string, value: unknown): T => {
  if (!path) {
    return obj;
  }
  const segments = path.split('.');
  const head = segments[0]!;
  const rest = segments.slice(1);

  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }

  const next = (obj as Record<string, unknown>)[head];
  const nextObj = next && typeof next === 'object' ? (next as object) : {};
  return {
    ...obj,
    [head]: setByPath(nextObj, rest.join('.'), value),
  } as T;
};
