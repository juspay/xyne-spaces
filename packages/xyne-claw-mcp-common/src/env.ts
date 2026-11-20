/** Settings read from process.env on each access, with the same names and defaults as claw-auth's CONFIG. */
const vespaQuery = (): string => (process.env["VESPA_QUERY_ENDPOINT"] ?? "http://localhost:8081").replace(/\/+$/, "");

export const SERVER_ENV = {
  get isProduction(): boolean {
    return process.env["NODE_ENV"] === "production";
  },
  get xyneClawUrl(): string {
    return process.env["XYNE_CLAW_URL"] ?? "http://localhost:3002";
  },
  /** Public Spaces URL for links people click. */
  get spacesAppUrl(): string {
    return (
      process.env["PUBLIC_SPACES_URL"] ??
      process.env["SPACES_APP_URL"] ??
      process.env["VITE_XYNE_BACKEND_URL"] ??
      process.env["SPACES_BACKEND_URL"] ??
      ""
    );
  },
  get directVespaSearch(): boolean {
    return ["1", "true", "on", "yes"].includes((process.env["DIRECT_VESPA_SEARCH"] ?? "").trim().toLowerCase());
  },
  get vespaQueryEndpoint(): string {
    return vespaQuery();
  },
  get vespaConfigEndpoint(): string {
    const explicit = process.env["VESPA_CONFIG_ENDPOINT"];
    if (explicit) return explicit.replace(/\/+$/, "");
    try {
      const u = new URL(vespaQuery());
      u.port = "19071";
      return u.toString().replace(/\/+$/, "");
    } catch {
      return "http://localhost:19071";
    }
  },
  get vespaConfigTenant(): string {
    return process.env["VESPA_CONFIG_TENANT"] ?? "default";
  },
  get vespaConfigApplication(): string {
    return process.env["VESPA_CONFIG_APPLICATION"] ?? "default";
  },
  get vespaConfigEnvironment(): string {
    return process.env["VESPA_CONFIG_ENVIRONMENT"] ?? "default";
  },
  get vespaConfigRegion(): string {
    return process.env["VESPA_CONFIG_REGION"] ?? "default";
  },
  get vespaConfigInstance(): string {
    return process.env["VESPA_CONFIG_INSTANCE"] ?? "default";
  },
};
