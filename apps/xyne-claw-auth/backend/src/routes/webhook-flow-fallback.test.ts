import { describe, expect, it } from "vitest";
import { isFlowSchemaRejection, SpacesApiError } from "../mcp/servers/xyne-spaces-client.js";

/**
 * The ticket approval card uses the rich `ticket` FlowUI component, which older
 * Spaces deployments reject with a 400 "Invalid flowJSON" discriminator error.
 * postWriteApprovalAction falls back to the generic approve/decline card ONLY on
 * that specific rejection — this guards the predicate that decides it, so an
 * unrelated 400 (channel/target validation) never silently downgrades the card.
 */
describe("isFlowSchemaRejection", () => {
  const flow400 = new SpacesApiError(
    400,
    'Spaces app API 400: {"error":"Invalid flowJSON","code":"VALIDATION_ERROR","details":["components.0.type: Invalid discriminator value. Expected \'text\' | \'card\'"]}',
  );

  it("is true for a 400 Invalid flowJSON discriminator rejection", () => {
    expect(isFlowSchemaRejection(flow400)).toBe(true);
  });

  it("matches on the discriminator wording alone too", () => {
    expect(isFlowSchemaRejection(new SpacesApiError(400, "bad discriminator value"))).toBe(true);
  });

  it("is false for a 400 that is NOT a flow-schema error (channel validation)", () => {
    expect(
      isFlowSchemaRejection(new SpacesApiError(400, "Spaces app API 400: channelId is required")),
    ).toBe(false);
  });

  it("is false for a 403 (not accessible) — that path is the skip logic, not a downgrade", () => {
    expect(isFlowSchemaRejection(new SpacesApiError(403, "Spaces app API 403: forbidden"))).toBe(false);
  });

  it("is false for a 404", () => {
    expect(isFlowSchemaRejection(new SpacesApiError(404, "Spaces app API 404: Invalid flowJSON"))).toBe(false);
  });

  it("is false for a plain Error even if the text mentions flowJSON", () => {
    expect(isFlowSchemaRejection(new Error("Invalid flowJSON"))).toBe(false);
  });

  it("is false for non-error values", () => {
    expect(isFlowSchemaRejection(undefined)).toBe(false);
    expect(isFlowSchemaRejection("Invalid flowJSON")).toBe(false);
  });
});
