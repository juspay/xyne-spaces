import { redisService } from "../redis.js";

const ENABLED = process.env["CLAW_CONV_AFFINITY"] === "true";

export async function resolveClawRunBaseUrl(conversationId: string | undefined): Promise<string | null> {
  if (!ENABLED || !conversationId) return null;
  try {
    const c = redisService.getConnection();
    const pod = await c.get(`claw:conv-affinity:${conversationId}`);
    if (!pod) return null;
    const [alive, free, addr] = await Promise.all([
      c.exists(`claw:pod-alive:${pod}`),
      c.exists(`claw:pod-free:${pod}`),
      c.get(`claw:pod-addr:${pod}`),
    ]);
    if (Number(alive) > 0 && Number(free) > 0 && typeof addr === "string" && addr.length > 0) {
      return addr;
    }
    return null;
  } catch {
    return null;
  }
}
