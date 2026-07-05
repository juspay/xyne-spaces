/**
 * MCP Gateway Routes
 */

import { Router } from "express";
import { gatewayTenantAuth, gatewayRegistrationAuth } from "../middleware/gateway-auth.js";
import { registrationController } from "../controllers/index.js";

const router = Router();

/**
 * POST /gateway/registry/register
 * Protected by registration API key (x-s2s-key header)
 */
router.post("/registry/register", gatewayTenantAuth, gatewayRegistrationAuth, async (req, res) => {
  try {
    await registrationController.register(req, res);
  } catch (error) {
    console.error("[gateway/register] error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed",
    });
  }
});

/**
 * DELETE /gateway/registry/:serviceName
 * Protected by registration API key - deregisters entire service (all backends)
 */
router.delete("/registry/:serviceName", gatewayTenantAuth, gatewayRegistrationAuth, async (req, res) => {
  try {
    await registrationController.deregister(req, res);
  } catch (error) {
    console.error("[gateway/deregister] error:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      res.status(404).json({ success: false, error: "Service not found" });
      return;
    }
    res.status(500).json({
      success: false,
      error: "Deregistration failed",
    });
  }
});

/**
 * DISABLED: These endpoints are not used - service discovery is called directly
 * They expose sensitive service/tool metadata and should not be HTTP accessible
 * If needed in future, protect with gatewayRegistrationAuth + additional validation
 */

// /**
//  * GET /gateway/registry/list
//  */
// router.get("/registry/list", gatewayTenantAuth, async (req, res) => {
//   try {
//     await discoveryController.listServices(req, res);
//   } catch (error) {
//     console.error("[gateway/list] error:", error);
//     res.status(500).json({
//       success: false,
//       error: error instanceof Error ? error.message : "Failed to list services",
//     });
//   }
// });

// /**
//  * GET /gateway/registry/service/:serviceName
//  */
// router.get("/registry/service/:serviceName", gatewayTenantAuth, async (req, res) => {
//   try {
//     await discoveryController.getService(req, res);
//   } catch (error) {
//     console.error("[gateway/service] error:", error);
//     res.status(500).json({
//       success: false,
//       error: error instanceof Error ? error.message : "Failed to get service",
//     });
//   }
// });

/**
 * DISABLED: Tools executed via internal service calls (see routes/mcp.ts)
 * Not exposed via HTTP to limit attack surface and prevent arbitrary tool execution
 * from external callers. Use executionService.executeTool() directly instead.
 */

// /**
//  * POST /gateway/registry/execute
//  */
// router.post("/registry/execute", gatewayTenantAuth, async (req, res) => {
//   try {
//     await executionController.executeTool(req, res);
//   } catch (error) {
//     console.error("[gateway/execute] error:", error);
//     res.status(500).json({
//       success: false,
//       error: error instanceof Error ? error.message : "Tool execution failed",
//     });
//   }
// });

export { router as mcpGatewayRouter };
