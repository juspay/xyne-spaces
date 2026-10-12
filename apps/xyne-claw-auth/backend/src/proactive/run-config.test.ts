import { describe, expect, it } from "vitest";
import { withProactiveCheck } from "./run-config.js";

describe("withProactiveCheck", () => {
  it("denies the channel tools, keeps other permissions and adds the check", () => {
    const config = withProactiveCheck(
      { model: "m", toolPermissions: { "google__gmail-send": "ask", "whatsapp-cloud__whatsapp_cloud_send_message": "allow" } },
      ["whatsapp-cloud__whatsapp_cloud_send_message", "whatsapp-cloud__whatsapp_cloud_react"],
      { facts: "f", fallback: "b" },
    );
    expect(config).toEqual({
      model: "m",
      toolPermissions: {
        "google__gmail-send": "ask",
        "whatsapp-cloud__whatsapp_cloud_send_message": "deny",
        "whatsapp-cloud__whatsapp_cloud_react": "deny",
      },
      proactiveCheck: { facts: "f", fallback: "b" },
    });
  });

  it("handles a config without permissions", () => {
    expect(withProactiveCheck({}, ["a__b"], { facts: "f", fallback: "b" })["toolPermissions"]).toEqual({ "a__b": "deny" });
  });
});
