import { defineConfig } from "vitest/config";

// Scoped to the skill-management feature: xyne-claw-shared has historically
// only run `typecheck`, so we keep the test surface narrow to the new pure
// modules (diff/hash/authz, tool defs, flow builder) which have no heavy deps.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
