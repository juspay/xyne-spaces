import { describe, expect, it } from "vitest";
import { isReadOnlyJob } from "./repo-configs.js";

describe("isReadOnlyJob", () => {
  it("sends unattended runs to the shared read-only sandbox", () => {
    for (const eventType of ["automation", "scheduled_job", "scheduled", "proactivity"]) {
      expect(isReadOnlyJob(eventType, "c1")).toBe(true);
    }
    expect(isReadOnlyJob(undefined, "scheduled_job1_123")).toBe(true);
  });

  it("leaves a person's own run its own sandbox", () => {
    expect(isReadOnlyJob("USER_MENTIONED", "c1")).toBe(false);
    expect(isReadOnlyJob(undefined, undefined)).toBe(false);
  });
});
