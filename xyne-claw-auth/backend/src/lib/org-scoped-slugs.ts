export const ORG_SCOPED_SLUGS = !["0", "false", "off", "no"].includes(
  (process.env["ORG_SCOPED_SLUGS"] ?? "true").trim().toLowerCase(),
);
