export interface ScanClient {
  scan(cursor: string, match: "MATCH", pattern: string, count: "COUNT", size: number): Promise<[string, string[]]>;
}

export async function scanKeys(redis: ScanClient, pattern: string, pageSize = 200): Promise<string[]> {
  const keys = new Set<string>();
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", pageSize);
    cursor = next;
    for (const key of batch) keys.add(key);
  } while (cursor !== "0");
  return [...keys];
}
