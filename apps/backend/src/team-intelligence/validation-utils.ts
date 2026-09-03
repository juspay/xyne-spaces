type ValidationPath = Array<string | number>;

interface ValidationIssueLike {
  path: ValidationPath;
}

function valueAtPath(root: unknown, path: ValidationPath): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function arrayItemFailure(
  issue: ValidationIssueLike
): { parentPath: ValidationPath; index: number } | null {
  const indexPath = issue.path.findIndex((segment) => typeof segment === 'number');
  if (indexPath < 0) {
    return null;
  }
  return {
    parentPath: issue.path.slice(0, indexPath),
    index: issue.path[indexPath] as number,
  };
}

export function pruneInvalidArrayItemsForRetry(
  root: unknown,
  issues: ValidationIssueLike[]
): { prunedCount: number; prunedPaths: string[] } {
  const removalsByParent = new Map<string, { parentPath: ValidationPath; indexes: Set<number> }>();

  for (const issue of issues) {
    const failure = arrayItemFailure(issue);
    if (!failure) {
      continue;
    }
    const key = JSON.stringify(failure.parentPath);
    const entry = removalsByParent.get(key) ?? {
      parentPath: failure.parentPath,
      indexes: new Set<number>(),
    };
    entry.indexes.add(failure.index);
    removalsByParent.set(key, entry);
  }

  let prunedCount = 0;
  const prunedPaths: string[] = [];
  const removals = [...removalsByParent.values()].sort(
    (a, b) => b.parentPath.length - a.parentPath.length
  );

  for (const removal of removals) {
    const parent = valueAtPath(root, removal.parentPath);
    if (!Array.isArray(parent)) {
      continue;
    }
    const indexes = [...removal.indexes].sort((a, b) => b - a);
    for (const index of indexes) {
      if (index < 0 || index >= parent.length) {
        continue;
      }
      parent.splice(index, 1);
      prunedCount += 1;
      prunedPaths.push(`${removal.parentPath.join('.') || '<root>'}[${index}]`);
    }
  }

  return { prunedCount, prunedPaths };
}
