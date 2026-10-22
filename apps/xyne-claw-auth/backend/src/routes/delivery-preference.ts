/**
 * The signed-in person's choice of where agent messages reach them
 * (XYNE-66911). Mounted at /claw/api/v1/settings/delivery-preference.
 *
 * GET    — the order in force, whether they chose it, and which surfaces can
 *          be reached right now (so the settings page can say why WhatsApp
 *          or Teams would be skipped).
 * PUT    — { order: ["whatsapp", "spaces", ...] }. Unknown surfaces are a 400;
 *          duplicates are dropped; Spaces is appended when left out.
 * DELETE — forget the choice: every flow goes back to its old routing.
 *
 * Every route touches only the caller's own row in the caller's org.
 */
import { Router, type Request, type Response } from "express";
import { asyncHandler, badRequest, ok, unauthorized } from "../lib/http.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import {
  clearDeliveryPreference,
  DELIVERY_SURFACES,
  FALLBACK_SURFACE,
  loadDeliveryPreference,
  normalizeDeliveryOrder,
  saveDeliveryPreference,
  type DeliverySurface,
} from "../lib/delivery-preference.js";
import { findNotifyTarget } from "../surfaces/messaging/agent-tools.js";

export const deliveryPreferenceRouter = Router();

function callerOf(req: Request): { userId: string; orgId: string } {
  const userId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!userId || !orgId) throw unauthorized("Authenticated organization session required");
  return { userId, orgId };
}

interface SurfaceStatus {
  surface: DeliverySurface;
  /** Messages can reach the person here now. */
  available: boolean;
  /** Approval prompts can go here too (a link proven by one-time code). */
  approvals: boolean;
  reason?: "not_linked" | "unavailable";
}

async function surfaceStatuses(userId: string, orgId: string): Promise<SurfaceStatus[]> {
  const whatsapp = await findNotifyTarget(userId, orgId).catch(() => null);
  return DELIVERY_SURFACES.map((surface): SurfaceStatus => {
    if (surface === "spaces") return { surface, available: true, approvals: true };
    if (surface === "whatsapp") {
      return whatsapp
        ? { surface, available: true, approvals: whatsapp.via === "identity" }
        : { surface, available: false, approvals: false, reason: "not_linked" };
    }
    return { surface, available: false, approvals: false, reason: "unavailable" };
  });
}

async function view(userId: string, orgId: string) {
  const [preference, surfaces] = await Promise.all([
    loadDeliveryPreference(userId, orgId),
    surfaceStatuses(userId, orgId),
  ]);
  // Not chosen: report Spaces alone, the destination most flows use today.
  // The page lists the other surfaces after it from `surfaces`.
  return { order: preference ?? [FALLBACK_SURFACE], chosen: preference !== null, surfaces };
}

deliveryPreferenceRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, orgId } = callerOf(req);
    ok(res, await view(userId, orgId));
  }),
);

deliveryPreferenceRouter.put(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, orgId } = callerOf(req);
    const parsed = normalizeDeliveryOrder((req.body as { order?: unknown } | undefined)?.order);
    if (!parsed.ok) throw badRequest(parsed.error);
    await saveDeliveryPreference(userId, orgId, parsed.order);
    ok(res, await view(userId, orgId));
  }),
);

deliveryPreferenceRouter.delete(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, orgId } = callerOf(req);
    await clearDeliveryPreference(userId, orgId);
    ok(res, await view(userId, orgId));
  }),
);
